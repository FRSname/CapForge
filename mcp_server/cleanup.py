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
    return " ".join(w["word"] for w in words).strip()


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
    """Apply ``[{segment, word, new}]`` token replacements. Returns (new_result, count).

    Each edit replaces ``segments[segment].words[word].word`` with ``new`` and
    rebuilds that segment's ``text``. Captions render from words, so this is what
    makes a spelling fix actually appear on screen. Raises IndexError/KeyError on
    out-of-range indices so mistakes fail loudly rather than silently no-op.
    """
    out = copy.deepcopy(result)
    segments = out.get("segments", [])
    touched_segments: set[int] = set()

    for edit in edits:
        si = int(edit["segment"])
        wi = int(edit["word"])
        new_word = str(edit["new"])
        words = segments[si]["words"]
        words[wi] = {**words[wi], "word": new_word}
        touched_segments.add(si)

    for si in touched_segments:
        segments[si]["text"] = _rebuild_text(segments[si]["words"])

    return out, len(edits)
