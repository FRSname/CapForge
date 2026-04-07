"""JSON exporter — full transcription data."""

import json

from backend.models.schemas import TranscriptionResult


def export_json(result: TranscriptionResult) -> str:
    """Return pretty-printed JSON string of the full transcription result."""
    return json.dumps(result.model_dump(), indent=2, ensure_ascii=False)
