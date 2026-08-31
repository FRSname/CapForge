"""WebVTT exporter.

Shares the cue-splitting policy with the SRT exporter — see ``cue_split``.
"""

from backend.exporters.cue_split import split_segments
from backend.models.schemas import TranscriptionResult


def _fmt(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    ms = int((s - int(s)) * 1000)
    return f"{h:02d}:{m:02d}:{int(s):02d}.{ms:03d}"


def export_vtt(result: TranscriptionResult) -> str:
    """Return WebVTT string with one readable subtitle cue per entry."""
    lines: list[str] = ["WEBVTT", ""]
    for cue in split_segments(result.segments):
        lines.append(f"{_fmt(cue.start)} --> {_fmt(cue.end)}")
        lines.extend(cue.lines)
        lines.append("")
    return "\n".join(lines)
