"""Unit tests for the caption-track MCP tools (multi-language plan, Phase 5).

Everything runs against a stub client holding a canned UI-state mirror in the
shape `src/renderer/src/lib/uiStateMirror.ts` publishes (plan §E), so the tools
are exercised with no CapForge running. What is under test is the *seam*: the
command payloads the tools send, the confirm-by-poll against the mirror's
`agent` echo, and the projections they hand back to the agent.
"""

from __future__ import annotations

import copy
from typing import Any, Optional

import pytest

from mcp_server import server, tracks


# --- Mirror fixtures (plan §E) --------------------------------------------

SOURCE_GROUPS = [
    {"id": "s1:0", "start": 0.0, "end": 1.5, "text": "the quick brown"},
    {"id": "s1:1", "start": 1.5, "end": 3.0, "text": "fox jumps over"},
    {"id": "s1:2", "start": 3.0, "end": 4.5, "text": "the lazy dog"},
]

POLISH_GROUPS = [
    {
        "id": "tpl:0", "start": 0.0, "end": 1.5, "text": "szybki brązowy",
        "state": "clean", "sourceText": "the quick brown", "previousText": None,
    },
    {
        "id": "tpl:1", "start": 1.5, "end": 3.0, "text": "lis przeskakuje",
        "state": "stale", "sourceText": "fox jumps over", "previousText": None,
    },
    {
        "id": "tpl:2", "start": 3.0, "end": 4.5, "text": "",
        "state": "untranslated", "sourceText": "the lazy dog", "previousText": None,
    },
]


def _config(font_size: int = 64) -> dict:
    return {"font_family": "Inter", "font_size": font_size, "bold": True}


def _custom_group(group: dict) -> dict:
    words = group["text"].split()
    span = (group["end"] - group["start"]) / max(len(words), 1)
    return {
        "id": group["id"],
        "text": group["text"],
        "start": group["start"],
        "end": group["end"],
        "words": [
            {
                "word": word,
                "start": group["start"] + i * span,
                "end": group["start"] + (i + 1) * span,
            }
            for i, word in enumerate(words)
        ],
    }


def source_entry() -> dict:
    return {
        "id": "src", "label": "Original", "lang": "en", "isSource": True,
        "groupCount": len(SOURCE_GROUPS), "staleCount": 0, "untranslatedCount": 0,
        "reflowNeeded": False, "appliedPreset": None,
        "groups": copy.deepcopy(SOURCE_GROUPS),
        "render": {"config": _config(64), "output_dir": "output"},
    }


def polish_entry() -> dict:
    groups = copy.deepcopy(POLISH_GROUPS)
    return {
        "id": "tpl", "label": "Polish", "lang": "pl", "isSource": False,
        "groupCount": len(groups), "staleCount": 1, "untranslatedCount": 1,
        "reflowNeeded": False, "appliedPreset": None,
        "groups": groups,
        "render": {
            "config": _config(72),
            "output_dir": "output",
            "output_name_suffix": ".pl",
            # A translated track always carries custom_groups; a group with no
            # text is a placeholder and never reaches a renderer.
            "custom_groups": [_custom_group(g) for g in groups if g["text"]],
        },
    }


def mirror(*, active: str = "src") -> dict:
    """The whole `PUT /api/ui-state` body, two tracks, nothing commanded yet."""
    return {
        "screen": "results",
        "settings": {"fontSize": 64},
        "groups": copy.deepcopy(SOURCE_GROUPS),
        "presets": ["YouTube Bold"],
        "presetsDetail": {"builtin": ["YouTube Bold"], "user": ["My Look"]},
        "appliedPreset": None,
        "render": {"config": _config(64), "output_dir": "output"},
        "activeTrackId": active,
        "agent": {"lastCommandId": None, "lastCommandStatus": None, "lastCommandError": None},
        "tracks": [source_entry(), polish_entry()],
    }


# --- Stubs ----------------------------------------------------------------

class FakeClock:
    """Stands in for `tracks.time`, so a poll loop runs instantly."""

    def __init__(self) -> None:
        self.now = 0.0

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds


