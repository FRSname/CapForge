"""Publish MCP tools — the channel brief, the rule checks, the upload package.

The publish loop CapForge is built around has three steps and one direction:

1. **write structured fields** onto the record with `set_video_meta` (title,
   title_options, description, chapters, tags, …),
2. **validate** them with `validate_video` (and `check_chapters` before you
   commit a chapter list),
3. **read the package** with `get_upload_package` and show it to the user.

The package is *rendered from* the record, so it is an output, never an input:
pasting its text back into a field would duplicate the record inside itself.

The rules live in Python once (`backend/library/validate.py`) — hard ones are
YouTube's own limits and are refused by `PATCH /api/library/{id}` before a write
lands; style ones come from the channel brief and are advice.

Same shape as `library.py` and `tracks.py`: `TOOLS`, `register(mcp, get_client)`,
the client resolved per call, **no import of `server`**, and every failure is an
error *dict* (`_library_call`) rather than a raised exception.
"""

from __future__ import annotations

from typing import Any, Callable, Optional

from .library_errors import _OK, _fail, _library_call

#: Severity buckets `validate_fields` answers with. Anything else is kept under
#: `other` rather than dropped — an unclassified finding is still a finding.
HARD = "hard"
STYLE = "style"
OTHER = "other"

#: The platforms `get_upload_package` can render. Non-YouTube formatters are a
#: later deliverable, so an unknown one is refused here instead of 422-ing.
SUPPORTED_PLATFORMS = ("youtube",)

#: The shape every chapter has to have before it is worth a round trip.
_CHAPTER_SHAPE = '[{"start_s": 0, "title": "Cold open"}, …]'

ClientFactory = Callable[[], Any]

_get_client: Optional[ClientFactory] = None


def _capforge() -> Any:
    """The live HTTP client, resolved at call time (never cached here)."""
    if _get_client is None:  # pragma: no cover - register() runs at import
        raise RuntimeError("mcp_server.publish was never registered on the MCP server")
    return _get_client()


def _grouped(violations: list) -> dict:
    """Split findings by severity and say whether anything blocks the write.

    `ok` is about the *hard* rules only: a style finding is the brief's opinion
    and never stops `set_video_meta`, so an agent that treated it as a blocker
    would loop forever on a channel rule the user is happy to break.
    """
    buckets: dict[str, list] = {HARD: [], STYLE: [], OTHER: []}
    for violation in violations:
        severity = violation.get("severity") if isinstance(violation, dict) else None
        buckets[severity if severity in (HARD, STYLE) else OTHER].append(violation)
    grouped = {"status": _OK, HARD: buckets[HARD], STYLE: buckets[STYLE],
               "ok": not buckets[HARD]}
    # `other` only appears when there is something in it — an empty key would
    # read as "there is a third kind of rule", and there is not.
    return {**grouped, OTHER: buckets[OTHER]} if buckets[OTHER] else grouped


def _validate(body: dict) -> dict:
    """POST one validate body and group what comes back."""
    def _call() -> dict:
        answer = _capforge().library_validate(body) or {}
        return _grouped(answer.get("violations") or [])

    return _library_call(_call)


# --- Tools ----------------------------------------------------------------

def get_brief() -> dict:
    """Read the channel brief — who the channel is for and how it writes.

    One brief for the whole library (the user edits it in CapForge under
    Settings → Channel): `channel`, `audience`, `voice`, `language` (empty means
    the transcript's), `footer`, the recorded-at line, the speaker block,
    default hashtags, link rows, and `house_rules` (no em dashes, a description
    length window, a keyword count, hook-in-the-first-150).

    Read it **before** writing any text: it is the style contract the user
    already stated, and `validate_video` reports its house rules as `style`
    findings. It is not per-video — anything specific to one video belongs on
    the record via `set_video_meta`.
    """
    return _library_call(
        lambda: {"status": _OK, "brief": _capforge().library_brief_get()}
    )


