# Third-party models

CapForge downloads model weights from their publishers when a feature first
needs them. The weights are not part of this repository.

## Lithuanian WhisperX alignment

- Model: [`m3hrdadfi/wav2vec2-large-xlsr-lithuanian`](https://huggingface.co/m3hrdadfi/wav2vec2-large-xlsr-lithuanian)
- Revision: `d5b27b07dceb75975ccb840370181ff02edc4c90` (pinned; verified
  2026-07-19)
- Purpose: Lithuanian CTC forced alignment for word-level timings
- Architecture: `Wav2Vec2ForCTC` with `Wav2Vec2Processor`, compatible with
  WhisperX's custom `model_name` alignment-model loader
- Training data: Mozilla Common Voice Lithuanian
- License: [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
- Download size: approximately 1.2 GB on first use

CapForge resolves the pinned revision to a local Hugging Face snapshot before
passing it to WhisperX. Pinning is security-critical because this model uses a
pickle-format `pytorch_model.bin`, which can execute code while loading; an
unpinned upstream change must never be accepted silently.

Apache-2.0 permits use, modification, and distribution alongside CapForge's
MIT-licensed code. If CapForge begins redistributing the model weights instead
of downloading them on demand, the Apache-2.0 license and any applicable
notices must be included with that distribution.
