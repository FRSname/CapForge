"""Tests for the word-level SRT exporter."""

from backend.exporters.srt_word import export_srt_word


def test_one_entry_per_word_numbered_across_segments(transcription_result):
    out = export_srt_word(transcription_result)
    blocks = [b for b in out.split("\n\n") if b.strip()]
    # 3 words in segment 1 + 3 words in segment 2.
    assert len(blocks) == 6
    assert [b.splitlines()[0] for b in blocks] == ["1", "2", "3", "4", "5", "6"]


def test_word_timestamps_are_per_word_not_per_segment(transcription_result):
    out = export_srt_word(transcription_result)
    lines = out.splitlines()
    assert lines[1] == "00:00:00,000 --> 00:00:00,750"
    assert lines[2] == "Hello"
    assert lines[5] == "00:00:00,750 --> 00:00:01,500"
    assert lines[6] == "brave"
    # Last word of the second segment crosses the hour boundary.
    assert "01:02:02,000 --> 01:02:03,500" in out
    assert lines[-1] == "hour"


def test_word_text_is_stripped(transcription_result):
    out = export_srt_word(transcription_result)
    words = out.splitlines()[2::4]
    assert words == ["Hello", "brave", "world", "Crossing", "the", "hour"]


def test_empty_result_produces_empty_string(empty_result):
    assert export_srt_word(empty_result) == ""