class StubClient:
    """The CapForgeClient surface the tools use, over a canned mirror.

    ``echo`` is how the renderer answers a command: ``"ok"``, ``"error"``, or
    ``None`` for a UI that never echoes (the unconfirmed path).
    """

    def __init__(self, state: Optional[dict] = None, *, echo: Optional[str] = "ok",
                 error: Optional[str] = None) -> None:
        self.state = state if state is not None else mirror()
        self.echo = echo
        self.error = error
        self.commands: list[dict] = []
        self.exports: list[dict] = []
        self.renders: list[dict] = []
        self.hyperframes: list[dict] = []
        self.layout_calls: list[dict] = []
        self.frames: list[dict] = []

    def get_ui_state(self) -> dict:
        return copy.deepcopy(self.state)

    def send_command(self, op: str, payload: dict) -> dict:
        self.commands.append({"op": op, "payload": payload})
        if self.echo == "ok":
            self._apply(op, payload)
        if self.echo:
            self.state["agent"] = {
                "lastCommandId": payload.get("command_id"),
                "lastCommandStatus": self.echo,
                "lastCommandError": self.error,
            }
        return {"status": "ok"}

    def _apply(self, op: str, payload: dict) -> None:
        """The slice of renderer behaviour these tools read back."""
        if op == "create_track":
            track_id = payload["track_id"]
            groups = [
                {
                    "id": f"{track_id}:{i}", "start": g["start"], "end": g["end"],
                    "text": "", "state": "untranslated", "sourceText": g["text"],
                    "previousText": None,
                }
                for i, g in enumerate(SOURCE_GROUPS)
            ]
            self.state["tracks"].append({
                "id": track_id,
                "label": payload.get("label") or "Polish",
                "lang": payload["lang"],
                "isSource": False,
                "groupCount": len(groups),
                "staleCount": 0,
                "untranslatedCount": len(groups),
                "reflowNeeded": False,
                "appliedPreset": None,
                "groups": groups,
                "render": {
                    "config": _config(64),
                    "output_name_suffix": f".{payload['lang']}",
                    "custom_groups": [],
                },
            })
            self.state["activeTrackId"] = track_id
        elif op == "apply_preset":
            target = payload.get("track_id") or self.state["activeTrackId"]
            for entry in self.state["tracks"]:
                if entry["id"] == target:
                    entry["appliedPreset"] = payload["name"]
            if not payload.get("track_id"):
                self.state["appliedPreset"] = payload["name"]

    def export(self, payload: dict) -> dict:
        self.exports.append(payload)
        return {"status": "ok", "files": ["/clips/demo.pl.srt"]}

    def render_video(self, payload: dict) -> dict:
        self.renders.append(payload)
        return {"status": "ok", "file": "/clips/demo.pl.mp4"}

    def render_hyperframes(self, payload: dict) -> dict:
        self.hyperframes.append(payload)
        return {"status": "ok", "file": "/clips/demo.pl_hyperframes.mp4"}

    def check_layout(self, t: float, platform: str = "off", track_id: Optional[str] = None,
                     scan: bool = False, max_lines: int = 2) -> dict:
        self.layout_calls.append({
            "t": t, "platform": platform, "track_id": track_id,
            "scan": scan, "max_lines": max_lines,
        })
        return {"scanned": 3, "violations": []}

    def get_frame(self, t: float, composite: bool = True,
                  track_id: Optional[str] = None) -> bytes:
        self.frames.append({"t": t, "composite": composite, "track_id": track_id})
        return b"\x89PNG-stub"


@pytest.fixture(autouse=True)
def _instant_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    """No real sleeping: the confirm loop's clock is the one it advances."""
    monkeypatch.setattr(tracks, "time", FakeClock())


@pytest.fixture
def stub(monkeypatch: pytest.MonkeyPatch) -> StubClient:
    client = StubClient()
    monkeypatch.setattr(server, "_client", client)
    return client


def _use(monkeypatch: pytest.MonkeyPatch, client: StubClient) -> StubClient:
    monkeypatch.setattr(server, "_client", client)
    return client


# --- create_track ---------------------------------------------------------

