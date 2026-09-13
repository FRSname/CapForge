"""Perf M0 (creator-hub vision §5): the backend half.

Covers the four pipeline-level changes:
  1. CTranslate2 gets every CPU core (whisperx defaults to 4).
  2. The hardware probe runs once per process and hands out copies.
  3. The alignment model stays resident across jobs (per-language cache).
  4. `[perf]` telemetry: one line per step plus a summary with the realtime factor.

Like test_realign.py / test_model_selection.py this never loads a real model:
whisperx is absent on CI's ubuntu job, so a stub module is installed before
importing the transcriber, and every whisperx entry point a test needs is
monkeypatched (so a dev venv with the real whisperx is left untouched).
"""

import logging
import os
import sys
import types

import pytest


def _ensure_stub_module(name: str) -> types.ModuleType:
    """Create an empty stand-in only when the real package is absent."""
    module = sys.modules.get(name)
    if module is None:
        module = types.ModuleType(name)
        sys.modules[name] = module
    return module


def _install_fake_huggingface_hub() -> None:
    """transcriber.py imports two names from huggingface_hub at import time."""
    hub = _ensure_stub_module("huggingface_hub")
    if not hasattr(hub, "snapshot_download"):
        hub.snapshot_download = lambda *a, **kw: "/hf-cache/default"
    if "huggingface_hub.errors" not in sys.modules:
        errors = types.ModuleType("huggingface_hub.errors")
        errors.LocalEntryNotFoundError = type(
            "LocalEntryNotFoundError", (Exception,), {}
        )
        sys.modules["huggingface_hub.errors"] = errors


_ensure_stub_module("whisperx")
_install_fake_huggingface_hub()

import backend.engine.hardware as hardware_module  # noqa: E402
import backend.engine.transcriber as transcriber_module  # noqa: E402
from backend.engine.hardware import detect_hardware, reset_hardware_cache  # noqa: E402
from backend.engine.transcriber import (  # noqa: E402
    DEFAULT_CPU_THREADS,
    Transcriber,
)
from backend.models.schemas import (  # noqa: E402
    ComputeType,
    DeviceType,
    ModelSize,
    SystemInfo,
    TranscribeRequest,
)

ALIGNED_RESULT = {
    "segments": [
        {
            "start": 0.0,
            "end": 2.0,
            "text": "hi there",
            "words": [
                {"word": "hi", "start": 0.0, "end": 1.0},
                {"word": "there", "start": 1.0, "end": 2.0},
            ],
        }
    ]
}

# 2 s of 16 kHz mono audio — the sample count the [perf] rtf is derived from.
FAKE_AUDIO = [0.0] * 32_000


@pytest.fixture(autouse=True)
def _clean_hardware_cache():
    """The probe is process-wide; never leak one test's stub into the next."""
    reset_hardware_cache()
    yield
    reset_hardware_cache()


@pytest.fixture
def audio_file(tmp_path):
    p = tmp_path / "audio.wav"
    p.write_bytes(b"\x00" * 64)
    return str(p)


@pytest.fixture
def cpu_hardware(monkeypatch):
    hw = SystemInfo(
        recommended_device=DeviceType.CPU,
        recommended_compute_type=ComputeType.INT8,
        recommended_model=ModelSize.LARGE_V3_TURBO,
    )
    monkeypatch.setattr(transcriber_module, "detect_hardware", lambda: hw)
    return hw


class _FakeWhisperModel:
    def transcribe(self, audio, **kwargs):
        return {"language": "en", "segments": [{"start": 0.0, "end": 2.0, "text": "hi there"}]}


@pytest.fixture
def whisperx_stub(monkeypatch):
    """Patch just the whisperx entry points the pipeline calls, and count loads."""
    wx = sys.modules["whisperx"]
    calls = {"load_align_model": 0}

    def fake_load_align_model(language_code=None, device=None, **kw):
        calls["load_align_model"] += 1
        return f"MODEL:{language_code}", {"language": language_code}

    monkeypatch.setattr(wx, "load_audio", lambda path, sr=16000: FAKE_AUDIO, raising=False)
    monkeypatch.setattr(wx, "load_align_model", fake_load_align_model, raising=False)
    monkeypatch.setattr(wx, "align", lambda *a, **kw: dict(ALIGNED_RESULT), raising=False)
    return calls


