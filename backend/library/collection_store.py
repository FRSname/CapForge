"""Collections — an event's shared boilerplate, layered over the channel brief.

docs/plans/library-collections.md, decisions 1–8. A collection is a small entity
(``id``, ``name``, ``slots``, ``overrides``, timestamps) kept in one file,
``<library_root>/collections.json``. Membership is **not** stored here: it is
each record's ``collection_id``, counted at read time. (Named ``collection_store``
rather than ``collections`` so it can never shadow the stdlib module.)

Rules this module holds:

* **Overrides replace, slots merge.** An override replaces the channel's value
  whole (a list, a block, ``house_rules``) and ``None`` inherits it. Slots are
  the exception and merge key-wise, because an event adds variables.
* **A missing file is no collections; a corrupt one is an error** — the brief's
  rule. A user's collections are never silently reset.
* **Every write is a read-modify-write under the store's ``write_lock``**
  (``@writes`` on :class:`CollectionStoreMixin`). The member count a delete
  refuses on is taken inside that lock. Reads stay unlocked: the file is swapped
  in with ``os.replace``.
* **Collections nest** (docs/plans/library-finder.md §2): ``parent_id`` names the
  folder a collection sits in, ``None`` the top level. The tree's rules live in
  ``collection_tree.py`` and are checked inside the same lock. Every brief reader
  takes :func:`resolved_collection`, the ancestor chain folded into one
  collection, so a top-level collection resolves to itself byte-identically.
"""

from __future__ import annotations

import copy
import logging
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Annotated, Any, Iterator, Mapping, Optional, Sequence

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    ValidationError,
    model_validator,
)

from backend.library import fs
from backend.library.brief import Brief, HouseRules
from backend.library.collection_tree import (  # noqa: F401 - MAX_COLLECTION_DEPTH re-exported
    MAX_COLLECTION_DEPTH,
    ancestry,
    check_placement,
    children_of,
    tree_problem,
)
from backend.library.errors import (
    CollectionExists,
    CollectionHasChildren,
    CollectionInUse,
    CollectionNotFound,
    CollectionsUnreadable,
)
from backend.library.locking import writes
from backend.library.schemas import Link
from backend.library.template import (  # noqa: F401 - re-exported
    BUILTIN_SLOTS,
    SLOT_NAME_RE,
    validate_slot_names,
)

if TYPE_CHECKING:  # pragma: no cover - typing only
    from backend.library.schemas import VideoRecord

logger = logging.getLogger(__name__)

COLLECTIONS_FILE = "collections.json"
COLLECTIONS_FILE_VERSION = 1
COLLECTION_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
COLLECTION_ID_MAX_CHARS = 64
COLLECTION_NAME_MAX_CHARS = 120
#: The id a name with no ASCII letters or digits slugs to (``"日本"``, ``"!!!"``).
FALLBACK_SLUG = "collection"
#: ``uck26``, then ``uck26-2``: the first clash gets 2, never 1.
FIRST_CLASH_SUFFIX = 2
_NON_SLUG_RUN = re.compile(r"[^a-z0-9]+")
#: The fields a patch may leave out but may not send as ``null``.
_NON_NULLABLE_PATCH_FIELDS = ("name", "slots", "overrides")


