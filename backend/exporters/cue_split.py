"""Split transcript segments into readable subtitle cues.

A WhisperX segment is a VAD/decoder chunk, **not** a sentence — and CapForge
deliberately re-merges the sentence subsegments ``whisperx.align()`` produces so
callers keep a 1:1 segment mapping (``engine/transcriber.py``). Emitting one cue
per segment therefore produced single subtitles holding several sentences on one
very long line. This module turns a segment's words into the cues a viewer
expects from a film or YouTube subtitle track.

Three ordered passes, then wrapping:

1. **Sentence** — break after terminal punctuation, guarding abbreviations,
   initials and decimals.
2. **Length** — anything over ``MAX_LINES`` full lines is split again, preferring
   a clause boundary near the middle.
3. **Duration** — anything over ``MAX_DURATION`` is split the same way.

There is deliberately **no reading-speed (CPS) pass**: characters-per-second is
scale-invariant under splitting — halving a cue halves both its text and its
duration — so a fast talker cannot be fixed by cutting, only by extending
timings, which this module is not allowed to do.

**Timing locality.** Cue times are *copied* from existing ``WordSegment`` values,
never recomputed, matching the repo-wide invariant that timing is never shifted.
The two exceptions are both bounded and one-directional:

* a cue shorter than ``MIN_DURATION`` may have its **end** pushed later into a
  genuine gap, never past the next cue and never for the final cue;
* a segment that arrives with no word timings at all (degraded alignment) has
  times interpolated by character count strictly inside its own span.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from backend.models.schemas import Segment, WordSegment

# Broadcast subtitle conventions (BBC/Netflix house style).
MAX_CHARS_PER_LINE = 42
MAX_LINES = 2
MAX_DURATION = 7.0
MIN_DURATION = 1.0

_MAX_CHARS = MAX_CHARS_PER_LINE * MAX_LINES

_TERMINALS = ".!?…。！？"
_ALWAYS_TERMINAL = "…。！？"  # CJK / ellipsis: never an abbreviation
_CLAUSE = ",;:—–"
_CLOSERS = "\"'”’)]}»"
_OPENERS = "\"'“‘([{«"

# Tokens that end in a period without ending a sentence.
_ABBREVIATIONS = frozenset({
    "mr", "mrs", "ms", "dr", "prof", "rev", "sr", "jr", "st", "mt",
    "vs", "etc", "approx", "est", "inc", "ltd", "co", "dept", "no", "fig",
    "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct",
    "nov", "dec", "mon", "tue", "wed", "thu", "fri", "sat", "sun",
})


@dataclass(frozen=True)
class Cue:
    """One subtitle entry: a time span and its already-wrapped lines."""

    start: float
    end: float
    lines: tuple[str, ...]
    speaker: str | None = None


# --- Text helpers ---------------------------------------------------------

def _text(words: list[WordSegment]) -> str:
    return " ".join(w.word.strip() for w in words if w.word.strip())


def _ends_clause(token: str) -> bool:
    stripped = token.strip().rstrip(_CLOSERS)
    return bool(stripped) and stripped[-1] in _CLAUSE


def _ends_sentence(token: str, next_token: str | None) -> bool:
    """True when ``token`` closes a sentence.

    Guards the three ways a period lies: abbreviations ("Mr."), initials and
    dotted forms ("J.", "U.S."), and a lowercase continuation, which in Whisper
    output means the model did not treat it as a sentence break either.
    """
    stripped = token.strip().rstrip(_CLOSERS)
    if not stripped or stripped[-1] not in _TERMINALS:
        return False
    if stripped[-1] in _ALWAYS_TERMINAL:
        return True

    core = stripped[:-1]
    if stripped[-1] == ".":
        if len(core) <= 1 or "." in core:
            return False  # "J." / "U.S." / "3."
        if core.lower() in _ABBREVIATIONS:
            return False

    if next_token is None:
        return True
    following = next_token.strip().lstrip(_OPENERS)
    return not following or not following[0].islower()


# --- Pass 1: sentences ----------------------------------------------------

def _sentence_chunks(words: list[WordSegment]) -> list[list[WordSegment]]:
    chunks: list[list[WordSegment]] = []
    current: list[WordSegment] = []
    for i, word in enumerate(words):
        current = [*current, word]
        following = words[i + 1].word if i + 1 < len(words) else None
        if _ends_sentence(word.word, following):
            chunks.append(current)
            current = []
    if current:
        chunks.append(current)
    return chunks


# --- Passes 2 & 3: length and duration ------------------------------------

def _fits(words: list[WordSegment]) -> bool:
    duration = words[-1].end - words[0].start
    return len(_text(words)) <= _MAX_CHARS and duration <= MAX_DURATION


def _break_index(words: list[WordSegment]) -> int | None:
    """Index to cut at: a clause boundary if one exists, else plain whitespace,
    in both cases the candidate nearest the midpoint so the halves stay even."""
    if len(words) < 2:
        return None

    lengths = [len(w.word.strip()) for w in words]
    total = sum(lengths) + len(words) - 1
    target = total / 2

    best_key: tuple[int, float] | None = None
    best_index = 1
    running = 0
    for i in range(1, len(words)):
        running += lengths[i - 1] + (1 if i > 1 else 0)
        tier = 0 if _ends_clause(words[i - 1].word) else 1
        key = (tier, abs(running - target))
        if best_key is None or key < best_key:
            best_key, best_index = key, i
    return best_index


def _split_chunk(words: list[WordSegment]) -> list[list[WordSegment]]:
    if len(words) < 2 or _fits(words):
        return [words]
    index = _break_index(words)
    if index is None:
        return [words]
    return _split_chunk(words[:index]) + _split_chunk(words[index:])


# --- Wrapping -------------------------------------------------------------

def _balanced(tokens: list[str], line_count: int) -> list[str] | None:
    """Break ``tokens`` into exactly ``line_count`` lines minimising the longest
    line, or None when no arrangement keeps every line within the limit."""
    memo: dict[tuple[int, int], tuple[int, tuple[int, ...]] | None] = {}

    def best(start: int, remaining: int) -> tuple[int, tuple[int, ...]] | None:
        if (start, remaining) in memo:
            return memo[(start, remaining)]

        result: tuple[int, tuple[int, ...]] | None = None
        if remaining == 1:
            line = " ".join(tokens[start:])
            if tokens[start:] and len(line) <= MAX_CHARS_PER_LINE:
                result = (len(line), ())
        else:
            for cut in range(start + 1, len(tokens) - remaining + 2):
                line = " ".join(tokens[start:cut])
                if len(line) > MAX_CHARS_PER_LINE:
                    break
                rest = best(cut, remaining - 1)
                if rest is None:
                    continue
                candidate = (max(len(line), rest[0]), (cut, *rest[1]))
                if result is None or candidate[0] < result[0]:
                    result = candidate

        memo[(start, remaining)] = result
        return result

    found = best(0, line_count)
    if found is None:
        return None

    lines: list[str] = []
    previous = 0
    for cut in (*found[1], len(tokens)):
        lines.append(" ".join(tokens[previous:cut]))
        previous = cut
    return lines


def _greedy(tokens: list[str]) -> list[str]:
    """Fallback fill. A single token longer than a line gets its own long line
    rather than being dropped or hyphenated."""
    lines: list[str] = []
    current = ""
    for token in tokens:
        candidate = f"{current} {token}".strip()
        if current and len(candidate) > MAX_CHARS_PER_LINE:
            lines.append(current)
            current = token
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines or [""]


def _wrap(text: str) -> tuple[str, ...]:
    if len(text) <= MAX_CHARS_PER_LINE:
        return (text,)
    tokens = text.split()
    for line_count in range(2, MAX_LINES + 1):
        lines = _balanced(tokens, line_count)
        if lines is not None:
            return tuple(lines)
    return tuple(_greedy(tokens))


# --- Degraded input -------------------------------------------------------

def _synthetic_words(segment: Segment) -> list[WordSegment]:
    """Words for a segment that arrived without timings, spaced by character
    count across the segment's own span. The only synthesised timestamps here."""
    tokens = segment.text.split()
    if not tokens:
        return []

    span = max(segment.end - segment.start, 0.0)
    total = sum(len(t) for t in tokens)
    words: list[WordSegment] = []
    cursor = segment.start
    for token in tokens:
        duration = span * (len(token) / total) if total else 0.0
        end = min(cursor + duration, segment.end)
        words.append(WordSegment(word=token, start=cursor, end=end))
        cursor = end
    return words


