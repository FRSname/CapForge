"""Word-level SRT exporter — one word per subtitle entry."""

from backend.models.schemas import TranscriptionResult


def _fmt(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    ms = int((s - int(s)) * 1000)
    return f"{h:02d}:{m:02d}:{int(s):02d},{ms:03d}"


def export_srt_word(result: TranscriptionResult) -> str:
    """Return SRT string with one word per entry and precise timestamps."""
    lines: list[str] = []
    idx = 1
    for seg in result.segments:
        for w in seg.words:
            lines.append(str(idx))
            lines.append(f"{_fmt(w.start)} --> {_fmt(w.end)}")
            lines.append(w.word.strip())
            lines.append("")
            idx += 1
    return "\n".join(lines)
