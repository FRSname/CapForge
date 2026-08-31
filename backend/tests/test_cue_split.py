"""Tests for the subtitle cue splitter.

The bug this guards: a WhisperX segment is a VAD/decoder chunk, not a sentence
(see ``transcriber.py`` — CapForge deliberately re-merges align()'s sentence
subsegments), so exporting one cue per segment produced single cues holding
several sentences on one very long line.
"""

from backend.exporters.cue_split import (
    MAX_CHARS_PER_LINE,
    MAX_DURATION,
    MAX_LINES,
    MIN_DURATION,
    split_segments,
)
from backend.models.schemas import Segment, TranscriptionResult, WordSegment


def _words(text: str, start: float, per_word: float) -> list[WordSegment]:
    """Evenly-timed words, ``per_word`` seconds each."""
    return [
        WordSegment(word=tok, start=start + i * per_word, end=start + (i + 1) * per_word)
        for i, tok in enumerate(text.split())
    ]


def _long_segment() -> Segment:
    text = (
        "The first sentence runs on for quite a while before it stops. "
        "Then a second sentence begins and it also carries a fair number of words. "
        "Finally a third one arrives to close the whole thing out."
    )
    words = _words(text, 0.0, 0.28)
    return Segment(start=words[0].start, end=words[-1].end, text=text, words=words)


# --- The reported bug -----------------------------------------------------

def test_multi_sentence_segment_becomes_multiple_cues():
    cues = split_segments([_long_segment()])
    assert len(cues) >= 3


def test_no_cue_holds_two_sentence_endings():
    for cue in split_segments([_long_segment()]):
        text = " ".join(cue.lines)
        # A terminal mark is allowed only as the very last character.
        assert not any(ch in ".!?" for ch in text[:-1].replace("...", "")), text


def test_no_line_exceeds_the_character_limit():
    for cue in split_segments([_long_segment()]):
        for line in cue.lines:
            assert len(line) <= MAX_CHARS_PER_LINE, line


def test_no_cue_exceeds_the_line_limit():
    for cue in split_segments([_long_segment()]):
        assert len(cue.lines) <= MAX_LINES


def test_no_cue_exceeds_the_duration_limit():
    seg = _long_segment()
    for cue in split_segments([seg]):
        assert cue.end - cue.start <= MAX_DURATION + 1e-9


# --- Timing locality ------------------------------------------------------

def test_cue_starts_are_taken_from_existing_word_starts():
    seg = _long_segment()
    starts = {w.start for w in seg.words}
    for cue in split_segments([seg]):
        assert cue.start in starts


def test_cues_never_overlap_and_stay_ordered():
    cues = split_segments([_long_segment()])
    for a, b in zip(cues, cues[1:]):
        assert a.end <= b.start + 1e-9
        assert a.start < a.end


def test_short_cue_is_extended_only_into_silence():
    words = [
        WordSegment(word="Hi.", start=0.0, end=0.2),
        WordSegment(word="Later.", start=9.0, end=9.2),
    ]
    seg = Segment(start=0.0, end=9.2, text="Hi. Later.", words=words)
    first, second = split_segments([seg])
    # Extended toward the readable minimum, but never over the next cue.
    assert first.end == MIN_DURATION
    assert first.end <= second.start
    assert second.start == 9.0


def test_short_cue_is_not_extended_over_its_neighbour():
    words = [
        WordSegment(word="Hi.", start=0.0, end=0.2),
        WordSegment(word="Later.", start=0.4, end=0.6),
    ]
    seg = Segment(start=0.0, end=0.6, text="Hi. Later.", words=words)
    first, second = split_segments([seg])
    assert first.end <= second.start


# --- Sentence detection ---------------------------------------------------

def test_abbreviations_do_not_end_a_sentence():
    text = "Mr. Smith moved to the U.S. last year and stayed."
    words = _words(text, 0.0, 0.3)
    seg = Segment(start=0.0, end=words[-1].end, text=text, words=words)
    cues = split_segments([seg])
    assert len(cues) == 1
    assert " ".join(cues[0].lines) == text


def test_lowercase_continuation_does_not_end_a_sentence():
    # Whisper capitalises sentence starts, so a lowercase next word means the
    # model did not treat the period as a break either.
    text = "She said hello. and then she left."
    words = _words(text, 0.0, 0.3)
    seg = Segment(start=0.0, end=words[-1].end, text=text, words=words)
    assert len(split_segments([seg])) == 1


def test_a_decimal_does_not_end_a_sentence():
    text = "It cost 3. Fifty pounds all in."
    words = _words(text, 0.0, 0.3)
    seg = Segment(start=0.0, end=words[-1].end, text=text, words=words)
    assert len(split_segments([seg])) == 1


# --- Wrapping -------------------------------------------------------------

def test_two_lines_are_balanced_not_lopsided():
    text = "This clause is long enough to need wrapping across two lines here"
    words = _words(text, 0.0, 0.2)
    seg = Segment(start=0.0, end=words[-1].end, text=text, words=words)
    cue = split_segments([seg])[0]
    assert len(cue.lines) == 2
    assert abs(len(cue.lines[0]) - len(cue.lines[1])) <= MAX_CHARS_PER_LINE // 2


def test_word_longer_than_a_line_is_kept_not_dropped():
    long_word = "A" * (MAX_CHARS_PER_LINE + 20)
    words = [WordSegment(word=long_word, start=0.0, end=1.0)]
    seg = Segment(start=0.0, end=1.0, text=long_word, words=words)
    cues = split_segments([seg])
    assert len(cues) == 1
    assert " ".join(cues[0].lines) == long_word


# --- Degraded input -------------------------------------------------------

def test_segment_without_words_stays_inside_its_own_span():
    text = "One sentence here. And a second sentence over there."
    seg = Segment(start=10.0, end=16.0, text=text, words=[])
    cues = split_segments([seg])
    assert len(cues) == 2
    assert cues[0].start == 10.0
    assert cues[-1].end <= 16.0
    for cue in cues:
        assert 10.0 <= cue.start < cue.end <= 16.0


def test_speaker_is_carried_onto_every_cue():
    seg = _long_segment()
    seg = Segment(**{**seg.model_dump(), "speaker": "SPEAKER_01"})
    for cue in split_segments([seg]):
        assert cue.speaker == "SPEAKER_01"


def test_empty_input_produces_no_cues():
    assert split_segments([]) == []
    assert split_segments(TranscriptionResult().segments) == []