def now_iso() -> str:
    """UTC, second precision, ``Z`` suffix — the store's timestamp format."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _stripped(value: Any) -> Any:
    return value.strip() if isinstance(value, str) else value


def _checked_slots(value: dict[str, str]) -> dict[str, str]:
    validate_slot_names(value)
    return value


CollectionId = Annotated[str, Field(pattern=COLLECTION_ID_RE.pattern)]
CollectionName = Annotated[
    str, BeforeValidator(_stripped), Field(min_length=1, max_length=COLLECTION_NAME_MAX_CHARS)
]
SlotMap = Annotated[dict[str, str], AfterValidator(_checked_slots)]


# --- models ------------------------------------------------------------------------

class BriefOverrides(BaseModel):
    """Every ``Brief`` field but ``slots``; ``None`` means "inherit the channel"."""

    model_config = ConfigDict(extra="forbid")

    channel: Optional[str] = None
    audience: Optional[str] = None
    voice: Optional[str] = None
    language: Optional[str] = None
    footer: Optional[str] = None
    recorded_at_line: Optional[str] = None
    speaker_block: Optional[str] = None
    default_hashtags: Optional[list[str]] = None
    link_rows: Optional[list[Link]] = None
    house_rules: Optional[HouseRules] = None
    description_template: Optional[str] = None

    def overridden(self) -> dict[str, Any]:
        """The fields this collection sets, as fresh copies."""
        return {
            name: copy.deepcopy(getattr(self, name))
            for name in type(self).model_fields
            if getattr(self, name) is not None
        }


class Collection(BaseModel):
    """One entry of ``collections.json``."""

    model_config = ConfigDict(extra="forbid")

    id: CollectionId
    name: CollectionName
    #: The collection this one sits inside; ``None`` is the top level.
    parent_id: Optional[CollectionId] = None
    slots: SlotMap = Field(default_factory=dict)
    overrides: BriefOverrides = Field(default_factory=BriefOverrides)
    createdAt: str
    updatedAt: str


class CollectionCreate(BaseModel):
    """``POST /collections``: an omitted ``id`` is slugged from ``name``."""

    model_config = ConfigDict(extra="forbid")

    id: Optional[CollectionId] = None
    name: CollectionName
    parent_id: Optional[CollectionId] = None
    slots: SlotMap = Field(default_factory=dict)
    overrides: BriefOverrides = Field(default_factory=BriefOverrides)


class CollectionPatch(BaseModel):
    """``PATCH /collections/{id}``: ``slots`` replaces the dict, ``overrides``
    merges per field (an override sent as ``null`` goes back to inheriting).
    ``parent_id`` sent as ``null`` moves to the top level; left out, it stays."""

    model_config = ConfigDict(extra="forbid")

    name: Optional[CollectionName] = None
    parent_id: Optional[CollectionId] = None
    slots: Optional[SlotMap] = None
    overrides: Optional[BriefOverrides] = None

    @model_validator(mode="after")
    def _no_null_top_level_field(self) -> "CollectionPatch":
        for name in _NON_NULLABLE_PATCH_FIELDS:
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} may be left out of a patch but not set to null")
        return self


class CollectionsFile(BaseModel):
    """The file's shape; duplicate ids make it unreadable, not "last one wins",
    and so does a ``parent_id`` that dangles or loops (never a flattened tree)."""

    model_config = ConfigDict(extra="forbid")

    version: int = COLLECTIONS_FILE_VERSION
    collections: list[Collection] = Field(default_factory=list)

    @model_validator(mode="after")
    def _unique_ids(self) -> "CollectionsFile":
        ids = [collection.id for collection in self.collections]
        if len(ids) != len(set(ids)):
            raise ValueError("two collections share an id")
        problem = tree_problem(self.collections)
        if problem is not None:
            raise ValueError(problem)
        return self


# --- pure helpers ------------------------------------------------------------------

def effective_brief(brief: Brief, collection: Optional[Collection]) -> Brief:
    """The channel brief with the collection's overrides and slots on top.

    Pure and idempotent: applying the same collection twice gives the same brief,
    so a caller that already holds the effective brief may pass it again.
    """
    if collection is None:
        return brief
    update = collection.overrides.overridden()
    update["slots"] = {**brief.slots, **collection.slots}
    return brief.model_copy(update=update)


def resolved_collection(
    collections: Sequence[Collection], collection_id: Optional[str]
) -> Optional[Collection]:
    """The collection with its ancestors folded in, root first; None for no id or
    an orphan id.

    ``slots`` merge key-wise (deeper wins) and each override is the deepest
    non-null value (``null`` inherits), so ``effective_brief`` over the result is
    the brief under the whole chain. Identity fields are the leaf's own. A
    top-level collection is returned as it is. Pure: the stored ones are never
    touched.
    """
    chain = ancestry(collections, collection_id) if collection_id is not None else ()
    if not chain:
        return None
    if len(chain) == 1:
        return chain[0]
    slots: dict[str, str] = {}
    overridden: dict[str, Any] = {}
    for level in chain:
        slots = {**slots, **level.slots}
        overridden = {**overridden, **level.overrides.overridden()}
    leaf = chain[-1]
    return leaf.model_copy(update={
        "slots": slots, "overrides": BriefOverrides().model_copy(update=overridden),
    })


def slugify(name: str, fallback: str = FALLBACK_SLUG) -> str:
    """A legal id from a display name (accents folded, ASCII only); ``fallback``
    when the name has no ASCII letter or digit."""
    folded = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    slug = _NON_SLUG_RUN.sub("-", folded.lower()).strip("-")
    return slug[:COLLECTION_ID_MAX_CHARS].rstrip("-") or fallback


def unique_id(base: str, taken: set[str]) -> str:
    """``base``, or ``base-2``, ``base-3``… — trimmed so the id stays ≤ 64 chars."""
    if base not in taken:
        return base
    number = FIRST_CLASH_SUFFIX
    while True:
        suffix = f"-{number}"
        candidate = base[:COLLECTION_ID_MAX_CHARS - len(suffix)].rstrip("-") + suffix
        if candidate not in taken:
            return candidate
        number += 1


def new_collection(collection_id: str, body: CollectionCreate) -> Collection:
    now = now_iso()
    return Collection(
        id=collection_id, name=body.name, parent_id=body.parent_id, slots=dict(body.slots),
        overrides=body.overrides.model_copy(deep=True), createdAt=now, updatedAt=now,
    )


def patched_collection(current: Collection, patch: CollectionPatch) -> Collection:
    """The collection after ``patch``; ``current`` itself when nothing changed."""
    sent = patch.model_fields_set
    update: dict[str, Any] = {}
    if "name" in sent:
        update["name"] = patch.name
    if "parent_id" in sent:
        update["parent_id"] = patch.parent_id
    if "slots" in sent and patch.slots is not None:
        update["slots"] = dict(patch.slots)
    if "overrides" in sent and patch.overrides is not None:
        per_field = {
            name: copy.deepcopy(getattr(patch.overrides, name))
            for name in patch.overrides.model_fields_set
        }
        update["overrides"] = current.overrides.model_copy(update=per_field)
    candidate = current.model_copy(update=update)
    if candidate.model_dump() == current.model_dump():
        return current
    return candidate.model_copy(update={"updatedAt": now_iso()})


def orphans_from(
    collections: Sequence[Collection], member_counts: Mapping[str, int]
) -> list[dict[str, Any]]:
    """``[{id, members}]`` for every ``collection_id`` no collection defines."""
    known = {collection.id for collection in collections}
    return [
        {"id": collection_id, "members": count}
        for collection_id, count in sorted(member_counts.items())
        if collection_id not in known
    ]


# --- the file ----------------------------------------------------------------------

def load_collections(root: Path) -> tuple[Collection, ...]:
    """The stored collections in file order; ``()`` when the file was never written.

    Raises :class:`CollectionsUnreadable` (a ``ValueError``) for corrupt JSON, an
    unknown key or a duplicate id. The file is left exactly as it is.
    """
    path = Path(root) / COLLECTIONS_FILE
    if not path.is_file():
        return ()
    try:
        raw = fs.read_json(path)
    except ValueError as exc:  # JSONDecodeError is a ValueError
        raise CollectionsUnreadable(f"{COLLECTIONS_FILE} is not valid JSON: {exc}") from exc
    try:
        return tuple(CollectionsFile.model_validate(raw).collections)
    except ValidationError as exc:
        raise CollectionsUnreadable(
            f"{COLLECTIONS_FILE} is not a valid collections file: {exc}"
        ) from exc


def _stored_row(row: dict[str, Any]) -> dict[str, Any]:
    """A top-level collection is written without ``parent_id``: a file with no
    nesting stays exactly the pre-nesting shape, which an older build (whose
    ``Collection`` forbids unknown keys) can still read."""
    if row.get("parent_id") is not None:
        return row
    return {key: value for key, value in row.items() if key != "parent_id"}


def save_collections(root: Path, collections: Sequence[Collection]) -> None:
    """Write the whole file atomically. The caller holds the store's write lock."""
    body = CollectionsFile(collections=list(collections)).model_dump(mode="json")
    stored = {**body, "collections": [_stored_row(row) for row in body["collections"]]}
    fs.write_json_atomic(Path(root) / COLLECTIONS_FILE, stored)


