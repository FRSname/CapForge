"""Sandboxed filesystem access for the co-author agent.

Co-author mode lets the connected agent read/write the HyperFrames project the
way a standalone author would. That is a real new attack surface — an agent (or
a prompt injection steering it) could try to read ``~/.ssh`` or write outside the
project. Every path that reaches the disk goes through :func:`resolve_in_workspace`,
which rejects absolute paths, ``..`` traversal, and symlink escapes; writes and
imports additionally enforce an extension allowlist and size caps.

Pure + framework-free so it unit-tests without a server. The endpoints in
``main.py`` are thin wrappers that resolve the workspace root and call in here.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

# Extensions an agent may write or import. Deliberately excludes executables,
# shell/config files, and anything outside web/video authoring.
ALLOWED_EXTENSIONS = frozenset({
    ".html", ".htm", ".css", ".js", ".mjs", ".json", ".txt", ".md",
    ".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif", ".avif",
    ".woff", ".woff2", ".ttf", ".otf",
    ".mp4", ".webm", ".mov", ".m4a", ".mp3", ".wav",
})

MAX_FILE_BYTES = 25 * 1024 * 1024          # 25 MB per file
MAX_IMPORT_FILES = 200                      # folder import fan-out guard
MAX_IMPORT_TOTAL_BYTES = 200 * 1024 * 1024  # 200 MB per import
MAX_TREE_ENTRIES = 2000                     # listing guard

# Never list/copy build or VCS noise.
_SKIP_DIRS = frozenset({"node_modules", ".git", "renders", "__pycache__", ".DS_Store"})


class WorkspaceError(ValueError):
    """A request that violates the sandbox (traversal, bad extension, too big)."""


def resolve_in_workspace(root: Path, relpath: str) -> Path:
    """Resolve ``relpath`` under ``root``, or raise :class:`WorkspaceError`.

    Rejects empty/absolute paths and anything that — after resolving symlinks —
    lands outside ``root``. Works for not-yet-existing files (a write target):
    ``Path.resolve`` resolves the existing prefix and appends the rest lexically.
    """
    if not relpath or not str(relpath).strip():
        raise WorkspaceError("Path is required.")
    rel = Path(relpath)
    if rel.is_absolute():
        raise WorkspaceError("Path must be relative to the workspace.")
    if ".." in rel.parts:
        raise WorkspaceError("Path must not contain '..'.")
    root_resolved = root.resolve()
    resolved = (root_resolved / rel).resolve()
    if resolved != root_resolved and root_resolved not in resolved.parents:
        raise WorkspaceError("Path escapes the workspace.")
    return resolved


def _check_extension(path: Path) -> None:
    if path.suffix.lower() not in ALLOWED_EXTENSIONS:
        raise WorkspaceError(
            f"File type '{path.suffix or path.name}' is not allowed. "
            f"Permitted: {', '.join(sorted(ALLOWED_EXTENSIONS))}."
        )


def _sensitive_roots() -> list[Path]:
    """Directories an import must never read from — secrets and CapForge's own
    data home (which holds the agent token + backend discovery file)."""
    home = Path.home()
    capforge_home = Path(os.environ.get("CAPFORGE_HOME") or home / ".capforge")
    names = (".ssh", ".aws", ".gnupg", ".config", ".kube", ".docker",
             ".azure", ".gcloud", ".gpg")
    roots = [capforge_home, *(home / n for n in names)]
    out: list[Path] = []
    for r in roots:
        try:
            out.append(r.resolve())
        except OSError:
            continue
    return out


def _guard_source(resolved: Path) -> None:
    """Reject an import whose (resolved) source is a sensitive location — closes
    the 'import ~/.capforge/backend.json then read it back' exfiltration path."""
    for root in _sensitive_roots():
        if resolved == root or root in resolved.parents:
            raise WorkspaceError("Refusing to import from a sensitive system location.")


def _is_skippable(p: Path, source: Path) -> bool:
    """True if ``p`` should be skipped while walking ``source`` — a symlink (can
    point outside the source folder) or a hidden/build entry (``.git``,
    ``node_modules``, ``.env``, …). Shared by the pack-html guard and the import
    copy loop so both walk the tree identically."""
    if p.is_symlink():
        return True
    return any(
        part in _SKIP_DIRS or part.startswith(".") for part in p.relative_to(source).parts
    )


def _guard_pack_has_html(source: Path) -> None:
    """An effect pack is a folder with a top-level ``<name>.html`` effect file —
    directly inside the imported folder, not nested in a subfolder — plus
    optional docs/assets. Reject a directory import that has none (no top-level
    effect file, or html buried in e.g. ``assets/``, isn't a pack)."""
    for p in source.iterdir():
        if _is_skippable(p, source):
            continue
        if p.is_file() and p.suffix.lower() in (".html", ".htm"):
            return
    raise WorkspaceError(
        f"'{source.name}' has no top-level .html file. An effect pack must "
        "include a top-level <name>.html effect file directly inside the "
        "imported folder."
    )


def list_tree(root: Path) -> list[dict]:
    """Shallow recursive listing of the workspace (skips build/VCS noise).

    Returns ``[{path, size, is_dir}]`` with workspace-relative POSIX paths,
    capped at :data:`MAX_TREE_ENTRIES` so a huge project can't flood a response.
    """
    root = root.resolve()
    out: list[dict] = []
    if not root.is_dir():
        return out
    for p in sorted(root.rglob("*")):
        if p.is_symlink():  # never follow a symlink out of the workspace
            continue
        if any(part in _SKIP_DIRS for part in p.relative_to(root).parts):
            continue
        is_dir = p.is_dir()
        out.append({
            "path": p.relative_to(root).as_posix(),
            "size": (p.stat().st_size if not is_dir else 0),
            "is_dir": is_dir,
        })
        if len(out) >= MAX_TREE_ENTRIES:
            break
    return out


def read_file(root: Path, relpath: str) -> str:
    """Return the UTF-8 text of a workspace file. Raises on traversal, missing
    file, or binary content (the agent reads HTML/CSS/JS, not media bytes)."""
    target = resolve_in_workspace(root, relpath)
    if not target.is_file():
        raise WorkspaceError(f"No such file in the workspace: {relpath}")
    try:
        return target.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise WorkspaceError(
            f"'{relpath}' is a binary file and can't be read as text."
        ) from exc


def write_file(root: Path, relpath: str, content: str) -> dict:
    """Write ``content`` to a workspace file, creating parent dirs inside the
    sandbox. Enforces the extension allowlist and per-file size cap."""
    target = resolve_in_workspace(root, relpath)
    _check_extension(target)
    data = content.encode("utf-8")
    if len(data) > MAX_FILE_BYTES:
        raise WorkspaceError(
            f"File is {len(data)} bytes; the limit is {MAX_FILE_BYTES} bytes."
        )
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    except OSError as exc:
        raise WorkspaceError(f"Could not write '{relpath}'.") from exc
    return {"path": target.relative_to(root.resolve()).as_posix(), "bytes": len(data)}


def import_path(root: Path, src: str, dest_subdir: str = "compositions") -> dict:
    """Copy an external file or effect pack into the workspace.

    An effect pack is a folder with a top-level ``<name>.html`` effect file,
    optional usage rules (``README.md`` / ``registry-item.json``), and optional
    assets. It is copied under ``<dest_subdir>/<name>/`` preserving its internal
    layout, so the HTML's relative references keep resolving and the agent can
    read its instructions. A directory import with no top-level ``.html`` file
    is rejected — html nested only in a subfolder (e.g. ``assets/demo.html``)
    doesn't count. Per-file extension + size limits apply; disallowed files are
    skipped, not fatal. Returns ``{imported: [...], skipped: [...]}``
    (workspace-relative).
    """
    source = Path(src).expanduser()
    if not source.exists():
        raise WorkspaceError(f"Source path does not exist: {src}")
    _guard_source(source.resolve())  # block secrets / CapForge's own data home
    # dest_subdir is itself sandboxed; force it to a real subfolder so a single
    # file can't be aimed at the project root (e.g. clobbering index.html).
    dest_base = resolve_in_workspace(root, dest_subdir)
    root_resolved = root.resolve()
    if dest_base == root_resolved:
        raise WorkspaceError("dest_subdir must be a subfolder, not the project root.")

    imported: list[str] = []
    skipped: list[str] = []
    total = 0

    def _copy_one(file_path: Path, dest_rel: Path) -> None:
        # dest_rel is already the full workspace-relative destination path.
        nonlocal total
        if file_path.suffix.lower() not in ALLOWED_EXTENSIONS:
            skipped.append(dest_rel.as_posix())
            return
        size = file_path.stat().st_size
        if size > MAX_FILE_BYTES:
            skipped.append(dest_rel.as_posix())
            return
        if len(imported) >= MAX_IMPORT_FILES or total + size > MAX_IMPORT_TOTAL_BYTES:
            raise WorkspaceError("Import exceeds the file-count or total-size limit.")
        dest = resolve_in_workspace(root, dest_rel.as_posix())
        try:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(file_path, dest)  # copy (not copy2): copystat trips on macOS flags
        except OSError as exc:
            raise WorkspaceError("Could not copy a file into the workspace.") from exc
        total += size
        imported.append(dest.relative_to(root_resolved).as_posix())

    if source.is_file():
        _check_extension(source)
        try:
            dest_base.mkdir(parents=True, exist_ok=True)
            dest = dest_base / source.name
            shutil.copy(source, dest)
        except OSError as exc:
            raise WorkspaceError("Could not copy the file into the workspace.") from exc
        imported.append(dest.relative_to(root_resolved).as_posix())
    else:
        _guard_pack_has_html(source)
        folder_root = Path(dest_subdir) / source.name
        for p in sorted(source.rglob("*")):
            # Never follow a symlink (it can point outside the source folder) and
            # skip hidden/build entries (.env, .git, …) defence-in-depth.
            if _is_skippable(p, source):
                continue
            if p.is_file():
                _copy_one(p, folder_root / p.relative_to(source))

    return {"imported": imported, "skipped": skipped}
