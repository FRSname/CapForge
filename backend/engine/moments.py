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


# --- Semantic detection (Phase D) ----------------------------------------

_DIGIT_RE = re.compile(r"\d")

# Spelled-out numbers (normalized). Digit-bearing tokens (e.g. "2.4M", "50%")
# are caught separately by _DIGIT_RE.
_NUMBER_WORDS = {
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
    "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
    "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty",
    "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred",
    "thousand", "million", "billion", "trillion", "percent", "half",
    "quarter", "dozen", "double", "triple",
}

# Call-to-action triggers. Single tokens kept deliberately narrow to limit
# false positives (e.g. bare "like"/"follow" are too generic to include).
_CTA_WORDS = {"subscribe", "subscribed", "comment", "share", "download", "register"}
_CTA_PHRASES = [
    ["link", "in", "bio"], ["link", "below"], ["sign", "up"], ["check", "out"],
    ["swipe", "up"], ["click", "here"], ["hit", "the", "bell"], ["smash", "that"],
    ["comment", "below"], ["dm", "me"], ["follow", "along"],
]


def _flat_words(result: TranscriptionResult) -> list[dict]:
    """Flatten segments → words with norm/raw/timings/word_id/speaker."""
    flat: list[dict] = []
    for si, seg in enumerate(result.segments):
        for wi, word in enumerate(seg.words):
            flat.append({
                "norm": _norm(word.word),
                "raw": word.word.strip(),
                "start": word.start,
                "end": word.end,
                "word_id": f"{si}-{wi}",
                "speaker": getattr(word, "speaker", None),
            })
    return flat


def _is_number(word: dict) -> bool:
    return bool(_DIGIT_RE.search(word["raw"])) or word["norm"] in _NUMBER_WORDS


def _numbers(flat: list[dict]) -> list[dict]:
    """Spoken numbers — contiguous numeric words merge into one moment."""
    moments: list[dict] = []
    i, n = 0, len(flat)
    while i < n:
        if not _is_number(flat[i]):
            i += 1
            continue
        j = i
        while j + 1 < n and _is_number(flat[j + 1]):
            j += 1
        run = flat[i:j + 1]
        moments.append({
            "text": " ".join(w["raw"] for w in run),
            "start": run[0]["start"], "end": run[-1]["end"],
            "word_id": run[0]["word_id"],
        })
        i = j + 1
    return moments


def _cta(flat: list[dict]) -> list[dict]:
    """Call-to-action phrases/words. Longer phrases claim words first."""
    n = len(flat)
    used = [False] * n
    moments: list[dict] = []
    for phrase in sorted(_CTA_PHRASES, key=len, reverse=True):
        m = len(phrase)
        for i in range(n - m + 1):
            if any(used[i:i + m]):
                continue
            if all(flat[i + k]["norm"] == phrase[k] for k in range(m)):
                run = flat[i:i + m]
                moments.append({
                    "text": " ".join(w["raw"] for w in run),
                    "start": run[0]["start"], "end": run[-1]["end"],
                    "word_id": run[0]["word_id"],
                })
                for k in range(m):
                    used[i + k] = True
    for i, f in enumerate(flat):
        if not used[i] and f["norm"] in _CTA_WORDS:
            moments.append({
                "text": f["raw"], "start": f["start"],
                "end": f["end"], "word_id": f["word_id"],
            })
    moments.sort(key=lambda mo: mo["start"])
    return moments


def _speaker_changes(flat: list[dict]) -> list[dict]:
    """First word of each diarized speaker run (incl. the first). Empty if no
    diarization (all speakers None)."""
    moments: list[dict] = []
    prev = None
    seen = False
    for f in flat:
        spk = f["speaker"]
        if spk is None:
            continue
        if not seen or spk != prev:
            moments.append({
                "text": f["raw"], "start": f["start"], "end": f["end"],
                "word_id": f["word_id"], "speaker": spk,
            })
        prev, seen = spk, True
    return moments


_SEMANTIC_KINDS = {
    "number": _numbers, "numbers": _numbers, "stat": _numbers, "stats": _numbers,
    "cta": _cta, "call_to_action": _cta,
    "speaker": _speaker_changes, "speakers": _speaker_changes,
    "speaker_change": _speaker_changes,
}


def find_semantic_moments(result: TranscriptionResult, kind: str) -> list[dict]:
    """Detect moments by category rather than literal text.

    `kind`: numbers (spoken/written numbers) | cta (calls to action) |
    speaker_change (new diarized speaker). Each match: {text, start, end,
    word_id} (+ speaker for speaker_change).
    """
    detector = _SEMANTIC_KINDS.get(kind.strip().lower())
    if detector is None:
        raise ValueError(
            f"Unknown semantic kind: {kind!r}. Use numbers | cta | speaker_change."
        )
    flat = _flat_words(result)
    return detector(flat) if flat else []
