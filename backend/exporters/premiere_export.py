"""SubForge custom format — structured JSON for Premiere Pro MOGRT pipeline."""

import json
from typing import Any

from backend.models.schemas import TranscriptionResult


def export_subforge(result: TranscriptionResult) -> str:
    """Return .subforge JSON with word-level data optimized for animated subtitles.

    Structure:
    - metadata: language, audio path, duration
    - segments[]: each with text, timing, speaker
      - words[]: each with word, start, end, score, speaker
      - groups[]: auto-grouped word clusters (2-3 words) for grouped display
    """
    doc: dict[str, Any] = {
        "version": "1.0",
        "format": "subforge",
        "metadata": {
            "language": result.language,
            "audio_path": result.audio_path,
            "duration": result.duration,
        },
        "segments": [],
    }

    for seg in result.segments:
        seg_data: dict[str, Any] = {
            "start": seg.start,
            "end": seg.end,
            "text": seg.text,
            "speaker": seg.speaker,
            "words": [
                {
                    "word": w.word.strip(),
                    "start": w.start,
                    "end": w.end,
                    "score": w.score,
                    "speaker": w.speaker,
                }
                for w in seg.words
            ],
            "groups": _auto_group(seg.words),
        }
        doc["segments"].append(seg_data)

    return json.dumps(doc, indent=2, ensure_ascii=False)


def _auto_group(words: list, group_size: int = 3) -> list[dict[str, Any]]:
    """Split words into display groups of ~group_size for grouped subtitle mode."""
    groups: list[dict[str, Any]] = []
    for i in range(0, len(words), group_size):
        chunk = words[i : i + group_size]
        if not chunk:
            continue
        groups.append({
            "start": chunk[0].start,
            "end": chunk[-1].end,
            "text": " ".join(w.word.strip() for w in chunk),
            "word_indices": list(range(i, i + len(chunk))),
        })
    return groups
