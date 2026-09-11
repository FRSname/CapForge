"""Warm-on-drop (`Transcriber.warm` + `POST /api/warm`) and `release_model_after`.

The Whisper model load is ~6.7 s and today it sits on the critical path of the
first Start. `warm()` moves it to the moment the user drops a file; the route is
deliberately invisible to the job state machine (no `current_status`, no
progress broadcast) and simply reports `busy` when a job is already running.

No real model is ever loaded: whisperx is stubbed exactly as in
test_model_selection.py, because CI's ubuntu job has no whisperx installed.
"""

from __future__ import annotations

import sys
import types

import pytest
from fastapi.testclient import TestClient


def _ensure_stub_module(name: str) -> types.ModuleType:
    module = sys.modules.get(name)
    if module is None:
        module = types.ModuleType(name)
        sys.modules[name] = module
    return module


def _install_fake_huggingface_hub() -> None:
    hub = _ensure_stub_module("huggingface_hub")
    if not hasattr(hub, "snapshot_download"):
        hub.snapshot_download = lambda *a, **kw: "/hf-cache/default"
    if "huggingface_hub.errors" not in sys.modules:
        errors = types.ModuleType("huggingface_hub.errors")
        errors.LocalEntryNotFoundError = type(
            "LocalEntryNotFoundError", (Exception,), {}
        )
        sys.modules["huggingface_hub.errors"] = errors


# Only whisperx is stubbed: a stand-in `torch` module would be visible to every
# other test module in the session (collection imports them all up front) and
# hardware.py's probe only tolerates a *missing* torch, not a hollow one.
_ensure_stub_module("whisperx")
_install_fake_huggingface_hub()

import backend.engine.transcriber as transcriber_module  # noqa: E402
from backend.engine.hardware import reset_hardware_cache  # noqa: E402
from backend.engine.transcriber import Transcriber  # noqa: E402
from backend.models.schemas import (  # noqa: E402
    ComputeType,
    DeviceType,
    JobStatus,
    ModelSize,
    ProgressUpdate,
    Segment,
    SystemInfo,
    TranscribeRequest,
    TranscriptionResult,
    WarmRequest,
)


@pytest.fixture(autouse=True)
def _clean_hardware_cache():
    reset_hardware_cache()
    yield
    reset_hardware_cache()


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
        return {"language": "en", "segments": []}


def _capture_loads(monkeypatch, t: Transcriber) -> list[tuple]:
    loads: list[tuple] = []

    def fake_load_model(model_size, device, compute_type, on_progress=None):
        loads.append((model_size, device, compute_type))
        t._model = _FakeWhisperModel()
        t._model_size = model_size

    monkeypatch.setattr(t, "_load_model", fake_load_model)
    return loads


# --- Transcriber.warm ----------------------------------------------------


def test_warm_uses_the_hardware_recommended_model(monkeypatch, cpu_hardware):
    t = Transcriber()
    loads = _capture_loads(monkeypatch, t)

    info = t.warm(None)

    assert loads == [("large-v3-turbo", "cpu", "int8")]
    assert info["model"] == "large-v3-turbo"
    assert info["device"] == "cpu"
    assert isinstance(info["loaded_ms"], int)


def test_warm_honours_an_explicit_model(monkeypatch, cpu_hardware):
    t = Transcriber()
    loads = _capture_loads(monkeypatch, t)

    info = t.warm(ModelSize.TINY)

    assert loads == [("tiny", "cpu", "int8")]
    assert info["model"] == "tiny"


