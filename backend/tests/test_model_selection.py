"""Tests for explicit Whisper model selection on TranscribeRequest.

Mirrors test_realign.py's fake-whisperx setup: whisperx is not installed in the
dev venv, so a stub module is injected before importing the transcriber. These
tests never load a real model — `_load_model` is monkeypatched and the tests
assert on the model name it was handed.
"""

import sys
import types

import pytest


def _install_fake_whisperx() -> types.ModuleType:
    fake = sys.modules.get("whisperx")
    if fake is None:
        fake = types.ModuleType("whisperx")
        sys.modules["whisperx"] = fake
    fake.load_audio = lambda path, sr=16000: "AUDIO"
    fake.load_align_model = lambda language_code, device, **kw: (
        f"MODEL:{language_code}",
        {"language": language_code},
    )
    fake.align = lambda *a, **kw: {"segments": []}
    return fake


def _install_fake_huggingface_hub() -> None:
    if "huggingface_hub" in sys.modules:
        return
    fake_hub = types.ModuleType("huggingface_hub")
    fake_errors = types.ModuleType("huggingface_hub.errors")

    class FakeLocalEntryNotFoundError(Exception):
        pass

    fake_hub.snapshot_download = lambda *args, **kwargs: "/hf-cache/default"
    fake_errors.LocalEntryNotFoundError = FakeLocalEntryNotFoundError
    sys.modules["huggingface_hub"] = fake_hub
    sys.modules["huggingface_hub.errors"] = fake_errors


_install_fake_whisperx()
_install_fake_huggingface_hub()

import backend.engine.transcriber as transcriber_module  # noqa: E402
from backend.engine.transcriber import Transcriber  # noqa: E402
from backend.models.schemas import (  # noqa: E402
    ComputeType,
    DeviceType,
    ModelSize,
    SystemInfo,
    TranscribeRequest,
)


@pytest.fixture
def audio_file(tmp_path):
    p = tmp_path / "audio.wav"
    p.write_bytes(b"\x00" * 64)
    return str(p)


class _FakeWhisperModel:
    def transcribe(self, audio, **kwargs):
        return {"language": "en", "segments": []}


def _run(monkeypatch, audio_file, request, recommended=ModelSize.LARGE_V3_TURBO):
    """Run transcribe() with everything stubbed; return the _load_model args."""
    hw = SystemInfo(
        recommended_device=DeviceType.CPU,
        recommended_compute_type=ComputeType.INT8,
        recommended_model=recommended,
    )
    monkeypatch.setattr(transcriber_module, "detect_hardware", lambda: hw)

    transcriber = Transcriber()
    transcriber._model = _FakeWhisperModel()
    captured = {}

    def fake_load_model(model_size, device, compute_type, on_progress=None):
        captured["model_size"] = model_size
        captured["device"] = device
        captured["compute_type"] = compute_type

    monkeypatch.setattr(transcriber, "_load_model", fake_load_model)
    transcriber.transcribe(request)
    return captured


def test_no_model_falls_back_to_hardware_recommendation(monkeypatch, audio_file):
    captured = _run(
        monkeypatch,
        audio_file,
        TranscribeRequest(audio_path=audio_file),
        recommended=ModelSize.LARGE_V3_TURBO,
    )
    assert captured["model_size"] == "large-v3-turbo"


def test_explicit_model_overrides_hardware_recommendation(monkeypatch, audio_file):
    captured = _run(
        monkeypatch,
        audio_file,
        TranscribeRequest(audio_path=audio_file, model=ModelSize.TINY),
        recommended=ModelSize.LARGE_V3_TURBO,
    )
    assert captured["model_size"] == "tiny"


@pytest.mark.parametrize("size", ["tiny", "base", "small", "large-v3-turbo"])
def test_every_ui_exposed_model_round_trips(monkeypatch, audio_file, size):
    """The four sizes the Settings dropdown offers must survive the enum."""
    captured = _run(
        monkeypatch,
        audio_file,
        TranscribeRequest(audio_path=audio_file, model=size),
    )
    assert captured["model_size"] == size


def test_explicit_model_does_not_change_device_or_compute_type(monkeypatch, audio_file):
    """Picking a smaller model must not downgrade the hardware fast path."""
    captured = _run(
        monkeypatch,
        audio_file,
        TranscribeRequest(audio_path=audio_file, model=ModelSize.TINY),
    )
    assert captured["device"] == "cpu"
    assert captured["compute_type"] == "int8"


def test_unknown_model_is_rejected_at_the_boundary(audio_file):
    with pytest.raises(ValueError):
        TranscribeRequest(audio_path=audio_file, model="ludicrous-v9")