def test_create_track_sends_lang_and_a_minted_command_id(stub: StubClient) -> None:
    tracks.create_track("pl")

    assert len(stub.commands) == 1
    cmd = stub.commands[0]
    assert cmd["op"] == "create_track"
    assert cmd["payload"]["lang"] == "pl"
    assert cmd["payload"]["track_id"].startswith("t-")
    assert cmd["payload"]["command_id"].startswith("c-")
    # No label / copy_style_from means the renderer's own defaults, not nulls.
    assert "label" not in cmd["payload"]
    assert "copy_style_from" not in cmd["payload"]


def test_create_track_returns_the_paired_skeleton(stub: StubClient) -> None:
    out = tracks.create_track("pl")

    assert out["status"] == "ok"
    assert out["track_id"] == stub.commands[0]["payload"]["track_id"]
    assert out["label"] == "Polish"
    # New track's group ids, paired by index with the SOURCE text to translate.
    assert out["groups"] == [
        {"id": f"{out['track_id']}:0", "start": 0.0, "end": 1.5, "text": "the quick brown"},
        {"id": f"{out['track_id']}:1", "start": 1.5, "end": 3.0, "text": "fox jumps over"},
        {"id": f"{out['track_id']}:2", "start": 3.0, "end": 4.5, "text": "the lazy dog"},
    ]


def test_create_track_never_returns_words(stub: StubClient) -> None:
    out = tracks.create_track("pl")
    assert all("words" not in g for g in out["groups"])


def test_create_track_passes_label_and_copy_style_from(stub: StubClient) -> None:
    tracks.create_track("pl", label="Polski", copy_style_from="tpl")
    payload = stub.commands[0]["payload"]
    assert payload["label"] == "Polski"
    assert payload["copy_style_from"] == "tpl"


def test_create_track_is_silent_about_pairing_when_the_counts_agree(stub: StubClient) -> None:
    assert "warning" not in tracks.create_track("pl")


class MismatchedClient(StubClient):
    """A mirror read back *after* the source's grouping moved under us.

    The renderer creates one group per source group, so the counts normally
    agree; a user regrouping the source while the confirm poll runs is what
    makes them disagree.
    """

    def __init__(self, *, extra_groups: int) -> None:
        super().__init__()
        self.extra_groups = extra_groups

    def _apply(self, op: str, payload: dict) -> None:
        super()._apply(op, payload)
        if op != "create_track":
            return
        if self.extra_groups >= 0:
            new = self.state["tracks"][-1]
            for i in range(self.extra_groups):
                new["groups"].append({
                    "id": f"{payload['track_id']}:x{i}", "start": 4.5, "end": 5.0,
                    "text": "", "state": "untranslated", "sourceText": "",
                    "previousText": None,
                })
        else:
            source = next(t for t in self.state["tracks"] if t["isSource"])
            del source["groups"][self.extra_groups:]


def test_create_track_pairs_over_the_shorter_list_and_warns(monkeypatch) -> None:
    _use(monkeypatch, MismatchedClient(extra_groups=2))

    out = tracks.create_track("pl")

    # No IndexError, and no group handed back with invented empty source text.
    assert out["status"] == "ok"
    assert [g["text"] for g in out["groups"]] == [g["text"] for g in SOURCE_GROUPS]
    assert "5 groups but the source has 3" in out["warning"]
    assert "first 3" in out["warning"]
    assert "get_track" in out["warning"]


def test_create_track_warns_when_the_source_shrank(monkeypatch) -> None:
    _use(monkeypatch, MismatchedClient(extra_groups=-1))

    out = tracks.create_track("pl")

    assert len(out["groups"]) == 2
    assert [g["text"] for g in out["groups"]] == [g["text"] for g in SOURCE_GROUPS[:2]]
    assert "3 groups but the source has 2" in out["warning"]


# --- confirm by poll ------------------------------------------------------

def test_send_and_confirm_reports_the_renderers_refusal(monkeypatch) -> None:
    stub = _use(monkeypatch, StubClient(echo="error", error="The transcript has no word ids."))

    out = tracks.create_track("pl")

    assert out["status"] == "error"
    assert out["error"] == "The transcript has no word ids."
    assert out["track_id"] == stub.commands[0]["payload"]["track_id"]