def _stubbed_transcriber(monkeypatch) -> Transcriber:
    """A Transcriber whose model is already 'loaded' (no _load_model work)."""
    t = Transcriber()
    t._model = _FakeWhisperModel()
    monkeypatch.setattr(t, "_load_model", lambda *a, **kw: None)
    return t


# --- 1. CPU threads ------------------------------------------------------


def test_load_model_passes_every_cpu_core_as_threads(monkeypatch):
    """whisperx 3.8.6 hardcodes threads=4; the machine usually has more."""
    captured = {}

    def fake_load_model(model_size, device, **kwargs):
        captured["model_size"] = model_size
        captured["device"] = device
        captured["kwargs"] = kwargs
        return _FakeWhisperModel()

    monkeypatch.setattr(
        sys.modules["whisperx"], "load_model", fake_load_model, raising=False
    )
    Transcriber()._load_model("small", "cpu", "int8")

    assert captured["model_size"] == "small"
    assert captured["device"] == "cpu"
    assert captured["kwargs"]["threads"] == os.cpu_count()
    assert captured["kwargs"]["compute_type"] == "int8"


def test_load_model_falls_back_when_cpu_count_is_unknown(monkeypatch):
    captured = {}
    monkeypatch.setattr(os, "cpu_count", lambda: None)
    monkeypatch.setattr(
        sys.modules["whisperx"],
        "load_model",
        lambda m, d, **kw: captured.update(kw) or _FakeWhisperModel(),
        raising=False,
    )

    Transcriber()._load_model("small", "cpu", "int8")

    assert captured["threads"] == DEFAULT_CPU_THREADS


# --- 2. Cached hardware probe -------------------------------------------


def _count_probes(monkeypatch) -> dict:
    calls = {"n": 0}

    def probe() -> SystemInfo:
        calls["n"] += 1
        return SystemInfo(gpu_name="Fake Chip")

    monkeypatch.setattr(hardware_module, "_detect_hardware_uncached", probe)
    reset_hardware_cache()
    return calls


def test_hardware_probe_runs_once_for_repeated_calls(monkeypatch):
    calls = _count_probes(monkeypatch)

    first = detect_hardware()
    second = detect_hardware()

    assert calls["n"] == 1
    assert first == second


def test_detect_hardware_hands_out_copies_not_the_cached_object(monkeypatch):
    """SystemInfo is mutable; a caller must not be able to poison the cache."""
    _count_probes(monkeypatch)

    first = detect_hardware()
    first.gpu_name = "mutated by a caller"
    second = detect_hardware()

    assert first is not second
    assert second.gpu_name == "Fake Chip"


def test_reset_hardware_cache_forces_a_fresh_probe(monkeypatch):
    calls = _count_probes(monkeypatch)

    detect_hardware()
    reset_hardware_cache()
    detect_hardware()

    assert calls["n"] == 2


def test_detect_hardware_exposes_cache_clear(monkeypatch):
    calls = _count_probes(monkeypatch)

    detect_hardware()
    detect_hardware.cache_clear()
    detect_hardware()

    assert calls["n"] == 2


# --- 3. Resident alignment model ----------------------------------------


def test_alignment_model_is_loaded_once_across_jobs(
    monkeypatch, audio_file, cpu_hardware, whisperx_stub
):
    """Step 3 now uses the per-language cache realign_segments already had."""
    t = _stubbed_transcriber(monkeypatch)
    request = TranscribeRequest(audio_path=audio_file)

    t.transcribe(request)
    t.transcribe(request)

    assert whisperx_stub["load_align_model"] == 1
    assert t._align_model == "MODEL:en"


