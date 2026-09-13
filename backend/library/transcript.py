"""Deriving ``transcript.json`` from the renderer's ``project.capforge``.

One write rule (§2.2): the renderer PUTs the session snapshot, the backend
derives the transcript in the same write. The project file is **external data**
— it arrives over HTTP — so it is validated at this boundary and nowhere else.

Validating through ``TranscriptionResult`` is also what strips the renderer-only
keys (``wid``, per-word ``overrides``): the schema ignores extras, so what lands
on disk is the transcript an agent can read without session knowledge.
"""

from __future__ import annotations

from pydantic import ValidationError

from backend.models.schemas import TranscriptionResult

PROJECT_VERSION_KEY = "version"
PROJECT_RESULT_KEY = "transcriptionResult"


def derive_transcript(project: dict) -> dict:
    """Validate a v2 project dict and return the transcript to persist.

    Raises ``ValueError`` (never a bare ``ValidationError``) with a message the
    route can hand back as a 422.
    """
    if not isinstance(project, dict):
        raise ValueError(f"project must be a JSON object, got {type(project).__name__}")

    version = project.get(PROJECT_VERSION_KEY)
    if not isinstance(version, int) or isinstance(version, bool):
        raise ValueError(f"project.{PROJECT_VERSION_KEY} must be an integer, got {version!r}")

    result = project.get(PROJECT_RESULT_KEY)
    if not isinstance(result, dict):
        raise ValueError(
            f"project.{PROJECT_RESULT_KEY} must be a JSON object, got {type(result).__name__}"
        )

    try:
        return TranscriptionResult.model_validate(result).model_dump()
    except ValidationError as exc:
        raise ValueError(f"project.{PROJECT_RESULT_KEY} is not a valid transcription: {exc}") from exc


def segments_only(transcript: dict) -> dict:
    """The words-stripped shape (the LLM token budget, §9.5).

    ``duration``/``language``/``audio_path`` survive — a chapter tool needs the
    duration, and dropping it here was the bug §3.1 files as an S-effort input.
    """
    lean_segments = [
        {key: value for key, value in segment.items() if key != "words"}
        for segment in transcript.get("segments", [])
    ]
    return {**transcript, "segments": lean_segments}


def plain_text(transcript: dict) -> str:
    """Segment text joined for the search index — never the word array."""
    texts = [
        str(segment.get("text", "")).strip()
        for segment in transcript.get("segments", [])
    ]
    return " ".join(text for text in texts if text)