def test_send_and_confirm_gives_up_unconfirmed(monkeypatch) -> None:
    stub = _use(monkeypatch, StubClient(echo=None))

    out = tracks.set_track_text("tpl", [tracks.TrackTextEntry(group_id="tpl:0", text="x")])

    assert out["status"] == "unconfirmed"
    assert f"{tracks.CONFIRM_TIMEOUT:g}s" in out["hint"]
    # It really polled rather than returning at once.
    assert len(stub.commands) == 1


def test_unconfirmed_off_the_results_screen_says_so(monkeypatch) -> None:
    state = mirror()
    state["screen"] = "file"
    _use(monkeypatch, StubClient(state, echo=None))

    out = tracks.reflow_track("tpl")

    assert out["status"] == "unconfirmed"
    assert "'file' screen" in out["hint"]


def test_an_echo_for_someone_elses_command_is_not_a_confirmation(monkeypatch) -> None:
    class Impostor(StubClient):
        def send_command(self, op: str, payload: dict) -> dict:
            self.commands.append({"op": op, "payload": payload})
            self.state["agent"] = {
                "lastCommandId": "c-somebodyelse",
                "lastCommandStatus": "ok",
                "lastCommandError": None,
            }
            return {"status": "ok"}

    _use(monkeypatch, Impostor())
    assert tracks.reflow_track("tpl")["status"] == "unconfirmed"


# --- set_track_text -------------------------------------------------------

def test_set_track_text_sends_group_id_text_pairs(stub: StubClient) -> None:
    tracks.set_track_text("tpl", [
        tracks.TrackTextEntry(group_id="tpl:0", text="szybki brązowy"),
        tracks.TrackTextEntry(group_id="tpl:2", text=""),
    ])

    payload = stub.commands[0]["payload"]
    assert stub.commands[0]["op"] == "set_track_text"
    assert payload["track_id"] == "tpl"
    assert payload["entries"] == [
        {"group_id": "tpl:0", "text": "szybki brązowy"},
        {"group_id": "tpl:2", "text": ""},
    ]
    assert payload["command_id"].startswith("c-")


def test_set_track_text_returns_the_tracks_counters(stub: StubClient) -> None:
    out = tracks.set_track_text("tpl", [tracks.TrackTextEntry(group_id="tpl:0", text="a")])

    assert out == {
        "status": "ok", "track_id": "tpl", "written": 1,
        "staleCount": 1, "untranslatedCount": 1, "reflowNeeded": False,
    }


# --- get_track ------------------------------------------------------------

def test_get_track_defaults_to_the_active_track(stub: StubClient) -> None:
    out = tracks.get_track()
    assert out["track"]["id"] == "src"
    assert [g["id"] for g in out["groups"]] == ["s1:0", "s1:1", "s1:2"]


def test_get_track_returns_the_inventory_entry_without_bodies(stub: StubClient) -> None:
    out = tracks.get_track("tpl")
    assert "groups" not in out["track"]
    assert "render" not in out["track"]
    assert out["track"]["staleCount"] == 1


def test_get_track_stale_only_keeps_stale_and_untranslated(stub: StubClient) -> None:
    out = tracks.get_track("tpl", stale_only=True)
    assert [g["id"] for g in out["groups"]] == ["tpl:1", "tpl:2"]
    assert [g["state"] for g in out["groups"]] == ["stale", "untranslated"]


def test_get_track_windows_by_group_time(stub: StubClient) -> None:
    out = tracks.get_track("tpl", start=1.6, end=3.2)
    # Overlap, not containment: tpl:1 [1.5,3.0] and tpl:2 [3.0,4.5] both touch it.
    assert [g["id"] for g in out["groups"]] == ["tpl:1", "tpl:2"]


def test_get_track_unknown_id_returns_the_inventory(stub: StubClient) -> None:
    out = tracks.get_track("nope")
    assert out["status"] == "error"
    assert out["tracks"] == [
        {"id": "src", "label": "Original", "lang": "en"},
        {"id": "tpl", "label": "Polish", "lang": "pl"},
    ]


def test_get_track_with_no_project_explains_itself(monkeypatch) -> None:
    _use(monkeypatch, StubClient({"screen": "file"}))
    out = tracks.get_track()
    assert out["status"] == "error"
    assert "load_video" in out["hint"]