def test_warm_resolves_exactly_like_transcribe(monkeypatch, cpu_hardware, tmp_path):
    """One resolution helper, so a warm can never load a different model than
    the Start that follows it would have."""
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"\x00" * 64)

    warmed = Transcriber()
    warm_loads = _capture_loads(monkeypatch, warmed)
    warmed.warm(ModelSize.SMALL)

    started = Transcriber()
    start_loads = _capture_loads(monkeypatch, started)
    monkeypatch.setattr(
        sys.modules["whisperx"], "load_audio", lambda p, sr=16000: [0.0] * 16_000, raising=False
    )
    monkeypatch.setattr(
        sys.modules["whisperx"],
        "load_align_model",
        lambda language_code=None, device=None, **kw: ("M", {"language": language_code}),
        raising=False,
    )
    monkeypatch.setattr(
        sys.modules["whisperx"], "align", lambda *a, **kw: {"segments": []}, raising=False
    )
    started.transcribe(
        TranscribeRequest(audio_path=str(audio), model=ModelSize.SMALL)
    )

    assert warm_loads == start_loads


def test_warming_twice_loads_the_model_once(monkeypatch, cpu_hardware):
    """The second warm hits _load_model's "already loaded" early return."""
    calls = {"n": 0}

    def fake_load_model(model_size, device, **kwargs):
        calls["n"] += 1
        return _FakeWhisperModel()

    monkeypatch.setattr(
        sys.modules["whisperx"], "load_model", fake_load_model, raising=False
    )
    t = Transcriber()

    t.warm(ModelSize.TINY)
    t.warm(ModelSize.TINY)

    assert calls["n"] == 1


def test_warm_takes_the_load_lock(monkeypatch, cpu_hardware):
    """A Start during a warm must queue behind the load, not race it."""
    t = Transcriber()
    held = {"locked": False}

    def fake_load_model(model_size, device, compute_type, on_progress=None):
        # RLock has no public "is held" probe; acquire(blocking=False) from this
        # same thread succeeds only because the lock is reentrant, so assert on
        # the lock object being the one warm() entered.
        held["locked"] = t._load_lock.acquire(blocking=False)
        if held["locked"]:
            t._load_lock.release()

    monkeypatch.setattr(t, "_load_model", fake_load_model)
    t.warm(None)

    assert held["locked"] is True


# --- POST /api/warm ------------------------------------------------------


@pytest.fixture
def main_module(monkeypatch):
    """backend.main with whisperx stubbed and the hardware probe faked.

    The probe is faked because the app's startup hook pre-warms it, and these
    tests must not import torch or shell out to sysctl.
    """
    import backend.main as m

    monkeypatch.setattr(
        m,
        "detect_hardware",
        lambda: SystemInfo(
            recommended_device=DeviceType.CPU,
            recommended_compute_type=ComputeType.INT8,
            recommended_model=ModelSize.LARGE_V3_TURBO,
        ),
    )
    return m


@pytest.fixture
def idle(main_module, monkeypatch):
    monkeypatch.setattr(
        main_module,
        "current_status",
        ProgressUpdate(status=JobStatus.IDLE, progress=0, message="Ready"),
    )
    return main_module


def test_warm_route_warms_when_idle(idle, monkeypatch):
    calls = []
    monkeypatch.setattr(
        idle.transcriber,
        "warm",
        lambda model=None: calls.append(model)
        or {"model": "tiny", "device": "cpu", "loaded_ms": 12},
    )

    res = TestClient(idle.app).post("/api/warm", json={"model": "tiny"})

    assert res.status_code == 200
    assert res.json() == {
        "status": "warm",
        "model": "tiny",
        "device": "cpu",
        "loaded_ms": 12,
    }
    assert calls == [ModelSize.TINY]


def test_warm_route_accepts_an_empty_body(idle, monkeypatch):
    calls = []
    monkeypatch.setattr(
        idle.transcriber,
        "warm",
        lambda model=None: calls.append(model)
        or {"model": "large-v3-turbo", "device": "cpu", "loaded_ms": 7},
    )

    res = TestClient(idle.app).post("/api/warm", json={})

    assert res.status_code == 200
    assert calls == [None]


