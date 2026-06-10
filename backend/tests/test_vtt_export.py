"""Tests for the WebVTT exporter."""

from backend.exporters.vtt_export import export_vtt
from backend.models.schemas import Segment, TranscriptionResult


def test_starts_with_webvtt_header(transcription_result):
    out = export_vtt(transcription_result)
    lines = out.splitlines()
    assert lines[0] == "WEBVTT"
    assert lines[1] == ""


def test_cues_have_no_entry_numbers(transcription_result):
    out = export_vtt(transcription_result)
    lines = out.splitlines()
    # First cue starts right after the header blank line.
    assert lines[2] == "00:00:00.000 --> 00:00:02.500"
    assert lines[3] == "Hello brave world"


def test_timestamps_use_dot_millisecond_separator(transcription_result):
    out = export_vtt(transcription_result)
    assert "," not in out
    assert "00:01:01.250 --> 01:02:03.500" in out


def test_text_is_stripped(transcription_result):
    out = export_vtt(transcription_result)
    assert "Crossing the hour" in out.splitlines()
    assert "  Crossing the hour  " not in out


def test_milliseconds_truncate_to_three_digits():
    result = TranscriptionResult(
        segments=[Segment(start=0.125, end=2.625, text="ms check")]
    )
    out = export_vtt(result)
    assert "00:00:00.125 --> 00:00:02.625" in out


def test_empty_result_is_header_only(empty_result):
    assert export_vtt(empty_result) == "WEBVTT\n"
