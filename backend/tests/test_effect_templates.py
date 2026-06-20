"""Tests for the reusable effect-template library (backs the agent's
save/apply_effect_template tools and the EffectsControls template picker)."""

import pytest

from backend import effect_templates as et


@pytest.fixture(autouse=True)
def isolated_home(tmp_path, monkeypatch):
    """Point the template store at a throwaway dir so tests never touch ~/.capforge."""
    monkeypatch.setenv("CAPFORGE_HOME", str(tmp_path))
    return tmp_path


def _logo_effect(src=None):
    return {
        "id": "fx-123",
        "type": "logo",
        "start": 4.2,
        "duration": 3.0,
        "track_index": 1,
        "anchor_x": 0.82,
        "anchor_y": 0.2,
        "source_word_id": "0-3",
        "variables": {"src": src, "width": 200} if src else {"width": 200},
        "created_by": "agent",
    }


def test_save_then_list_round_trips():
    et.save_template("Brand logo", _logo_effect())
    names = [t["name"] for t in et.list_templates()]
    assert names == ["Brand logo"]


def test_save_strips_timing_and_id():
    et.save_template("L", _logo_effect())
    t = et.get_template("L")
    assert t is not None
    # A template is a look, not a placement.
    for stripped in ("id", "start", "duration", "source_word_id"):
        assert stripped not in t
    assert t["type"] == "logo" and t["anchor_x"] == 0.82


def test_save_does_not_mutate_the_passed_effect():
    effect = _logo_effect()
    et.save_template("L", effect)
    # immutability: the caller's dict is untouched
    assert effect["start"] == 4.2 and "id" in effect


def test_empty_name_raises():
    with pytest.raises(ValueError):
        et.save_template("   ", _logo_effect())


def test_overwrite_same_name_replaces(isolated_home):
    et.save_template("L", _logo_effect())
    et.save_template("L", {**_logo_effect(), "anchor_x": 0.1})
    templates = et.list_templates()
    assert len(templates) == 1
    assert templates[0]["anchor_x"] == 0.1


def test_asset_backed_save_copies_image_into_store(isolated_home, tmp_path):
    src = tmp_path / "src_logo.png"
    src.write_bytes(b"PNG-DATA")
    et.save_template("Logo", _logo_effect(src=str(src)))

    t = et.get_template("Logo")
    stored = t["variables"]["src"]
    # rewritten to the store, not the original project path
    assert stored != str(src)
    assert str(isolated_home / "templates" / "assets") in stored
    from pathlib import Path

    assert Path(stored).read_bytes() == b"PNG-DATA"


def test_apply_builds_fresh_clip_with_given_timing():
    et.save_template("Logo", _logo_effect())
    clip = et.apply_template("Logo", start=10.0, duration=1.5)
    assert clip.start == 10.0 and clip.duration == 1.5
    assert clip.type == "logo" and clip.anchor_x == 0.82
    assert clip.id and clip.id != "fx-123"  # fresh id, not the saved one


def test_apply_unknown_raises_key_error():
    with pytest.raises(KeyError):
        et.apply_template("nope", start=0.0)


def test_delete_removes_and_reports():
    et.save_template("L", _logo_effect())
    assert et.delete_template("L") is True
    assert et.list_templates() == []
    assert et.delete_template("L") is False  # already gone


def test_list_empty_when_store_absent():
    assert et.list_templates() == []