def test_a_new_language_reloads_the_alignment_model(
    monkeypatch, audio_file, cpu_hardware, whisperx_stub
):
    t = _stubbed_transcriber(monkeypatch)
    t.transcribe(TranscribeRequest(audio_path=audio_file))
    t._model = type(
        "_Other", (), {"transcribe": lambda self, audio, **kw: {"language": "lt", "segments": []}}
    )()

    t.transcribe(TranscribeRequest(audio_path=audio_file))

    assert whisperx_stub["load_align_model"] == 2
    assert t._align_lang == "lt"


def test_unload_model_still_frees_the_resident_alignment_model(
    monkeypatch, audio_file, cpu_hardware, whisperx_stub
):
    t = _stubbed_transcriber(monkeypatch)
    t.transcribe(TranscribeRequest(audio_path=audio_file))

    t.unload_model()

    assert t._align_model is None
    assert t._align_lang is None


def test_alignment_failure_still_degrades_to_approximate_timings(
    monkeypatch, audio_file, cpu_hardware, whisperx_stub
):
    """The fallback path must survive the switch to the cached loader."""
    def boom(*a, **kw):
        raise RuntimeError("no aligner for this language")

    monkeypatch.setattr(sys.modules["whisperx"], "load_align_model", boom, raising=False)
    t = _stubbed_transcriber(monkeypatch)

    result = t.transcribe(TranscribeRequest(audio_path=audio_file))

    assert result.alignment_degraded is True
    assert [w.word for w in result.segments[0].words] == ["hi", "there"]


# --- 4. [perf] telemetry -------------------------------------------------


def _perf_lines(caplog) -> list[str]:
    return [
        r.getMessage() for r in caplog.records if r.getMessage().startswith("[perf] ")
    ]


def test_transcribe_emits_a_perf_summary_with_total_and_rtf(
    monkeypatch, audio_file, cpu_hardware, whisperx_stub, caplog
):
    t = _stubbed_transcriber(monkeypatch)

    with caplog.at_level(logging.INFO, logger="backend.engine.transcriber"):
        t.transcribe(TranscribeRequest(audio_path=audio_file))

    summary = [line for line in _perf_lines(caplog) if "job=transcribe model=" in line]
    assert len(summary) == 1, _perf_lines(caplog)
    line = summary[0]
    assert "model=large-v3-turbo" in line
    assert "device=cpu" in line
    assert "compute=int8" in line
    # 32 000 samples at 16 kHz — derived from the audio array, not the segments.
    assert "audio_s=2.0" in line
    for field in ("load_ms=", "transcribe_ms=", "align_ms=", "diarize_ms=", "total_ms=", "rtf="):
        assert field in line


def test_transcribe_emits_one_perf_line_per_step(
    monkeypatch, audio_file, cpu_hardware, whisperx_stub, caplog
):
    t = _stubbed_transcriber(monkeypatch)

    with caplog.at_level(logging.INFO, logger="backend.engine.transcriber"):
        t.transcribe(TranscribeRequest(audio_path=audio_file))

    lines = _perf_lines(caplog)
    for step in ("load_model", "transcribe", "align", "diarize"):
        assert any(
            line.startswith(f"[perf] job=transcribe step={step} ms=") for line in lines
        ), f"missing step line for {step}: {lines}"


def test_perf_rtf_falls_back_to_segment_ends_without_a_sample_count(
    monkeypatch, audio_file, cpu_hardware, whisperx_stub, caplog
):
    """whisperx normally hands us an array; anything else uses the transcript."""
    monkeypatch.setattr(
        sys.modules["whisperx"], "load_audio", lambda path, sr=16000: "AUDIO", raising=False
    )
    t = _stubbed_transcriber(monkeypatch)

    with caplog.at_level(logging.INFO, logger="backend.engine.transcriber"):
        t.transcribe(TranscribeRequest(audio_path=audio_file))

    summary = [line for line in _perf_lines(caplog) if "job=transcribe model=" in line]
    assert "audio_s=2.0" in summary[0]
