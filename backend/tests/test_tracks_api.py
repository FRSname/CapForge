"""Phase 4 — the backend side of multi-language caption tracks.

The backend owns **no** track state: a track is a named bundle of (settings +
groups) the renderer mirrors through ``PUT /api/ui-state``. Everything pinned
here is either a *read* of that mirror selected by ``track_id``, a *validation*
of a client-supplied value, or a mechanical measurement of what the renderer
already decided. No classify/bake/reflow rule lives in Python.

See docs/plans/multi-language-caption-tracks-plan.md → Phase 4.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.exporters.layout_scan import scan_layout
from backend.exporters.video_render import _get_font, groups_for_render
from backend.models.schemas import (
    Segment,
    TranscriptionResult,
    VideoRenderConfig,
    WordSegment,
)

AGENT_HEADER = "X-CapForge-Agent-Token"
AGENT_TOKEN = "test-agent-token-tracks"
LOCAL_HEADER = "X-CapForge-Local-Token"
LOCAL_TOKEN = "test-local-token-tracks"

# Distinctive enough that no default can produce it by accident.
SOURCE_FONT_SIZE = 64
TRACK_FONT_SIZE = 111


@pytest.fixture
def main_module():
    """Import backend.main with heavy ML deps stubbed (dev venv lacks whisperx)."""
    inserted = []
    for name in ("whisperx", "torch", "torchaudio"):
        if name not in sys.modules:
            sys.modules[name] = types.ModuleType(name)
            inserted.append(name)
    import backend.main as m

    yield m

    for name in inserted:
        sys.modules.pop(name, None)


@pytest.fixture
def source_audio(tmp_path):
    """A real on-disk file to stand in for the current transcription source."""
    f = tmp_path / "clip.wav"
    f.write_bytes(b"RIFF....WAVEfmt fake audio bytes")
    return f


@pytest.fixture
def client(main_module, source_audio, monkeypatch):
    """TestClient with known tokens, a seeded result and one connected UI."""
    m = main_module
    monkeypatch.setenv("CAPFORGE_HOME", str(source_audio.parent / "home"))
    monkeypatch.setattr(m, "AGENT_TOKEN", AGENT_TOKEN, raising=False)
    monkeypatch.setattr(m, "LOCAL_TOKEN", LOCAL_TOKEN, raising=False)
    # A non-empty ws_clients stands in for "CapForge is open".
    monkeypatch.setattr(m, "ws_clients", [object()], raising=False)
    # Co-author mode is a module global another suite may have left set.
    monkeypatch.setattr(m, "current_coauthor", False, raising=False)

    prev_result = m.current_result
    prev_state = m.current_ui_state
    m.current_result = TranscriptionResult(
        segments=[
            Segment(
                start=0.0,
                end=1.0,
                text="Hello world",
                words=[
                    WordSegment(word="Hello", start=0.0, end=0.5),
                    WordSegment(word="world", start=0.5, end=1.0),
                ],
            )
        ],
        language="en",
        duration=1.0,
        audio_path=str(source_audio),
    )
    try:
        yield TestClient(m.app)
    finally:
        m.current_result = prev_result
        m.current_ui_state = prev_state


def _agent():
    return {AGENT_HEADER: AGENT_TOKEN}


def _local():
    return {LOCAL_HEADER: LOCAL_TOKEN}


def _mirror_tracks(m) -> None:
    """§E-shaped mirror: the active (source) track at the top level, plus a
    translated track carrying its own render body."""
    m.current_ui_state = {
        "activeTrackId": "src",
        "settings": {},
        "render": {
            "config": {"font_size": SOURCE_FONT_SIZE},
            "custom_groups": None,
        },
        "tracks": [
            {
                "id": "src",
                "label": "Original",
                "lang": "en",
                "isSource": True,
                "render": {"config": {"font_size": SOURCE_FONT_SIZE}, "custom_groups": None},
            },
            {
                "id": "t-pl",
                "label": "Polski",
                "lang": "pl",
                "isSource": False,
                "render": {
                    "config": {"font_size": TRACK_FONT_SIZE},
                    "custom_groups": [
                        {
                            "id": "t-pl:0",
                            "text": "czerwony samochód",
                            "start": 0.0,
                            "end": 1.0,
                            "words": [
                                {"word": "czerwony", "start": 0.0, "end": 0.5},
                                {"word": "samochód", "start": 0.5, "end": 1.0},
                            ],
                        }
                    ],
                    "output_name_suffix": ".pl",
                },
            },
        ],
    }


# ── 1. Mirror selection by track_id ───────────────────────────────────────────


def test_render_frame_without_track_id_uses_the_active_mirror(client, main_module, monkeypatch):
    """No ``track_id`` is byte-identical to today: the top-level ``render``."""
    captured: dict = {}

    def fake_png(result, config, t, composite, custom_groups, source):
        captured["config"] = config
        return b"png"

    monkeypatch.setattr(main_module, "render_qa_frame_png", fake_png)
    _mirror_tracks(main_module)

    res = client.post("/api/render-frame", json={"t": 0.0, "composite": False}, headers=_agent())

    assert res.status_code == 200
    assert captured["config"].font_size == SOURCE_FONT_SIZE


def test_render_frame_with_track_id_uses_that_tracks_config(client, main_module, monkeypatch):
    captured: dict = {}

    def fake_png(result, config, t, composite, custom_groups, source):
        captured["config"] = config
        captured["custom_groups"] = custom_groups
        return b"png"

    monkeypatch.setattr(main_module, "render_qa_frame_png", fake_png)
    _mirror_tracks(main_module)

    res = client.post(
        "/api/render-frame",
        json={"t": 0.0, "composite": False, "track_id": "t-pl"},
        headers=_agent(),
    )

    assert res.status_code == 200
    assert captured["config"].font_size == TRACK_FONT_SIZE
    assert captured["custom_groups"][0]["text"] == "czerwony samochód"


def test_render_frame_with_unknown_track_id_is_404_with_the_inventory(client, main_module):
    _mirror_tracks(main_module)

    res = client.post(
        "/api/render-frame",
        json={"t": 0.0, "track_id": "nope"},
        headers=_agent(),
    )

    assert res.status_code == 404
    detail = res.json()["detail"]
    ids = [t["id"] for t in detail["tracks"]]
    assert ids == ["src", "t-pl"], detail
    assert "nope" in str(detail)


def test_unknown_track_id_with_no_tracks_mirrored_is_404(client, main_module):
    """A pre-tracks renderer mirrors no ``tracks`` key at all."""
    main_module.current_ui_state = {"render": {"config": {}, "custom_groups": None}}

    res = client.post(
        "/api/render-frame", json={"t": 0.0, "track_id": "t-pl"}, headers=_agent()
    )

    assert res.status_code == 404
    assert res.json()["detail"]["tracks"] == []


def test_non_string_track_id_is_rejected(client, main_module):
    _mirror_tracks(main_module)

    res = client.post("/api/render-frame", json={"t": 0.0, "track_id": 7}, headers=_agent())

    assert res.status_code == 400


def test_check_layout_honours_track_id(client, main_module, monkeypatch):
    captured: dict = {}

    def fake_analyze(result, config, t, custom_groups, platform):
        captured["config"] = config
        return {"has_content": False}

    monkeypatch.setattr(main_module, "analyze_layout", fake_analyze)
    _mirror_tracks(main_module)

    res = client.post(
        "/api/agent/check-layout", json={"t": 0.0, "track_id": "t-pl"}, headers=_agent()
    )

    assert res.status_code == 200
    assert captured["config"].font_size == TRACK_FONT_SIZE


def test_export_hyperframes_use_ui_config_honours_track_id(
    client, main_module, monkeypatch, source_audio
):
    captured: dict = {}

    def fake_scaffold(result, config, into, **kwargs):
        captured["config"] = config
        captured["custom_groups"] = kwargs.get("custom_groups")
        return str(source_audio.parent / "proj")

    monkeypatch.setattr(main_module, "export_hyperframes_project", fake_scaffold)
    _mirror_tracks(main_module)

    res = client.post(
        "/api/export-hyperframes",
        json={"render": False, "use_ui_config": True, "track_id": "t-pl"},
        headers=_local(),
    )

    assert res.status_code == 200
    assert captured["config"].font_size == TRACK_FONT_SIZE
    assert captured["custom_groups"][0]["text"] == "czerwony samochód"


# ── groups_for_render: [] is not None ─────────────────────────────────────────


def test_groups_for_render_empty_custom_groups_draws_nothing():
    """An all-placeholder translated track mirrors ``custom_groups: []``.

    Truthiness would silently fall back to re-chunking the *source* transcript,
    i.e. draw English captions on the Polish track.
    """
    result = TranscriptionResult(
        segments=[
            Segment(
                start=0.0,
                end=1.0,
                text="Hello world",
                words=[
                    WordSegment(word="Hello", start=0.0, end=0.5),
                    WordSegment(word="world", start=0.5, end=1.0),
                ],
            )
        ]
    )
    assert groups_for_render(result, VideoRenderConfig(), []) == []


def test_groups_for_render_none_builds_from_the_transcript():
    result = TranscriptionResult(
        segments=[
            Segment(
                start=0.0,
                end=1.0,
                text="Hello world",
                words=[
                    WordSegment(word="Hello", start=0.0, end=0.5),
                    WordSegment(word="world", start=0.5, end=1.0),
                ],
            )
        ]
    )
    groups = groups_for_render(result, VideoRenderConfig(), None)
    assert groups and groups[0]["text"] == "Hello world"


# ── 2. Track command ops ──────────────────────────────────────────────────────


def _command(client, op, payload):
    return client.post(
        "/api/agent/command", headers=_agent(), json={"op": op, "payload": payload}
    )


@pytest.mark.parametrize("op", ["create_track", "set_track_text", "reflow_track"])
def test_track_ops_are_allowed(main_module, op):
    assert op in main_module.AGENT_COMMAND_OPS


def test_create_track_accepts_a_valid_command(client):
    res = _command(client, "create_track", {"command_id": "c-1", "track_id": "t-pl", "lang": "pl"})
    assert res.status_code == 200


def test_create_track_accepts_a_regional_lang(client):
    res = _command(
        client, "create_track", {"command_id": "c-1", "track_id": "t-br", "lang": "pt-BR"}
    )
    assert res.status_code == 200


@pytest.mark.parametrize("lang", ["", "polish!", "PL", "p", "../x", "pl-", "toolongcode"])
def test_create_track_rejects_a_bad_lang(client, lang):
    res = _command(
        client, "create_track", {"command_id": "c-1", "track_id": "t-pl", "lang": lang}
    )
    assert res.status_code == 400, lang


def test_create_track_requires_a_track_id(client):
    res = _command(client, "create_track", {"command_id": "c-1", "lang": "pl"})
    assert res.status_code == 400


@pytest.mark.parametrize("op", ["create_track", "set_track_text", "reflow_track"])
def test_track_ops_require_a_command_id(client, op):
    payload = {"track_id": "t-pl", "lang": "pl", "entries": [{"group_id": "g", "text": "x"}]}
    res = _command(client, op, payload)
    assert res.status_code == 400


def test_set_track_text_requires_non_empty_entries(client):
    res = _command(client, "set_track_text", {"command_id": "c-1", "track_id": "t-pl", "entries": []})
    assert res.status_code == 400


@pytest.mark.parametrize(
    "entries",
    [
        [{"group_id": "g"}],
        [{"text": "x"}],
        [{"group_id": 3, "text": "x"}],
        [{"group_id": "g", "text": 3}],
        ["g"],
        "not-a-list",
    ],
)
def test_set_track_text_rejects_malformed_entries(client, entries):
    res = _command(
        client, "set_track_text", {"command_id": "c-1", "track_id": "t-pl", "entries": entries}
    )
    assert res.status_code == 400, entries


def test_set_track_text_accepts_a_valid_batch(client):
    res = _command(
        client,
        "set_track_text",
        {
            "command_id": "c-1",
            "track_id": "t-pl",
            "entries": [{"group_id": "t-pl:0", "text": "czerwony samochód"}],
        },
    )
    assert res.status_code == 200


def test_reflow_track_accepts_a_valid_command(client):
    res = _command(client, "reflow_track", {"command_id": "c-1", "track_id": "t-pl"})
    assert res.status_code == 200


@pytest.mark.parametrize(
    "op,payload",
    [
        ("create_track", {"command_id": "c-1", "track_id": "t-pl", "lang": "pl"}),
        (
            "set_track_text",
            {
                "command_id": "c-1",
                "track_id": "t-pl",
                "entries": [{"group_id": "g", "text": "x"}],
            },
        ),
        ("reflow_track", {"command_id": "c-1", "track_id": "t-pl"}),
    ],
)
def test_track_ops_409_when_no_ui_is_connected(main_module, monkeypatch, op, payload):
    m = main_module
    monkeypatch.setattr(m, "AGENT_TOKEN", AGENT_TOKEN, raising=False)
    monkeypatch.setattr(m, "ws_clients", [], raising=False)
    res = TestClient(m.app).post(
        "/api/agent/command", headers=_agent(), json={"op": op, "payload": payload}
    )
    assert res.status_code == 409
    assert "CapForge" in res.json()["detail"]


# ── 3. Filename suffixes ──────────────────────────────────────────────────────


def test_render_video_passes_the_name_suffix(client, main_module, monkeypatch, source_audio):
    captured: dict = {}

    def fake_render(result, config, output_dir, **kwargs):
        captured.update(kwargs)
        return str(source_audio.parent / "clip.pl_subtitles.mov")

    monkeypatch.setattr(main_module, "render_subtitle_video", fake_render)

    res = client.post(
        "/api/render-video",
        json={"output_dir": str(source_audio.parent), "output_name_suffix": ".pl"},
        headers=_local(),
    )

    assert res.status_code == 200
    assert captured["name_suffix"] == ".pl"


def test_render_video_defaults_to_no_suffix(client, main_module, monkeypatch, source_audio):
    captured: dict = {}

    def fake_render(result, config, output_dir, **kwargs):
        captured.update(kwargs)
        return str(source_audio.parent / "clip_subtitles.mov")

    monkeypatch.setattr(main_module, "render_subtitle_video", fake_render)

    res = client.post(
        "/api/render-video", json={"output_dir": str(source_audio.parent)}, headers=_local()
    )

    assert res.status_code == 200
    assert captured["name_suffix"] == ""


@pytest.mark.parametrize(
    "suffix", ["../x", "pl", ".pl/../../etc", ".", "..", ".pl.mp4/x", "." + "a" * 33, ".a b"]
)
def test_render_video_rejects_a_path_bearing_suffix(client, source_audio, suffix):
    """The suffix is formatted into a filename, so it is gated at the schema."""
    res = client.post(
        "/api/render-video",
        json={"output_dir": str(source_audio.parent), "output_name_suffix": suffix},
        headers=_local(),
    )
    assert res.status_code == 422, suffix


def test_hyperframes_rejects_a_path_bearing_suffix(client):
    res = client.post(
        "/api/export-hyperframes",
        json={"render": False, "output_name_suffix": "../x"},
        headers=_local(),
    )
    assert res.status_code == 422


def test_render_subtitle_video_stem_carries_the_suffix(tmp_path, monkeypatch):
    """The suffix lands between the stem and the render suffix: clip.pl_subtitles."""
    from backend.exporters import ffmpeg_encode, video_render

    src = tmp_path / "clip.wav"
    src.write_bytes(b"\x00")
    result = TranscriptionResult(
        segments=[
            Segment(
                start=0.0,
                end=1.0,
                text="Hello world",
                words=[
                    WordSegment(word="Hello", start=0.0, end=0.5),
                    WordSegment(word="world", start=0.5, end=1.0),
                ],
            )
        ],
        audio_path=str(src),
        duration=1.0,
    )
    monkeypatch.setattr(video_render, "_find_ffmpeg", lambda: "ffmpeg")
    monkeypatch.setattr(video_render, "_probe_duration", lambda *a, **k: 1.0)
    monkeypatch.setattr(
        ffmpeg_encode,
        "_render_overlay",
        lambda ffmpeg, out_path, *a, **k: out_path,
    )

    out = video_render.render_subtitle_video(
        result, VideoRenderConfig(), str(tmp_path), name_suffix=".pl"
    )

    assert out.endswith("clip.pl_subtitles.webm"), out


# ── 4. Export for a track ─────────────────────────────────────────────────────


def _track_body(lang="pl"):
    return {
        "id": "t-pl",
        "lang": lang,
        "segments": [
            {
                "start": 0.0,
                "end": 1.0,
                "text": "czerwony samochód",
                "words": [
                    {"word": "czerwony", "start": 0.0, "end": 0.5},
                    {"word": "samochód", "start": 0.5, "end": 1.0},
                ],
            }
        ],
    }


def test_export_with_a_track_writes_a_lang_suffixed_file(client, source_audio):
    res = client.post(
        "/api/export",
        json={
            "formats": ["srt_standard"],
            "output_dir": str(source_audio.parent),
            "track": _track_body(),
        },
        headers=_local(),
    )

    assert res.status_code == 200
    files = res.json()["files"]
    assert len(files) == 1
    written = Path(files[0])
    assert written.name == "clip.pl.srt", files
    assert "czerwony samochód" in written.read_text(encoding="utf-8")


def test_export_without_a_track_is_unchanged(client, source_audio):
    res = client.post(
        "/api/export",
        json={"formats": ["srt_standard"], "output_dir": str(source_audio.parent)},
        headers=_local(),
    )
    assert res.status_code == 200
    assert Path(res.json()["files"][0]).name == "clip.srt"


@pytest.mark.parametrize("lang", ["", "../etc", "PL", "pl/x", "p"])
def test_export_rejects_a_bad_track_lang(client, source_audio, lang):
    """``lang`` becomes part of a filename — gated at the schema boundary."""
    res = client.post(
        "/api/export",
        json={
            "formats": ["srt_standard"],
            "output_dir": str(source_audio.parent),
            "track": _track_body(lang),
        },
        headers=_local(),
    )
    assert res.status_code == 422, lang


# ── 5. Layout scan ────────────────────────────────────────────────────────────

_LONG_WORD = "translation"
_WORDS_PER_ROW = 3
_ROWS = 3


def _scan_config(**over) -> VideoRenderConfig:
    """A config whose ``max_width`` fits exactly three ``_LONG_WORD``s per row.

    Derived from the font's own measurements (the same primitive the renderer
    measures with) so the expected row count does not depend on which face the
    platform resolves for the default family.
    """
    base = VideoRenderConfig(**over)
    font = _get_font(base.font_family, base.font_size, base.custom_font_path, bold=base.bold)
    word_w = font.getlength(_LONG_WORD)
    space_w = font.getlength(" ") + base.word_spacing
    # Room for three words plus half a word — a fourth can never fit.
    max_w_px = _WORDS_PER_ROW * word_w + (_WORDS_PER_ROW - 1) * space_w + (word_w + space_w) / 2
    return base.model_copy(update={"max_width": max_w_px / base.resolution_w})


def _group(gid: str, words: list[str], start: float, end: float) -> dict:
    step = (end - start) / max(1, len(words))
    return {
        "id": gid,
        "text": " ".join(words),
        "start": start,
        "end": end,
        "words": [
            {"word": w, "start": start + i * step, "end": start + (i + 1) * step}
            for i, w in enumerate(words)
        ],
    }


def _scan_groups() -> list[dict]:
    return [
        _group("g0", ["one", "two"], 0.0, 1.0),
        _group("g1", [_LONG_WORD] * (_WORDS_PER_ROW * _ROWS), 1.0, 4.0),
        # A word-less placeholder: an untranslated group on a translated track.
        {"id": "g2", "text": "", "start": 4.0, "end": 5.0, "words": []},
    ]


def test_scan_layout_flags_only_the_overflowing_group():
    config = _scan_config()
    out = scan_layout(config, _scan_groups(), 2)

    assert out["scanned"] == 3
    assert out["mode"] == "wrap"
    assert out["max_lines"] == 2
    assert len(out["violations"]) == 1, out["violations"]
    v = out["violations"][0]
    assert v["group_id"] == "g1"
    assert v["index"] == 1
    assert v["lines"] == _ROWS
    assert v["start"] == 1.0 and v["end"] == 4.0
    assert v["text"].startswith(_LONG_WORD)
    assert v["max_row_px"] <= out["max_width_px"]
    assert v["overflow_px"] == 0.0


def test_scan_layout_flags_a_word_wider_than_the_box():
    """One unbreakable word past ``max_width`` is a violation even at one line."""
    # _scan_config derives max_width, so set the narrow box directly.
    config = VideoRenderConfig(max_width=0.01)
    out = scan_layout(config, [_group("g0", ["incomprehensibilities"], 0.0, 1.0)], 2)

    assert len(out["violations"]) == 1
    v = out["violations"][0]
    assert v["lines"] == 1
    assert v["overflow_px"] > 0


def test_scan_layout_is_empty_in_rsvp_mode():
    config = _scan_config(reading_mode="rsvp")
    out = scan_layout(config, _scan_groups(), 2)

    assert out["violations"] == []
    assert out["mode"] == "rsvp"
    assert "RSVP" in out["note"]


def test_scan_layout_on_no_groups():
    out = scan_layout(_scan_config(), [], 2)
    assert out == {
        "scanned": 0,
        "mode": "wrap",
        "max_lines": 2,
        "max_width_px": out["max_width_px"],
        "violations": [],
    }


def test_check_layout_scan_dispatches_and_applies_groups_for_render(client, main_module):
    config = _scan_config()
    main_module.current_ui_state = {
        "render": {
            "config": config.model_dump(),
            "custom_groups": _scan_groups(),
        }
    }

    res = client.post(
        "/api/agent/check-layout", json={"scan": True, "max_lines": 2}, headers=_agent()
    )

    assert res.status_code == 200
    body = res.json()
    assert body["scanned"] == 3
    assert [v["group_id"] for v in body["violations"]] == ["g1"]
    # The plain (non-scan) read is untouched by the dispatch.
    assert "bbox_px" not in body


def test_check_layout_scan_defaults_to_two_lines(client, main_module):
    config = _scan_config()
    main_module.current_ui_state = {
        "render": {"config": config.model_dump(), "custom_groups": _scan_groups()}
    }

    res = client.post("/api/agent/check-layout", json={"scan": True}, headers=_agent())

    assert res.status_code == 200
    assert res.json()["max_lines"] == 2


def test_check_layout_scan_rejects_a_non_numeric_max_lines(client, main_module):
    config = _scan_config()
    main_module.current_ui_state = {
        "render": {"config": config.model_dump(), "custom_groups": _scan_groups()}
    }

    res = client.post(
        "/api/agent/check-layout", json={"scan": True, "max_lines": "two"}, headers=_agent()
    )

    assert res.status_code == 400


def test_check_layout_scan_honours_track_id(client, main_module):
    """The scan reads the selected track's own groups, not the active one's."""
    config = _scan_config()
    main_module.current_ui_state = {
        "render": {"config": config.model_dump(), "custom_groups": _scan_groups()},
        "tracks": [
            {
                "id": "t-pl",
                "label": "Polski",
                "lang": "pl",
                "render": {
                    "config": config.model_dump(),
                    "custom_groups": [_group("p0", ["one", "two"], 0.0, 1.0)],
                },
            }
        ],
    }

    res = client.post(
        "/api/agent/check-layout",
        json={"scan": True, "track_id": "t-pl"},
        headers=_agent(),
    )

    assert res.status_code == 200
    body = res.json()
    assert body["scanned"] == 1
    assert body["violations"] == []
