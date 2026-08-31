"""Tests for the sentence-level SRT exporter."""

from backend.exporters.srt_standard import export_srt_standard
from backend.models.schemas import Segment, TranscriptionResult, WordSegment


def test_entries_are_numbered_sequentially_from_one(transcription_result):
    out = export_srt_standard(transcription_result)
    blocks = [b for b in out.split("\n\n") if b.strip()]
    assert [b.splitlines()[0] for b in blocks] == [
        str(i) for i in range(1, len(blocks) + 1)
    ]


def test_a_multi_sentence_segment_becomes_several_entries():
    """The reported bug: one cue used to hold a whole paragraph.

    Cues are sentence-sized now, so a segment carrying three sentences must
    export as at least three entries, none of them over two lines.
    """
    text = (
        "The first sentence runs on for quite a while before it stops. "
        "Then a second sentence begins and carries a fair number of words. "
        "Finally a third one arrives to close the whole thing out."
    )
    words = [
        WordSegment(word=tok, start=i * 0.28, end=(i + 1) * 0.28)
        for i, tok in enumerate(text.split())
    ]
    result = TranscriptionResult(
        segments=[Segment(start=0.0, end=words[-1].end, text=text, words=words)]
    )
    blocks = [b for b in export_srt_standard(result).split("\n\n") if b.strip()]
    assert len(blocks) >= 3
    for block in blocks:
        body = block.splitlines()[2:]
        assert 1 <= len(body) <= 2
        assert all(len(line) <= 42 for line in body)


def test_a_long_silence_inside_a_segment_splits_the_entry(transcription_result):
    """No subtitle may sit on screen across a minute of silence."""
    out = export_srt_standard(transcription_result)
    for block in [b for b in out.split("\n\n") if b.strip()]:
        start, end = block.splitlines()[1].split(" --> ")
        assert _seconds(end) - _seconds(start) <= 7.0 + 1e-9


def _seconds(stamp: str) -> float:
    hms, ms = stamp.split(",")
    h, m, s = (int(part) for part in hms.split(":"))
    return h * 3600 + m * 60 + s + int(ms) / 1000


def test_timestamp_format_uses_comma_milliseconds(transcription_result):
    out = export_srt_standard(transcription_result)
    lines = out.splitlines()
    assert lines[1] == "00:00:00,000 --> 00:00:02,500"
    # A later cue crosses minute and hour boundaries.
    assert "01:02:02,000 --> 01:02:03,500" in out


def test_text_is_stripped(transcription_result):
    out = export_srt_standard(transcription_result)
    lines = out.splitlines()
    assert lines[2] == "Hello brave world"
    assert "  Crossing" not in out


def test_milliseconds_truncate_to_three_digits():
    result = TranscriptionResult(
        segments=[Segment(start=0.25, end=1.75, text="ms check")]
    )
    out = export_srt_standard(result)
    assert "00:00:00,250 --> 00:00:01,750" in out


def test_empty_result_produces_empty_string(empty_result):
    assert export_srt_standard(empty_result) == ""
