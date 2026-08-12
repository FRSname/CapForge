"""RSVP reels — joining caption groups into one continuously flowing line.

In ``reading_mode: 'rsvp'`` the unit of layout is **not** the caption group. A
group is a display chunk of ``words_per_group`` words; laying the RSVP line out
per group means that at every chunk boundary the line is rebuilt from zero and
snaps to its first word (``rsvp.line_offset_at`` never eases index 0), the
previous words vanish and the group entry animation fires again. The reading
line should cross a group boundary exactly the way it crosses a word boundary:
one more slide.

So before any renderer sees them, consecutive groups that are already
**continuous in time** are merged into a *reel* — one group carrying all their
words — and the existing per-group machinery (active-group lookup, layout, the
entry/exit animation, the background box) then operates on the reel with no
further changes.

The rule
--------
A break between consecutive groups ``a`` and ``b`` happens when, in this order:

1. **Missing timing** — ``a["end"]`` or ``b["start"]`` is not a finite number.
   Never join on junk data; mirrors rule 1 of the gap-closing pass
   (``_close_group_gaps`` in ``video_render.py``).
2. **A real blank gap** — ``a["end"] < b["start"]``. This is deliberately the
   *existing blanking rule*: a frame between ``a["end"]`` and ``b["start"]`` has
   no active group and draws nothing today, so joining exactly the pairs that
   have no such frame adds continuity **without changing when captions appear or
   disappear**. Gap closing runs upstream and has already pulled ``a["end"]`` up
   to ``b["start"]`` for every gap at or below ``gap_close_threshold``, so that
   dial is what decides how long a reel gets; a real pause still breaks it.
3. **A differing position override** — ``position_x``/``position_y`` compared as
   a pair. A reel spans groups, so it can carry only one caption anchor;
   breaking here means a per-group override is *honoured* rather than silently
   dropped, and the words either side of it were going to be visually separated
   anyway.

Deliberately **not** a break: a **speaker change**. Gap closing refuses to
*bridge* one (it will not stretch an end across a speaker boundary), so any real
pause between two speakers already breaks the reel by rule 2; what is left is a
speaker change with no gap at all, and resetting the reading line there would be
a worse artefact than letting the words flow. It is also not expressible on both
sides of the parity contract — ``CustomGroup`` (``models/schemas.py``) carries no
``speaker``, so the frontend-authored path would break reels in the Canvas
preview and not in the render. The shared fixture
(``backend/tests/fixtures/rsvp_reel_cases.json``) pins the *ignoring* of it, so
adding the rule fails loudly instead of quietly diverging.

This module has a twin
----------------------
``src/renderer/src/lib/rsvpReels.ts`` (the Canvas preview's copy). Both read the
same fixture — ``backend/tests/fixtures/rsvp_reel_cases.json`` — via
``backend/tests/test_rsvp_reels.py`` and ``src/renderer/src/lib/rsvpReels.test.ts``.
There is deliberately **no third copy** in the HTML/GSAP runtime: that layer is
handed its groups by Python (``hyperframes_caption_html.caption_block``), already
merged, so a third implementation would be a third thing to drift. Same shape as
the gap-closing pass, which is likewise a group-list transform with two
implementations rather than three.

Not a rendering formula: nothing here measures, positions or draws anything, and
no timing is ever written — a reel's ``start``/``end`` are its members' own
(CLAUDE.md → Word-timing locality).
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any

#: The per-group keys that must match for two groups to share a reel. Compared
#: as a tuple, so "one side has an override and the other does not" is a break.
_POSITION_KEYS = ("position_x", "position_y")


def _is_finite_number(value: object) -> bool:
    """True for a real, finite ``int``/``float``. ``bool`` is not a number here
    (mirrors ``Number.isFinite(true) === false``), matching the identical guard
    in ``video_render._is_finite_number`` and the TS twin's ``Number.isFinite``.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    return math.isfinite(value)


def _position_key(group: Mapping[str, Any]) -> tuple:
    """The group's position override as a comparable pair; ``(None, None)`` when
    it follows the global config position."""
    return tuple(group.get(k) for k in _POSITION_KEYS)


def breaks_reel(a: Mapping[str, Any], b: Mapping[str, Any]) -> bool:
    """Does the boundary between consecutive groups ``a`` and ``b`` break the reel?

    The three rules in the module docstring, in order. Pure: reads only
    ``start``/``end`` and the two position keys, and mutates nothing.
    """
    if not _is_finite_number(a.get("end")) or not _is_finite_number(b.get("start")):
        return True
    if a["end"] < b["start"]:
        return True
    return _position_key(a) != _position_key(b)


def reel_ranges(groups: Sequence[Mapping[str, Any]]) -> list[tuple[int, int]]:
    """Index ranges ``[start, end)`` of the maximal runs of joinable groups.

    Returned as index ranges rather than merged groups so the rule can be pinned
    by a fixture that knows nothing about either language's group shape — see
    ``backend/tests/fixtures/rsvp_reel_cases.json``. The ranges always cover the
    whole input exactly once, in order.
    """
    if not groups:
        return []

    ranges: list[tuple[int, int]] = []
    start = 0
    for i in range(1, len(groups)):
        if breaks_reel(groups[i - 1], groups[i]):
            ranges.append((start, i))
            start = i
    ranges.append((start, len(groups)))
    return ranges


def merge_reels(groups: Sequence[Mapping[str, Any]]) -> list[dict]:
    """Merge each reel's groups into one group carrying all their words.

    The merged group keeps every other key of the reel's **first** group —
    ``speaker`` and the position override are homogeneous across a reel by
    construction (rule 3), and any extra key a caller put on its groups rides
    along rather than being dropped. A reel of one group therefore round-trips to
    an equal dict, which is what makes this safe to apply unconditionally in RSVP
    mode: with every gap real (or ``gap_close_threshold`` at 0) it is the
    identity, i.e. exactly today's per-group behaviour.

    Returns new dicts; the input is never mutated.
    """
    merged: list[dict] = []
    for start, end in reel_ranges(groups):
        members = groups[start:end]
        first = members[0]
        if len(members) == 1:
            merged.append(dict(first))
            continue

        words: list[Any] = []
        texts: list[str] = []
        for g in members:
            words.extend(g.get("words") or [])
            text = (g.get("text") or "").strip()
            if text:
                texts.append(text)

        merged.append({
            **first,
            "text": " ".join(texts),
            "start": first["start"],
            "end": members[-1]["end"],
            "words": words,
        })
    return merged


__all__ = ["breaks_reel", "merge_reels", "reel_ranges"]
