"""Byte-for-byte pins on the cue-based SRT and VTT exports.

``cue_split`` is shared with the ASS exporter, which needs each cue's words for
karaoke. These goldens were captured from ``split_segments`` *before* it began
carrying words, so any change to the cues it hands SRT/VTT fails here.
"""

from backend.exporters.srt_standard import export_srt_standard
from backend.exporters.vtt_export import export_vtt

SRT_GOLDEN = (
    "1\n00:00:00,500 --> 00:00:02,029\nWelcome back to the channel.\n\n"
    "2\n00:00:02,100 --> 00:00:06,509\nToday we are going to look at how\n"
    "subtitles get split into readable cues,\n\n"
    "3\n00:00:06,580 --> 00:00:10,669\nand why a single segment is never\n"
    "the right unit for a caption.\n\n"
    "4\n00:00:14,000 --> 00:00:14,320\nOkay.\n\n"
    "5\n00:00:14,320 --> 00:00:17,769\nIt matters more than you would\n"
    "think, especially on a phone.\n"
)

VTT_GOLDEN = (
    "WEBVTT\n\n"
    "00:00:00.500 --> 00:00:02.029\nWelcome back to the channel.\n\n"
    "00:00:02.100 --> 00:00:06.509\nToday we are going to look at how\n"
    "subtitles get split into readable cues,\n\n"
    "00:00:06.580 --> 00:00:10.669\nand why a single segment is never\n"
    "the right unit for a caption.\n\n"
    "00:00:14.000 --> 00:00:14.320\nOkay.\n\n"
    "00:00:14.320 --> 00:00:17.769\nIt matters more than you would\n"
    "think, especially on a phone.\n"
)


def test_srt_standard_output_is_unchanged(multi_sentence_result):
    assert export_srt_standard(multi_sentence_result) == SRT_GOLDEN


def test_vtt_output_is_unchanged(multi_sentence_result):
    assert export_vtt(multi_sentence_result) == VTT_GOLDEN