# --- Minimum duration -----------------------------------------------------

def _extend_short(cues: list[Cue]) -> list[Cue]:
    """Push a too-short cue's end into the silence that follows it.

    Only ever moves an end later, never past the next cue, and never on the
    final cue — there is no known media duration to stop it overrunning.
    """
    extended: list[Cue] = []
    for cue, following in zip(cues, cues[1:]):
        if cue.end - cue.start < MIN_DURATION:
            end = max(cue.end, min(cue.start + MIN_DURATION, following.start))
            extended.append(replace(cue, end=end))
        else:
            extended.append(cue)
    return [*extended, *cues[-1:]]


# --- Entry point ----------------------------------------------------------

def split_segments(segments: list[Segment]) -> list[Cue]:
    """Return the readable subtitle cues for ``segments``."""
    cues: list[Cue] = []
    for segment in segments:
        words = segment.words or _synthetic_words(segment)
        if not words:
            continue
        for sentence in _sentence_chunks(words):
            for chunk in _split_chunk(sentence):
                text = _text(chunk)
                if not text:
                    continue
                cues.append(Cue(
                    start=chunk[0].start,
                    end=max(chunk[-1].end, chunk[0].start),
                    lines=_wrap(text),
                    speaker=segment.speaker,
                ))
    return _extend_short(cues)