# --- reflow_track ---------------------------------------------------------

def test_reflow_track_returns_counts_and_the_blank_groups(monkeypatch) -> None:
    state = mirror()
    polish = state["tracks"][1]
    polish["groups"][2]["previousText"] = "leniwy pies / stary tekst"
    polish["reflowNeeded"] = True
    stub = _use(monkeypatch, StubClient(state))

    out = tracks.reflow_track("tpl")

    assert stub.commands[0]["op"] == "reflow_track"
    assert stub.commands[0]["payload"]["track_id"] == "tpl"
    assert out["groupCount"] == 3
    assert out["blank"] == [{
        "id": "tpl:2", "start": 3.0, "end": 4.5,
        "sourceText": "the lazy dog", "previousText": "leniwy pies / stary tekst",
    }]


# --- get_ui_state ---------------------------------------------------------

def test_get_ui_state_strips_groups_and_render_from_tracks(stub: StubClient) -> None:
    out = server.get_ui_state()

    assert out["activeTrackId"] == "src"
    for entry in out["tracks"]:
        assert "groups" not in entry
        assert "render" not in entry
        assert entry["groupCount"] == 3
    # The active track's own render body and groups are untouched.
    assert out["render"]["config"]["font_size"] == 64
    assert len(out["groups"]) == 3


def test_get_ui_state_tolerates_a_renderer_without_tracks(monkeypatch) -> None:
    _use(monkeypatch, StubClient({"screen": "results", "settings": {}}))
    assert server.get_ui_state() == {"screen": "results", "settings": {}}


# --- render / export / QA -------------------------------------------------

def test_render_submits_that_tracks_body_verbatim(stub: StubClient) -> None:
    out = server.render(track_id="tpl")

    assert out["status"] == "ok"
    assert stub.renders == [polish_entry()["render"]]
    # The language suffix rides inside the mirrored body, not rebuilt here.
    assert stub.renders[0]["output_name_suffix"] == ".pl"


def test_render_adds_only_output_dir(stub: StubClient) -> None:
    server.render(output_dir="/out", track_id="tpl")
    assert stub.renders[0] == {**polish_entry()["render"], "output_dir": "/out"}


def test_render_without_a_track_id_is_unchanged(stub: StubClient) -> None:
    server.render()
    assert stub.renders == [mirror()["render"]]


def test_render_unknown_track_returns_the_inventory_error(stub: StubClient) -> None:
    out = server.render(track_id="nope")
    assert out["status"] == "error"
    assert [t["id"] for t in out["tracks"]] == ["src", "tpl"]
    assert stub.renders == []


def test_export_for_a_translated_track_sends_track_with_lang(stub: StubClient) -> None:
    server.export(["srt_standard"], track_id="tpl")

    assert len(stub.exports) == 1
    track = stub.exports[0]["track"]
    assert track["id"] == "tpl"
    assert track["lang"] == "pl"
    assert [s["text"] for s in track["segments"]] == ["szybki brązowy", "lis przeskakuje"]
    assert track["segments"][0]["words"][0]["word"] == "szybki"


def test_export_for_the_source_track_sends_todays_body(stub: StubClient) -> None:
    server.export(["srt_word"], track_id="src")
    assert stub.exports == [{"formats": ["srt_word"], "output_dir": "output"}]


def test_export_refuses_a_track_with_nothing_written(monkeypatch) -> None:
    state = mirror()
    state["tracks"][1]["render"]["custom_groups"] = []
    stub = _use(monkeypatch, StubClient(state))

    out = server.export(["srt_standard"], track_id="tpl")

    assert out["status"] == "error"
    assert "set_track_text" in out["hint"]
    assert stub.exports == []


def test_check_layout_forwards_the_scan_arguments(stub: StubClient) -> None:
    server.check_layout(0.0, track_id="tpl", scan=True, max_lines=2)
    assert stub.layout_calls == [
        {"t": 0.0, "platform": "off", "track_id": "tpl", "scan": True, "max_lines": 2}
    ]


