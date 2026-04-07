"""Standard sentence-level SRT exporter."""

from backend.models.schemas import TranscriptionResult


def _fmt(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    ms = int((s - int(s)) * 1000)
    return f"{h:02d}:{m:02d}:{int(s):02d},{ms:03d}"


def export_srt_standard(result: TranscriptionResult) -> str:
    """Return SRT string with one segment (sentence/phrase) per entry."""
    lines: list[str] = []
    for idx, seg in enumerate(result.segments, start=1):
        lines.append(str(idx))
        lines.append(f"{_fmt(seg.start)} --> {_fmt(seg.end)}")
        lines.append(seg.text.strip())
        lines.append("")
    return "\n".join(lines)