@pytest.mark.parametrize(
    "status",
    [JobStatus.LOADING_MODEL, JobStatus.TRANSCRIBING, JobStatus.ALIGNING, JobStatus.RENDERING],
)
def test_warm_route_is_busy_while_a_job_runs(main_module, monkeypatch, status):
    monkeypatch.setattr(
        main_module,
        "current_status",
        ProgressUpdate(status=status, progress=30, message="Working"),
    )

    def explode(model=None):
        raise AssertionError("warm() must not run while a job holds the model")

    monkeypatch.setattr(main_module.transcriber, "warm", explode)

    res = TestClient(main_module.app).post("/api/warm", json={})

    assert res.status_code == 200
    assert res.json() == {"status": "busy"}


def test_warm_route_does_not_touch_job_status(idle, monkeypatch):
    monkeypatch.setattr(
        idle.transcriber,
        "warm",
        lambda model=None: {"model": "tiny", "device": "cpu", "loaded_ms": 1},
    )

    TestClient(idle.app).post("/api/warm", json={"model": "tiny"})

    assert idle.current_status.status == JobStatus.IDLE


def test_warm_route_reports_a_failed_load_as_500(idle, monkeypatch):
    def boom(model=None):
        raise RuntimeError("ctranslate2 exploded")

    monkeypatch.setattr(idle.transcriber, "warm", boom)

    res = TestClient(idle.app).post("/api/warm", json={})

    assert res.status_code == 500
    assert "warm" in res.json()["detail"].lower()
    # The internal error text must not leak to the client.
    assert "ctranslate2" not in res.text


def test_warm_route_rejects_an_unknown_model(idle):
    res = TestClient(idle.app).post("/api/warm", json={"model": "ludicrous-v9"})

    assert res.status_code == 422


def test_warm_request_defaults_to_auto_selection():
    assert WarmRequest().model is None


# --- release_model_after -------------------------------------------------


@pytest.fixture
def stub_job(main_module, monkeypatch, tmp_path):
    """A /api/transcribe run that returns instantly and counts model releases."""
    audio = tmp_path / "clip.wav"
    audio.write_bytes(b"\x00" * 64)
    result = TranscriptionResult(
        segments=[Segment(start=0.0, end=1.0, text="hi", words=[])],
        language="en",
        audio_path=str(audio),
    )
    released = {"n": 0}

    monkeypatch.setattr(
        main_module,
        "current_status",
        ProgressUpdate(status=JobStatus.IDLE, progress=0, message="Ready"),
    )
    monkeypatch.setattr(
        main_module.transcriber, "transcribe", lambda request, on_progress=None: result
    )
    monkeypatch.setattr(
        main_module.transcriber,
        "unload_model",
        lambda: released.__setitem__("n", released["n"] + 1),
    )
    return main_module, str(audio), released


def _transcribe(client, audio_path, **extra):
    return client.post(
        "/api/transcribe",
        json={"audio_path": audio_path, "export_formats": [], **extra},
    )


def test_release_model_after_frees_the_model(stub_job):
    m, audio_path, released = stub_job

    res = _transcribe(TestClient(m.app), audio_path, release_model_after=True)

    assert res.status_code == 200
    assert res.json()["status"] == "ok"
    assert released["n"] == 1


def test_the_model_stays_resident_by_default(stub_job):
    m, audio_path, released = stub_job

    res = _transcribe(TestClient(m.app), audio_path)

    assert res.status_code == 200
    assert released["n"] == 0


def test_release_model_after_also_runs_when_the_job_fails(stub_job, monkeypatch):
    """The user asked for the memory back either way."""
    m, audio_path, released = stub_job

    def boom(request, on_progress=None):
        raise RuntimeError("transcription blew up")

    monkeypatch.setattr(m.transcriber, "transcribe", boom)

    res = _transcribe(TestClient(m.app), audio_path, release_model_after=True)

    assert res.status_code == 500
    assert released["n"] == 1


def test_release_model_after_defaults_to_false():
    assert TranscribeRequest(audio_path="/tmp/a.wav").release_model_after is False
