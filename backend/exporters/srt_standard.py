"""Standard sentence-level SRT exporter.

One cue per *sentence-sized chunk*, not per WhisperX segment — a segment is a
VAD/decoder chunk that routinely spans several sentences, which used to produce
single subtitles holding a whole paragraph on one line. ``cue_split`` owns that
policy (line length, line count, duration) and the timing rules; this module
only formats.
"""

from backend.exporters.cue_split import split_segments
from backend.models.schemas import TranscriptionResult


def _fmt(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    ms = int((s - int(s)) * 1000)
    return f"{h:02d}:{m:02d}:{int(s):02d},{ms:03d}"


def export_srt_standard(result: TranscriptionResult) -> str:
    """Return SRT string with one readable subtitle cue per entry."""
    lines: list[str] = []
    for idx, cue in enumerate(split_segments(result.segments), start=1):
        lines.append(str(idx))
        lines.append(f"{_fmt(cue.start)} --> {_fmt(cue.end)}")
        lines.extend(cue.lines)
        lines.append("")
    return "\n".join(lines)
