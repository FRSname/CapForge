"""Tests for the sentence-level SRT exporter."""

from backend.exporters.srt_standard import export_srt_standard
from backend.models.schemas import Segment, TranscriptionResult


def test_one_entry_per_segment_with_sequential_numbering(transcription_result):
    out = export_srt_standard(transcription_result)
    blocks = [b for b in out.split("\n\n") if b.strip()]
    assert len(blocks) == 2
    assert blocks[0].splitlines()[0] == "1"
    assert blocks[1].splitlines()[0] == "2"


def test_timestamp_format_uses_comma_milliseconds(transcription_result):
    out = export_srt_standard(transcription_result)
    lines = out.splitlines()
    assert lines[1] == "00:00:00,000 --> 00:00:02,500"
    # Second segment crosses minute and hour boundaries.
    assert lines[5] == "00:01:01,250 --> 01:02:03,500"


def test_text_is_stripped(transcription_result):
    out = export_srt_standard(transcription_result)
    lines = out.splitlines()
    assert lines[2] == "Hello brave world"
    assert lines[6] == "Crossing the hour"


def test_milliseconds_truncate_to_three_digits():
    result = TranscriptionResult(
        segments=[Segment(start=0.25, end=1.75, text="ms check")]
    )
    out = export_srt_standard(result)
    assert "00:00:00,250 --> 00:00:01,750" in out


def test_empty_result_produces_empty_string(empty_result):
    assert export_srt_standard(empty_result) == ""
