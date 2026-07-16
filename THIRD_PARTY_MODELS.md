# Third-party models

CapForge downloads model weights from their publishers when a feature first
needs them. The weights are not part of this repository.

## Lithuanian WhisperX alignment

- Model: [`m3hrdadfi/wav2vec2-large-xlsr-lithuanian`](https://huggingface.co/m3hrdadfi/wav2vec2-large-xlsr-lithuanian)
- Purpose: Lithuanian CTC forced alignment for word-level timings
- Architecture: `Wav2Vec2ForCTC` with `Wav2Vec2Processor`, compatible with
  WhisperX's custom `model_name` alignment-model loader
- Training data: Mozilla Common Voice Lithuanian
- License: [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)

Apache-2.0 permits use, modification, and distribution alongside CapForge's
MIT-licensed code. If CapForge begins redistributing the model weights instead
of downloading them on demand, the Apache-2.0 license and any applicable
notices must be included with that distribution.