def set_brief(patch: dict) -> dict:
    """Update the channel brief — top-level fields are merged, not replaced.

    Use this only for what the user tells you about the *channel* (its audience,
    voice, footer, default hashtags, house rules), and prefer letting them edit
    it in Settings → Channel. A list field is replaced wholesale by the list you
    send, so read `get_brief()` first and send back the whole list.

    Never park a single video's title, description or chapters here — those are
    record fields (`set_video_meta`).
    """
    if not isinstance(patch, dict) or not patch:
        return _fail("Pass a non-empty 'patch' object of brief fields.")

    return _library_call(
        lambda: {"status": _OK, "brief": _capforge().library_brief_patch(patch)}
    )


def validate_video(video_id: str) -> dict:
    """Check a record's authored fields against the publish rules.

    Run it after writing fields with `set_video_meta` and before reading the
    package. Returns `{hard, style, ok}` — each finding names the `field`, the
    `rule` it broke and a `message`:

    - **hard** — YouTube's own limits and the chapter rules (title ≤ 100 chars,
      description ≤ 5000 bytes, tags line ≤ 500 chars, no angle brackets, first
      chapter at 0, at least three, ascending, ≥ 10s apart, inside the
      duration). CapForge *refuses the write* on these, so fix every one.
    - **style** — the channel brief's house rules. Follow them unless the user
      said otherwise; they never block a write.

    `ok` is true when there is no hard finding left. Fields and duration are
    read from the record, so nothing needs to be open in the app.
    """
    return _validate({"video_id": video_id})


def check_chapters(video_id: str, chapters: list[dict]) -> dict:
    """Dry-run a chapter list against the record's duration — nothing is written.

    Pass the list you are *about to* write, shaped like
    `[{"start_s": 0, "title": "Cold open"}, …]`; `start_s` is **seconds**
    (floats are fine), and the times must come from the transcript —
    `find_video_moments(video_id, kind="pause")` or `kind="speaker_change"`, or
    a segment start — never from an estimate of where a topic "probably" begins.

    Checks only the chapters, against the duration CapForge knows: first at 0,
    at least three, strictly ascending, at least 10 seconds apart, all inside
    the video. Same `{hard, style, ok}` answer as `validate_video`. Once it is
    clean, write the list with `set_video_meta`.
    """
    if not isinstance(chapters, list) or not chapters:
        return _fail(f"Pass a non-empty 'chapters' list shaped like {_CHAPTER_SHAPE}.")
    if any(not isinstance(chapter, dict) for chapter in chapters):
        return _fail(f"Every chapter must be an object like {_CHAPTER_SHAPE}.")

    # A copy: the caller's list is theirs, and the body must not alias it.
    return _validate({"video_id": video_id, "fields": {"chapters": list(chapters)}})


def get_upload_package(video_id: str, platform: str = "youtube") -> dict:
    """Render the record into one copy-ready block of text for the user.

    The last step: CapForge assembles the stored fields and the channel brief
    into the layout the user pastes into YouTube Studio (title options,
    description with chapters and links, tags, short description, Shorts,
    thumbnail ideas, notes). Show the `text` as-is — it is plain text on
    purpose.

    This is **output only**. Never write any of it back with `set_video_meta`:
    the fields are the source, the package is the rendering. To change the
    package, change a field and read it again.

    It renders even when rules are unmet and the findings ride along in
    `violations`, so run `validate_video` first and fix the hard ones —
    otherwise you are handing the user text YouTube will reject.
    """
    if platform not in SUPPORTED_PLATFORMS:
        supported = ", ".join(SUPPORTED_PLATFORMS)
        return _fail(
            f"CapForge has no {platform!r} package layout — supported: {supported}."
        )

    def _call() -> dict:
        rendered = _capforge().library_package(video_id, platform=platform) or {}
        return {
            "status": _OK,
            "platform": rendered.get("platform", platform),
            "text": rendered.get("text", ""),
            "violations": rendered.get("violations") or [],
        }

    return _library_call(_call)


#: The five tools this module contributes, in the order they are registered.
TOOLS = (
    get_brief,
    set_brief,
    validate_video,
    check_chapters,
    get_upload_package,
)


def register(mcp: Any, get_client: ClientFactory) -> None:
    """Register the publish tools on the server's FastMCP instance.

    `get_client` is called per request rather than stored, so the server's own
    `_client` remains the one object that has to exist (or be patched).
    """
    global _get_client
    _get_client = get_client
    for tool in TOOLS:
        mcp.tool()(tool)