def test_render_frame_passes_the_track_id(stub: StubClient) -> None:
    server.render_frame(1.0, composite=False, track_id="tpl")
    assert stub.frames == [{"t": 1.0, "composite": False, "track_id": "tpl"}]


def test_render_hyperframes_passes_the_track_id(stub: StubClient) -> None:
    server.render_hyperframes(track_id="tpl")
    assert stub.hyperframes[0]["track_id"] == "tpl"
    assert stub.hyperframes[0]["use_ui_config"] is True

    server.render_hyperframes()
    assert "track_id" not in stub.hyperframes[1]


def test_set_style_targets_one_track(stub: StubClient) -> None:
    server.set_style({"fontSize": 72}, track_id="tpl")
    assert stub.commands[0] == {
        "op": "set_settings", "payload": {"patch": {"fontSize": 72}, "track_id": "tpl"}
    }

    server.set_style({"fontSize": 72})
    assert stub.commands[1]["payload"] == {"patch": {"fontSize": 72}}


def test_apply_preset_confirms_against_the_named_track(stub: StubClient) -> None:
    out = server.apply_preset("YouTube Bold", track_id="tpl")

    assert out == {"status": "ok", "applied": "YouTube Bold", "track_id": "tpl"}
    assert stub.commands[0]["payload"] == {"name": "YouTube Bold", "track_id": "tpl"}
    # The active track's own preset was not touched.
    assert stub.state["appliedPreset"] is None


def test_apply_preset_without_a_track_id_is_unchanged(stub: StubClient) -> None:
    assert server.apply_preset("YouTube Bold") == {"status": "ok", "applied": "YouTube Bold"}
    assert stub.state["appliedPreset"] == "YouTube Bold"


def test_apply_preset_unknown_name_keeps_its_hint_ladder(monkeypatch) -> None:
    _use(monkeypatch, StubClient(echo=None))
    out = server.apply_preset("Nope")
    assert out["status"] == "unconfirmed"
    assert "No preset named 'Nope'" in out["hint"]
    assert "YouTube Bold" in out["hint"]


# --- the client's request shapes ------------------------------------------

class RecordingClient(server.CapForgeClient):
    """The real client with only the HTTP call replaced."""

    def __init__(self) -> None:
        super().__init__()
        self.requests: list[dict] = []

    def _request(self, method: str, path: str, *, json: Any = None, **_kw: Any) -> Any:
        self.requests.append({"method": method, "path": path, "json": json})
        return {}


def test_client_check_layout_sends_the_scan_keys_only_for_a_scan() -> None:
    client = RecordingClient()

    client.check_layout(2.0)
    assert client.requests[0]["json"] == {"t": 2.0, "platform": "off"}

    client.check_layout(2.0, "tiktok", track_id="tpl", scan=True, max_lines=3)
    assert client.requests[1]["json"] == {
        "t": 2.0, "platform": "tiktok", "track_id": "tpl", "scan": True, "max_lines": 3,
    }


def test_client_get_frame_sends_track_id_only_when_given(monkeypatch) -> None:
    posted: list[dict] = []

    class _Res:
        status_code = 200
        content = b"png"

        def raise_for_status(self) -> None:
            return None

    def _post(url: str, json: dict, headers: dict, timeout: Any) -> Any:
        posted.append(json)
        return _Res()

    client = server.CapForgeClient()
    monkeypatch.setattr(client, "_ensure", lambda: None)
    monkeypatch.setattr("mcp_server.client.httpx.post", _post)

    client.get_frame(1.0)
    client.get_frame(1.0, True, "tpl")

    assert posted == [
        {"t": 1.0, "composite": True},
        {"t": 1.0, "composite": True, "track_id": "tpl"},
    ]


# --- the loop lives in the docstrings (plan Phase 5, item 5) ---------------

def test_docstrings_carry_the_translation_loop() -> None:
    recipe = tracks.create_track.__doc__ or ""
    assert "set_track_text" in recipe and "check_layout" in recipe
    assert "switches to the new tab" in recipe

    layout = server.check_layout.__doc__ or ""
    assert "10–15 %" in layout and "third line" in layout

    read = tracks.get_track.__doc__ or ""
    assert "reflow_track" in read and "stale" in read