def _require(collections: Sequence[Collection], collection_id: str) -> Collection:
    for collection in collections:
        if collection.id == collection_id:
            return collection
    raise CollectionNotFound(f"No collection with id {collection_id!r}")


# --- the store mixin ---------------------------------------------------------------

class CollectionStoreMixin:
    """Mixed into ``LibraryStore`` (at its size ceiling), like ``StoreAdminMixin``,
    so call sites stay ``store.create_collection(...)``."""

    if TYPE_CHECKING:  # pragma: no cover - provided by LibraryStore
        root: Path

        def _iter_records(self) -> Iterator[VideoRecord]: ...

    def list_collections(self) -> list[Collection]:
        return list(load_collections(self.root))

    def find_collection(self, collection_id: str) -> Optional[Collection]:
        """The collection, or None — an orphan id is not an error on a read."""
        return next((c for c in load_collections(self.root) if c.id == collection_id), None)

    def get_collection(self, collection_id: str) -> Collection:
        return _require(load_collections(self.root), collection_id)

    def resolve_collection(self, collection_id: Optional[str]) -> Optional[Collection]:
        """:func:`resolved_collection` over the stored tree — what a brief reader takes."""
        if collection_id is None:
            return None
        return resolved_collection(load_collections(self.root), collection_id)

    def member_counts(self) -> dict[str, int]:
        """Library records per ``collection_id``, defined or not. Scratch records
        are hidden, read-only and pruned, so they neither hold a collection open
        nor show up as orphans."""
        counts: dict[str, int] = {}
        for record in self._iter_records():
            if record.scratch or record.collection_id is None:
                continue
            counts = {**counts, record.collection_id: counts.get(record.collection_id, 0) + 1}
        return counts

    def members_of(self, collection_id: str) -> int:
        return self.member_counts().get(collection_id, 0)

    def orphan_collection_ids(self) -> list[dict[str, Any]]:
        return orphans_from(self.list_collections(), self.member_counts())

    @writes
    def create_collection(self, body: CollectionCreate) -> Collection:
        """Add a collection. A taken explicit id raises ``CollectionExists``; an
        explicit id an orphan uses adopts its videos (decision 6). A ``parent_id``
        the tree cannot take raises a ``CollectionNestingRefused``."""
        existing = load_collections(self.root)
        check_placement(existing, None, body.parent_id)
        taken = {collection.id for collection in existing}
        if body.id is not None:
            if body.id in taken:
                raise CollectionExists(body.id)
            collection_id = body.id
        else:
            # A slug never lands on an orphan's id: adopting videos is deliberate.
            collection_id = unique_id(slugify(body.name), taken | set(self.member_counts()))
        created = new_collection(collection_id, body)
        save_collections(self.root, (*existing, created))
        logger.info("Created collection %s", created.id)
        return created

    @writes
    def patch_collection(self, collection_id: str, patch: CollectionPatch) -> Collection:
        """Merge ``patch``; a patch that changes nothing writes nothing.

        A ``parent_id`` that differs from the stored one is a move, checked
        before anything is written; re-sending the current parent is not a move.
        """
        existing = load_collections(self.root)
        current = _require(existing, collection_id)
        if "parent_id" in patch.model_fields_set and patch.parent_id != current.parent_id:
            check_placement(existing, collection_id, patch.parent_id)
        updated = patched_collection(current, patch)
        if updated is not current:
            save_collections(
                self.root, tuple(updated if c.id == collection_id else c for c in existing)
            )
        return updated

    @writes
    def delete_collection(self, collection_id: str) -> None:
        """Remove an empty collection.

        Members are refused first (``CollectionInUse``, the pre-nesting refusal,
        unchanged), then subfolders (``CollectionHasChildren``), so a client that
        predates nesting still meets the refusal it knows before the new one.
        """
        existing = load_collections(self.root)
        _require(existing, collection_id)
        members = self.members_of(collection_id)
        if members:
            raise CollectionInUse(collection_id, members)
        children = len(children_of(existing, collection_id))
        if children:
            raise CollectionHasChildren(collection_id, children)
        save_collections(self.root, tuple(c for c in existing if c.id != collection_id))
        logger.info("Deleted collection %s", collection_id)
