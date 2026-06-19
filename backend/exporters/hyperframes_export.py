"""HyperFrames exporter — normalized word array for `npx hyperframes transcribe`.

Emits the canonical HyperFrames transcript format: a flat JSON list of
`{text, start, end}` words. CapForge stores words as `WordSegment{word, ...}`;
the field is renamed to `text` to match HyperFrames, and empty / alignment-gap
tokens are dropped so only real words reach a caption composition.

See `~/.claude/skills/hyperframes/references/captions.md` for the format spec.
"""

import json

from backend.models.schemas import TranscriptionResult


def export_hyperframes(result: TranscriptionResult) -> str:
    """Return a JSON list of {text, start, end} words (HyperFrames transcript format)."""
    words: list[dict] = []
    for segment in result.segments:
        for word in segment.words:
            text = (word.word or "").strip()
            if not text:
                continue  # skip empty / alignment-gap tokens
            words.append({"text": text, "start": word.start, "end": word.end})
    return json.dumps(words, indent=2, ensure_ascii=False)
