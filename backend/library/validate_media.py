"""The Shorts and Thumbnail rules (publish-editors Part A, decision 4).

Called from ``validate.py`` (hard rules with the rest of the hard rules, style
rules with the rest of the style rules, so only when a brief is given) and from
the ``PATCH`` refusal in ``router_publish`` (``candidates_findings``).

**An omitted thumbnail key means "unchanged"**: a patch carrying
``{thumbnail: {ideas}}`` inherits the stored ``candidates`` and ``cover``
(``inherit_thumbnail``), so an agent never has to echo the frame list back.
Only an explicitly sent ``candidates`` that differs from the stored list — or
``thumbnail: null`` over stored frames — is ``candidates_managed``.

| rule                    | severity | field                          |
|-------------------------|----------|--------------------------------|
| ``cover_not_a_candidate``| hard     | ``thumbnail.cover``            |
| ``clip_order``          | hard     | ``shorts.clip_suggestions[i]`` |
| ``clip_past_end``       | hard     | ``shorts.clip_suggestions[i]`` |
| ``candidates_managed``  | hard     | ``thumbnail.candidates``       |
| ``shorts_clip_length``  | style    | ``shorts.clip_suggestions[i]`` |
| ``thumbnail_recommended``| style   | ``thumbnail.ideas``            |
"""

from __future__ import annotations

from typing import Any, Mapping, Optional, Sequence

from backend.library.package import format_timestamp
from backend.library.schemas import RecordPatch, Shorts, Thumbnail
from backend.library.violation import Violation, hard, style

#: The guide's Short: YouTube itself allows longer, so this is advice.
SHORTS_MAX_S = 60

COVER_FIELD = "thumbnail.cover"
CANDIDATES_FIELD = "thumbnail.candidates"
IDEAS_FIELD = "thumbnail.ideas"
#: Every key of the ``thumbnail`` object; the ones a patch omits are inherited.
THUMBNAIL_KEYS = frozenset(Thumbnail.model_fields)


def _clip_field(index: int) -> str:
    return f"shorts.clip_suggestions[{index}]"


def media_hard_rules(patch: RecordPatch, duration: Optional[float]) -> list[Violation]:
    return [*_cover_rule(patch.thumbnail), *_clip_rules(patch.shorts, duration)]


def media_style_rules(patch: RecordPatch) -> list[Violation]:
    return [*_clip_length_rule(patch.shorts), *_recommended_rule(patch.thumbnail)]


def inherit_thumbnail(stored: Thumbnail, patch: RecordPatch) -> RecordPatch:
    """``patch`` with the thumbnail keys it omitted filled in from ``stored``.

    Returns the same patch when it carries no thumbnail object (absent or
    ``null``) or omits nothing; otherwise a new patch — neither argument is
    mutated. Keys the patch *did* send, ``cover: null`` included, win.
    """
    sent = patch.thumbnail
    if "thumbnail" not in patch.model_fields_set or sent is None:
        return patch
    omitted = THUMBNAIL_KEYS - sent.model_fields_set
    if not omitted:
        return patch
    merged = Thumbnail.model_validate({
        **stored.model_dump(include=set(omitted)),
        **sent.model_dump(include=set(sent.model_fields_set)),
    })
    return patch.model_copy(update={"thumbnail": merged})


def merge_thumbnail_fields(stored: Thumbnail, fields: Mapping[str, Any]) -> dict:
    """The dict form of :func:`inherit_thumbnail`, for a draft sent to
    ``/validate`` with a ``video_id``: a partial ``thumbnail`` object is judged
    with the stored keys it left out, never against empty defaults."""
    merged = dict(fields)
    sent = merged.get("thumbnail")
    if isinstance(sent, Mapping):
        merged["thumbnail"] = {**stored.model_dump(), **sent}
    return merged


def candidates_findings(stored: Sequence[str], patch: RecordPatch) -> list[Violation]:
    """``candidates_managed`` when a patch would change the stored candidates.

    Candidates are files, so only the frame routes may change the list. A patch
    with no thumbnail, or a thumbnail object without ``candidates``, leaves the
    list alone; ``thumbnail: null`` would drop it and is refused.
    """
    if "thumbnail" not in patch.model_fields_set:
        return []
    if patch.thumbnail is None:
        sent: Sequence[str] = []
    elif "candidates" not in patch.thumbnail.model_fields_set:
        return []
    else:
        sent = patch.thumbnail.candidates
    if list(sent) == list(stored):
        return []
    return [hard(
        CANDIDATES_FIELD, "candidates_managed",
        "Thumbnail candidates are frame files: grab_frames adds them and deleting "
        "a frame removes them; omit candidates from a patch to leave them unchanged",
    )]


def cover_findings(thumbnail: Optional[Thumbnail]) -> list[Violation]:
    """``cover_not_a_candidate`` over an already merged thumbnail object."""
    return _cover_rule(thumbnail)


def _cover_rule(thumbnail: Optional[Thumbnail]) -> list[Violation]:
    if thumbnail is None or thumbnail.cover is None:
        return []
    if thumbnail.cover in thumbnail.candidates:
        return []
    return [hard(
        COVER_FIELD, "cover_not_a_candidate",
        f"The cover {thumbnail.cover!r} is not one of this video's thumbnail frames; "
        "grab it first, then pick it from the candidates",
    )]


def _clip_rules(shorts: Optional[Shorts], duration: Optional[float]) -> list[Violation]:
    if shorts is None:
        return []
    found: list[Violation] = []
    for index, clip in enumerate(shorts.clip_suggestions):
        field = _clip_field(index)
        if clip.start_s < 0 or clip.start_s >= clip.end_s:
            found.append(hard(
                field, "clip_order",
                f"Clip {index + 1} runs from {clip.start_s:g}s to {clip.end_s:g}s; "
                "a clip must start at 0s or later and before it ends",
            ))
        if duration is not None and clip.end_s > duration:
            found.append(hard(
                field, "clip_past_end",
                f"Clip {index + 1} ends at {format_timestamp(clip.end_s)}, past the end "
                f"of the video at {format_timestamp(duration)}",
            ))
    return found


def _clip_length_rule(shorts: Optional[Shorts]) -> list[Violation]:
    if shorts is None:
        return []
    found: list[Violation] = []
    for index, clip in enumerate(shorts.clip_suggestions):
        length = clip.end_s - clip.start_s
        if length > SHORTS_MAX_S:
            found.append(style(
                _clip_field(index), "shorts_clip_length",
                f"Clip {index + 1} is {length:g}s long; a Short is at most {SHORTS_MAX_S}s",
            ))
    return found


def _recommended_rule(thumbnail: Optional[Thumbnail]) -> list[Violation]:
    if thumbnail is None or not thumbnail.ideas:
        return []
    recommended = sum(1 for idea in thumbnail.ideas if idea.recommended)
    if recommended == 1:
        return []
    return [style(
        IDEAS_FIELD, "thumbnail_recommended",
        f"Mark exactly one thumbnail idea as recommended; {recommended} of "
        f"{len(thumbnail.ideas)} are",
    )]
