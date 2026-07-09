"""Pure transcript transforms used by the MCP cleanup tools.

All functions are pure: they take a transcript dict (the backend
``TranscriptionResult`` JSON shape) and return a NEW transcript dict, never
mutating the input. The shape is::

    {
      "segments": [
        {"start": float, "end": float, "text": str,
         "words": [{"word": str, "start": float, "end": float,
                    "score": float|None, "speaker": str|None}],
         "speaker": str|None},
        ...
      ],
      "language": str|None, "audio_path": str, "duration": float|None
    }

Timing is never shifted. CapForge is a *finishing* tool used after the video is
cut elsewhere, so captions must stay synced to the original audio — removing a
filler drops that word from the caption but leaves every other timestamp intact.
"""

from __future__ import annotations

import copy
import string
from typing import Optional

#: Conservative defaults — only unambiguous disfluencies. Words like "like" or
#: "you know" are intentionally excluded; the caller can pass them explicitly.
DEFAULT_FILLERS: tuple[str, ...] = (
    "um", "umm", "uh", "uhh", "uhm", "er", "err", "erm", "ah", "mm", "hmm", "mhm",
)


def _normalize(word: str) -> str:
    """Lowercase and strip surrounding punctuation for filler matching."""
    return word.strip().strip(string.punctuation + string.whitespace).lower()


def _rebuild_text(words: list[dict]) -> str:
    # Skip empty/whitespace-only tokens so a blank slot (e.g. a legacy edit that
    # replaced a word with "") can never join into a double space.
    return " ".join(w["word"] for w in words if w["word"].strip()).strip()


def _segment_bounds(seg: dict, words: list[dict]) -> tuple[float, float]:
    """Recompute segment start/end from its words, falling back to old bounds."""
    if not words:
        return seg["start"], seg["end"]
    return min(w["start"] for w in words), max(w["end"] for w in words)


def remove_fillers(
    result: dict,
    fillers: Optional[list[str]] = None,
) -> tuple[dict, int]:
    """Drop filler words from every segment. Returns (new_result, removed_count).

    Segments left with no words are dropped. Timestamps of surviving words are
    untouched so captions stay synced to the audio.
    """
    filler_set = {_normalize(f) for f in (fillers if fillers is not None else DEFAULT_FILLERS)}
    out = copy.deepcopy(result)
    removed = 0
    new_segments: list[dict] = []

    for seg in out.get("segments", []):
        kept = [w for w in seg.get("words", []) if _normalize(w["word"]) not in filler_set]
        removed += len(seg.get("words", [])) - len(kept)
        if not kept and seg.get("words"):
            continue  # whole segment was filler → drop it
        seg["words"] = kept
        if kept:
            seg["text"] = _rebuild_text(kept)
            seg["start"], seg["end"] = _segment_bounds(seg, kept)
        new_segments.append(seg)

    out["segments"] = new_segments
    return out, removed


def apply_word_edits(result: dict, edits: list[dict]) -> tuple[dict, int]:
    """Apply ``[{segment, word, new, op}]`` token edits. Returns (new_result, count).

    Each edit locates ``segments[segment].words[word]`` and applies an ``op``:

    - ``op="replace"`` (default): swaps that token's text with ``new`` and rebuilds
      the segment's ``text``. Captions render from words, so this is what makes a
      spelling fix actually appear on screen.
    - ``op="delete"``: removes the token from ``words[]`` (``new`` ignored). The
      deleted token's ``[start, end]`` span is absorbed into the adjacent surviving
      word so no caption gap opens: the PREVIOUS survivor's ``end`` grows to cover
      the deleted ``end``; if the deleted token has no previous survivor (it was at
      the very start), the NEXT survivor's ``start`` is pulled back to the deleted
      ``start`` instead. Runs of consecutive deletions accumulate into the running
      survivor.

    A **merge** is a ``replace`` on the survivor + a ``delete`` on the neighbor in
    the same ``edits`` list — e.g. merging "chat GPT" -> "ChatGPT" is
    ``[{seg,w:3,new:"ChatGPT"}, {seg,w:4,op:"delete"}]``. The survivor keeps its
    own ``start`` and absorbs the neighbor's ``end``, so the merged word covers
    ``[first.start, second.end]``.

    No surviving word's START is ever resynced/shifted — captions stay locked to the
    original audio (the invariant documented at the top of this module); the survivor
    simply stays on screen through the deleted span. Segments left wordless are
    dropped (mirrors ``remove_fillers``). See
    docs/plans/mcp-transcript-editing-ux.md (Phase 1) for the full rationale.

    Raises IndexError/KeyError on out-of-range indices so mistakes fail loudly
    rather than silently no-op.
    """
    out = copy.deepcopy(result)
    segments = out.get("segments", [])
    # Per-segment set of ORIGINAL word indices flagged for deletion.
    deletions: dict[int, set[int]] = {}
    touched_segments: set[int] = set()

    # Pass A: apply replaces in place; record deletions (don't remove yet, so every
    # edit's word index stays valid against the original word list — no index shift).
    for edit in edits:
        si = int(edit["segment"])
        wi = int(edit["word"])
        op = str(edit.get("op", "replace"))
        words = segments[si]["words"]
        # Index into words[wi] up front to preserve the loud IndexError contract.
        target = words[wi]
        touched_segments.add(si)
        if op == "delete":
            deletions.setdefault(si, set()).add(wi)
        else:  # "replace"
            words[wi] = {**target, "word": str(edit.get("new", ""))}

    # Pass B: rebuild each touched segment — drop deleted tokens (absorbing their time
    # into an adjacent survivor), recompute text + bounds, drop wordless segments.
    new_segments: list[dict] = []
    for si, seg in enumerate(segments):
        if si not in touched_segments:
            new_segments.append(seg)
            continue

        drop = deletions.get(si, set())
        original_words = seg["words"]
        kept: list[dict] = []
        pending_start: Optional[float] = None  # earliest deleted start with no prior survivor
        for wi, w in enumerate(original_words):
            if wi in drop:
                if kept:
                    # Absorb into the previous survivor: extend its end to cover the gap.
                    prev = kept[-1]
                    prev["end"] = max(prev["end"], w["end"])
                else:
                    # No previous survivor yet — remember to pull the next survivor's
                    # start back (take the earliest deleted start across a leading run).
                    pending_start = w["start"] if pending_start is None else min(pending_start, w["start"])
                continue
            if pending_start is not None:
                w = {**w, "start": min(w["start"], pending_start)}
                pending_start = None
            kept.append(w)

        if not kept and original_words:
            continue  # every word deleted → drop the now-empty segment

        seg["words"] = kept
        if kept:
            seg["text"] = _rebuild_text(kept)
            seg["start"], seg["end"] = _segment_bounds(seg, kept)
        new_segments.append(seg)

    out["segments"] = new_segments
    return out, len(edits)
