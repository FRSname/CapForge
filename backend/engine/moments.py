"""Find transcript moments matching a text query — backs the agent's find_moments tool.

The agent uses this to locate *where* to place an effect: "find where they say
CapForge" → word timings it can pass to add_effect.
"""

from __future__ import annotations

import re

from backend.models.schemas import TranscriptionResult

_NORM_RE = re.compile(r"[^a-z0-9]+")


def _norm(text: str) -> str:
    """Lowercase + strip punctuation so 'CapForge!' matches 'capforge'."""
    return _NORM_RE.sub("", text.lower())


def find_transcript_moments(result: TranscriptionResult, query: str) -> list[dict]:
    """Return transcript moments matching `query` (case/punctuation-insensitive).

    Single-token query matches each word equal to or containing the token.
    Multi-token query matches contiguous word runs.
    Each match: {text, start, end, word_id}.
    """
    flat: list[dict] = []
    for si, seg in enumerate(result.segments):
        for wi, word in enumerate(seg.words):
            flat.append({
                "norm": _norm(word.word),
                "word": word.word.strip(),
                "start": word.start,
                "end": word.end,
                "word_id": f"{si}-{wi}",
            })

    tokens = [t for t in (_norm(t) for t in query.split()) if t]
    if not tokens or not flat:
        return []

    matches: list[dict] = []

    if len(tokens) == 1:
        tok = tokens[0]
        for f in flat:
            if f["norm"] and (f["norm"] == tok or tok in f["norm"]):
                matches.append({
                    "text": f["word"], "start": f["start"],
                    "end": f["end"], "word_id": f["word_id"],
                })
        return matches

    n = len(tokens)
    for i in range(len(flat) - n + 1):
        window = flat[i:i + n]
        if all(
            window[j]["norm"] == tokens[j] or tokens[j] in window[j]["norm"]
            for j in range(n)
        ):
            matches.append({
                "text": " ".join(w["word"] for w in window),
                "start": window[0]["start"],
                "end": window[-1]["end"],
                "word_id": window[0]["word_id"],
            })
    return matches
