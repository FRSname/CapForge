"""Tests for Transcriber.realign_segments and POST /api/realign.

whisperx is not installed in the dev venv — a fake module is injected into
sys.modules before importing the transcriber, and each test drives the fake's
align() return value. Real-audio alignment is exercised manually in the app.
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


FAKE_WX = _install_fake_whisperx()

import backend.engine.transcriber as transcriber_module  # noqa: E402
from backend.engine.transcriber import ALIGNMENT_MODELS, Transcriber  # noqa: E402
from backend.models.schemas import (  # noqa: E402
    JobStatus,
    ProgressUpdate,
    RealignResponse,
    Segment,
    SystemInfo,
    TranscribeRequest,
    TranscriptionResult,
    WordSegment,
)


# --- _fill_word_timings (pure interpolation logic) ---


def test_fill_word_timings_passthrough_when_all_timed():
    words = Transcriber._fill_word_timings(
        [
            {"word": "Hello", "start": 0.0, "end": 0.5, "score": 0.9},
            {"word": "world", "start": 0.5, "end": 1.0, "score": 0.8},
        ],
        seg_start=0.0,
        seg_end=1.2,
    )
    assert [w.word for w in words] == ["Hello", "world"]
    assert words[0].start == 0.0 and words[0].end == 0.5
    assert words[1].start == 0.5 and words[1].end == 1.0
    assert words[0].score == 0.9


def test_fill_word_timings_interpolates_untimed_run():
    words = Transcriber._fill_word_timings(
        [
            {"word": "at", "start": 1.0, "end": 1.5},
            {"word": "10"},  # digits: not in the phoneme dictionary
            {"word": "45"},
            {"word": "sharp", "start": 3.5, "end": 4.0},
        ],
        seg_start=0.0,
        seg_end=5.0,
    )
    # The 1.5 → 3.5 gap is split evenly between the two untimed words.
    assert words[1].start == pytest.approx(1.5)
    assert words[1].end == pytest.approx(2.5)
    assert words[2].start == pytest.approx(2.5)
    assert words[2].end == pytest.approx(3.5)


def test_fill_word_timings_all_untimed_distributes_evenly():
    words = Transcriber._fill_word_timings(
        [{"word": "a"}, {"word": "b"}, {"word": "c"}, {"word": "d"}],
        seg_start=2.0,
        seg_end=4.0,
    )
    assert words[0].start == pytest.approx(2.0)
    assert words[1].start == pytest.approx(2.5)
    assert words[3].end == pytest.approx(4.0)
    # Contiguous coverage
    for prev, nxt in zip(words, words[1:]):
        assert prev.end == pytest.approx(nxt.start)


def test_fill_word_timings_degenerate_gap_gets_min_duration():
    # Neighbors leave no room: prev ends where next starts.
    words = Transcriber._fill_word_timings(
        [
            {"word": "x", "start": 1.0, "end": 2.0},
            {"word": "new"},
            {"word": "y", "start": 2.0, "end": 3.0},
        ],
        seg_start=1.0,
        seg_end=3.0,
    )
    assert words[1].start == pytest.approx(2.0)
    assert words[1].end == pytest.approx(2.04)


def test_fill_word_timings_empty_input():
    assert Transcriber._fill_word_timings([], 0.0, 1.0) == []


# --- realign_segments orchestration (fake whisperx) ---


@pytest.fixture
def audio_file(tmp_path):
    p = tmp_path / "audio.wav"
    p.write_bytes(b"\x00" * 64)
    return str(p)


def test_realign_merges_subsegments_into_one(monkeypatch, audio_file):
    # align() sentence-splits one input segment into two subsegments —
    # realign must merge the words back into a single Segment.
    monkeypatch.setattr(
        FAKE_WX,
        "align",
        lambda transcript, *a, **kw: {
            "segments": [
                {
                    "start": 0.0,
                    "end": 1.0,
                    "text": "Hello there.",
                    "words": [
                        {"word": "Hello", "start": 0.0, "end": 0.4, "score": 0.9},
                        {"word": "there.", "start": 0.4, "end": 1.0, "score": 0.8},
                    ],
                },
                {
                    "start": 1.2,
                    "end": 2.0,
                    "text": "Bye.",
                    "words": [{"word": "Bye.", "start": 1.2, "end": 2.0, "score": 0.7}],
                },
            ]
        },
    )
    t = Transcriber()
    seg = Segment(start=0.0, end=2.0, text="Hello there. Bye.", speaker="SPEAKER_00")
    out = t.realign_segments([seg], audio_file, "en")

    assert out.alignment_degraded is False
    assert len(out.segments) == 1
    assert out.segments[0].text == "Hello there. Bye."
    assert out.segments[0].speaker == "SPEAKER_00"
    assert [w.word for w in out.segments[0].words] == ["Hello", "there.", "Bye."]
    assert out.segments[0].start == 0.0 and out.segments[0].end == 2.0


def test_realign_failed_alignment_falls_back_to_even_spacing(monkeypatch, audio_file):
    monkeypatch.setattr(
        FAKE_WX,
        "align",
        lambda *a, **kw: {
            "segments": [{"start": 0.0, "end": 2.0, "text": "10 45", "words": []}]
        },
    )
    t = Transcriber()
    seg = Segment(start=0.0, end=2.0, text="10 45")
    out = t.realign_segments([seg], audio_file, "en")

    assert out.alignment_degraded is True
    assert [w.word for w in out.segments[0].words] == ["10", "45"]
    assert out.segments[0].words[0].start == pytest.approx(0.0)
    assert out.segments[0].words[0].end == pytest.approx(1.0)
    assert out.segments[0].words[1].end == pytest.approx(2.0)


def test_realign_interpolated_words_are_marked_degraded(monkeypatch, audio_file):
    monkeypatch.setattr(
        FAKE_WX,
        "align",
        lambda *args, **kwargs: {
            "segments": [{
                "words": [
                    {"word": "Labas", "start": 0.0, "end": 0.8},
                    {"word": "10"},
                ]
            }]
        },
    )
    t = Transcriber()

    out = t.realign_segments(
        [Segment(start=0.0, end=2.0, text="Labas 10")], audio_file, "lt"
    )

    assert out.alignment_degraded is True
    assert out.segments[0].words[1].start == pytest.approx(0.8)
    assert out.segments[0].words[1].end == pytest.approx(2.0)


def test_realign_empty_text_returns_segment_unchanged(monkeypatch, audio_file):
    def _boom(*a, **kw):
        raise AssertionError("align must not be called for empty text")

    monkeypatch.setattr(FAKE_WX, "align", _boom)
    t = Transcriber()
    seg = Segment(start=1.0, end=2.0, text="   ")
    out = t.realign_segments([seg], audio_file, "en")
    assert out.alignment_degraded is False
    assert out.segments[0] is seg


def test_realign_model_load_failure_uses_flagged_approximate_timings(
    monkeypatch, audio_file
):
    monkeypatch.setattr(
        FAKE_WX,
        "load_align_model",
        lambda **kwargs: (_ for _ in ()).throw(RuntimeError("model unavailable")),
    )
    t = Transcriber()

    out = t.realign_segments(
        [Segment(start=0.0, end=2.0, text="Labas rytas")], audio_file, "lt"
    )

    assert out.alignment_degraded is True
    assert [word.word for word in out.segments[0].words] == ["Labas", "rytas"]
    assert out.segments[0].words[0].end == pytest.approx(1.0)


def test_realign_alignment_error_is_not_hidden_by_fallback(monkeypatch, audio_file):
    monkeypatch.setattr(
        FAKE_WX,
        "align",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("alignment bug")),
    )
    t = Transcriber()

    with pytest.raises(RuntimeError, match="alignment bug"):
        t.realign_segments(
            [Segment(start=0.0, end=1.0, text="Labas")], audio_file, "lt"
        )


def test_realign_missing_audio_raises():
    t = Transcriber()
    with pytest.raises(FileNotFoundError):
        t.realign_segments(
            [Segment(start=0.0, end=1.0, text="hi")], "/nope/missing.wav", "en"
        )


def test_align_model_cached_per_language(monkeypatch, audio_file):
    loads: list[str] = []

    def fake_load(language_code, device, **kw):
        loads.append(language_code)
        return (f"MODEL:{language_code}", {"language": language_code})

    monkeypatch.setattr(FAKE_WX, "load_align_model", fake_load)
    monkeypatch.setattr(
        FAKE_WX,
        "align",
        lambda *a, **kw: {
            "segments": [
                {
                    "start": 0.0,
                    "end": 1.0,
                    "text": "hi",
                    "words": [{"word": "hi", "start": 0.0, "end": 1.0}],
                }
            ]
        },
    )
    t = Transcriber()
    seg = Segment(start=0.0, end=1.0, text="hi")
    t.realign_segments([seg], audio_file, "en")
    t.realign_segments([seg], audio_file, "en")
    assert loads == ["en"]  # second call reuses the cache

    t.realign_segments([seg], audio_file, "de")
    assert loads == ["en", "de"]

    t.unload_model()
    t.realign_segments([seg], audio_file, "de")
    assert loads == ["en", "de", "de"]  # unload cleared the cache


def test_lithuanian_selects_configured_alignment_model(monkeypatch):
    calls: list[dict] = []

    def fake_load(**kwargs):
        calls.append(kwargs)
        return "MODEL", {}

    monkeypatch.setattr(FAKE_WX, "load_align_model", fake_load)
    Transcriber._load_alignment_model("lt", "cpu")

    assert calls == [{
        "language_code": "lt",
        "device": "cpu",
        "model_name": ALIGNMENT_MODELS["lt"],
    }]


def test_english_uses_whisperx_default_alignment_model(monkeypatch):
    calls: list[dict] = []

    def fake_load(**kwargs):
        calls.append(kwargs)
        return "MODEL", {}

    monkeypatch.setattr(FAKE_WX, "load_align_model", fake_load)
    Transcriber._load_alignment_model("en", "cpu")

    assert calls == [{"language_code": "en", "device": "cpu"}]


def test_alignment_load_failure_preserves_transcription_with_approximate_words(
    monkeypatch, audio_file
):
    class FakeWhisperModel:
        def transcribe(self, audio, **kwargs):
            return {
                "language": "lt",
                "segments": [
                    {"start": 1.0, "end": 3.0, "text": "Labas rytas"},
                ],
            }

    def fail_load(**kwargs):
        raise RuntimeError("aligner download failed")

    monkeypatch.setattr(FAKE_WX, "load_align_model", fail_load)
    monkeypatch.setattr(
        transcriber_module, "detect_hardware", lambda: SystemInfo()
    )
    transcriber = Transcriber()
    transcriber._model = FakeWhisperModel()
    monkeypatch.setattr(transcriber, "_load_model", lambda *args, **kwargs: None)
    progress: list[ProgressUpdate] = []

    result = transcriber.transcribe(
        TranscribeRequest(audio_path=audio_file, language="lt"),
        on_progress=progress.append,
    )

    assert result.language == "lt"
    assert result.alignment_degraded is True
    assert [segment.text for segment in result.segments] == ["Labas rytas"]
    assert [word.word for word in result.segments[0].words] == ["Labas", "rytas"]
    assert result.segments[0].words[0].start == pytest.approx(1.0)
    assert result.segments[0].words[0].end == pytest.approx(2.0)
    assert result.segments[0].words[1].end == pytest.approx(3.0)
    assert any(
        "approximate word timings" in update.message for update in progress
    )


def test_realign_lithuanian_uses_configured_alignment_model(
    monkeypatch, audio_file
):
    calls: list[dict] = []

    def fake_load(**kwargs):
        calls.append(kwargs)
        return "LT_MODEL", {"language": "lt"}

    monkeypatch.setattr(FAKE_WX, "load_align_model", fake_load)
    monkeypatch.setattr(
        FAKE_WX,
        "align",
        lambda *args, **kwargs: {
            "segments": [{
                "words": [{"word": "Labas", "start": 0.0, "end": 1.0}]
            }]
        },
    )

    transcriber = Transcriber()
    transcriber._device = "cpu"
    transcriber.realign_segments(
        [Segment(start=0.0, end=1.0, text="Labas")], audio_file, "lt"
    )

    assert calls == [{
        "language_code": "lt",
        "device": "cpu",
        "model_name": ALIGNMENT_MODELS["lt"],
    }]


# --- POST /api/realign endpoint ---


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    import backend.main as main_module

    # No context manager: skip startup/shutdown (agent discovery file IO).
    return TestClient(main_module.app), main_module


def _loaded_result(audio_file: str) -> TranscriptionResult:
    return TranscriptionResult(
        segments=[
            Segment(
                start=0.0,
                end=1.0,
                text="hello",
                words=[WordSegment(word="hello", start=0.0, end=1.0)],
            )
        ],
        language="en",
        audio_path=audio_file,
    )


def test_endpoint_400_when_no_result(client, monkeypatch):
    tc, main_module = client
    monkeypatch.setattr(main_module, "current_result", None)
    resp = tc.post(
        "/api/realign",
        json={"segments": [{"start": 0.0, "end": 1.0, "text": "hi", "words": []}]},
    )
    assert resp.status_code == 400


def test_endpoint_400_when_audio_missing(client, monkeypatch):
    tc, main_module = client
    monkeypatch.setattr(
        main_module, "current_result", _loaded_result("/nope/gone.wav")
    )
    resp = tc.post(
        "/api/realign",
        json={"segments": [{"start": 0.0, "end": 1.0, "text": "hi", "words": []}]},
    )
    assert resp.status_code == 400


def test_endpoint_409_while_job_running(client, monkeypatch, audio_file):
    tc, main_module = client
    monkeypatch.setattr(main_module, "current_result", _loaded_result(audio_file))
    monkeypatch.setattr(
        main_module,
        "current_status",
        ProgressUpdate(status=JobStatus.TRANSCRIBING, progress=50, message="busy"),
    )
    resp = tc.post(
        "/api/realign",
        json={"segments": [{"start": 0.0, "end": 1.0, "text": "hi", "words": []}]},
    )
    assert resp.status_code == 409


def test_endpoint_422_on_empty_segments(client, monkeypatch, audio_file):
    tc, main_module = client
    monkeypatch.setattr(main_module, "current_result", _loaded_result(audio_file))
    resp = tc.post("/api/realign", json={"segments": []})
    assert resp.status_code == 422


def test_endpoint_400_when_no_language(client, monkeypatch, audio_file):
    tc, main_module = client
    result = _loaded_result(audio_file)
    result.language = None
    monkeypatch.setattr(main_module, "current_result", result)
    resp = tc.post(
        "/api/realign",
        json={"segments": [{"start": 0.0, "end": 1.0, "text": "hi", "words": []}]},
    )
    assert resp.status_code == 400


def test_endpoint_success_is_stateless(client, monkeypatch, audio_file):
    tc, main_module = client
    stored = _loaded_result(audio_file)
    monkeypatch.setattr(main_module, "current_result", stored)

    realigned = [
        Segment(
            start=0.1,
            end=0.9,
            text="hi there",
            words=[
                WordSegment(word="hi", start=0.1, end=0.5),
                WordSegment(word="there", start=0.5, end=0.9),
            ],
        )
    ]
    calls: list[tuple] = []

    def fake_realign(segments, audio_path, language):
        calls.append((len(segments), audio_path, language))
        return RealignResponse(segments=realigned)

    monkeypatch.setattr(main_module.transcriber, "realign_segments", fake_realign)

    resp = tc.post(
        "/api/realign",
        json={
            "segments": [{"start": 0.0, "end": 1.0, "text": "hi there", "words": []}]
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["alignment_degraded"] is False
    assert [w["word"] for w in body["segments"][0]["words"]] == ["hi", "there"]
    # Audio path came from the stored result, not the request.
    assert calls == [(1, audio_file, "en")]
    # Stateless: the stored result was not replaced.
    assert main_module.current_result is stored
    assert main_module.current_result.segments[0].text == "hello"


def test_endpoint_language_override(client, monkeypatch, audio_file):
    tc, main_module = client
    monkeypatch.setattr(main_module, "current_result", _loaded_result(audio_file))
    seen: list[str] = []

    def fake_realign(segments, audio_path, language):
        seen.append(language)
        return RealignResponse(segments=segments)

    monkeypatch.setattr(main_module.transcriber, "realign_segments", fake_realign)
    resp = tc.post(
        "/api/realign",
        json={
            "segments": [{"start": 0.0, "end": 1.0, "text": "hi", "words": []}],
            "language": "de",
        },
    )
    assert resp.status_code == 200
    assert seen == ["de"]


def test_endpoint_marks_stored_result_when_realign_is_degraded(
    client, monkeypatch, audio_file
):
    tc, main_module = client
    stored = _loaded_result(audio_file)
    monkeypatch.setattr(main_module, "current_result", stored)
    approximate = Segment(
        start=0.0,
        end=1.0,
        text="Labas",
        words=[WordSegment(word="Labas", start=0.0, end=1.0)],
    )
    monkeypatch.setattr(
        main_module.transcriber,
        "realign_segments",
        lambda *args: RealignResponse(
            segments=[approximate], alignment_degraded=True
        ),
    )

    resp = tc.post(
        "/api/realign",
        json={"segments": [{"start": 0.0, "end": 1.0, "text": "Labas"}]},
    )

    assert resp.status_code == 200
    assert resp.json()["alignment_degraded"] is True
    assert main_module.current_result is stored
    assert stored.alignment_degraded is True


def test_endpoint_returns_500_for_alignment_errors(client, monkeypatch, audio_file):
    tc, main_module = client
    monkeypatch.setattr(main_module, "current_result", _loaded_result(audio_file))
    monkeypatch.setattr(
        main_module.transcriber,
        "realign_segments",
        lambda *args: (_ for _ in ()).throw(RuntimeError("alignment bug")),
    )

    resp = tc.post(
        "/api/realign",
        json={"segments": [{"start": 0.0, "end": 1.0, "text": "Labas"}]},
    )

    assert resp.status_code == 500
    assert resp.json()["detail"]["raw"] == "alignment bug"
