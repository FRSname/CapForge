"""WebVTT exporter."""

from backend.models.schemas import TranscriptionResult


def _fmt(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    ms = int((s - int(s)) * 1000)
    return f"{h:02d}:{m:02d}:{int(s):02d}.{ms:03d}"


def export_vtt(result: TranscriptionResult) -> str:
    """Return WebVTT string with one segment per cue."""
    lines: list[str] = ["WEBVTT", ""]
    for seg in result.segments:
        lines.append(f"{_fmt(seg.start)} --> {_fmt(seg.end)}")
        lines.append(seg.text.strip())
        lines.append("")
    return "\n".join(lines)
