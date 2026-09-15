"""The frame routes and the PATCH rules they bring, over the token-gated boundary
(publish-editors Part A, decisions 1, 4 and 5).

ffmpeg is faked through ``frame_grab._run`` and the finder; poster grabs are
disabled like ``test_library_import_routes.py`` does.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.library import frame_grab, frames, posters
from backend.library import router as library_router
from backend.tests.test_library_frames import FAKE_FFMPEG, FakeFfmpeg

# The route fixtures (stubbed-ML app, both tokens) — imported so pytest sees them.
from backend.tests.test_library_routes import (  # noqa: F401
    LOCAL_HEADER,
    LOCAL_TOKEN,
    agent,
    client,
    create,
    home,
    main_module,
    media,
)


@pytest.fixture(autouse=True)
def _no_poster_grabs(monkeypatch):
    monkeypatch.setattr(posters, "start_grab", lambda store, record, on_changed=None: None)


@pytest.fixture
def ffmpeg(monkeypatch) -> FakeFfmpeg:
    fake = FakeFfmpeg()
    monkeypatch.setattr(frame_grab, "_run", fake)
    monkeypatch.setattr(frame_grab, "default_ffmpeg", lambda: FAKE_FFMPEG)
    return fake


@pytest.fixture
def announced(main_module, monkeypatch) -> list[dict]:
    sent: list[dict] = []

    async def capture(payload: dict) -> None:
        sent.append(payload)

    monkeypatch.setattr(main_module, "broadcast_event", capture)
    return sent


def user(**extra: str) -> dict:
    return {LOCAL_HEADER: LOCAL_TOKEN, **extra}


def grab(client, video_id: str, times: list) -> dict:
    r = client.post(f"/api/library/{video_id}/frames", json={"times": times}, headers=agent())
    assert r.status_code == 200, r.text
    return r.json()


def read(client, video_id: str) -> dict:
    return client.get(f"/api/library/{video_id}", headers=agent()).json()


def patch(client, video_id: str, body: dict, rev: int):
    return client.patch(
        f"/api/library/{video_id}", json=body, headers=user(**{"If-Match": str(rev)})
    )


def rules(response) -> list[tuple[str, str]]:
    return [(v["field"], v["rule"]) for v in response.json()["violations"]]


# --- the guard ----------------------------------------------------------------

@pytest.mark.parametrize("method,path", [
    ("post", "/api/library/" + "a" * 32 + "/frames"),
    ("delete", "/api/library/" + "a" * 32 + "/frames/" + "b" * 32 + ".jpg"),
])
def test_the_frame_routes_need_a_token(client, method, path) -> None:
    kwargs = {"json": {"times": [1.0]}} if method == "post" else {}
    assert getattr(client, method)(path, **kwargs).status_code == 401


# --- POST /{id}/frames ----------------------------------------------------------

def test_grabbing_answers_the_contract_shape_and_announces(client, media, ffmpeg, announced) -> None:
    rec = create(client, media)

    body = grab(client, rec["id"], [1.0, 2.5])

    assert set(body) == {"frames", "failed", "rev"}
    assert [set(frame) for frame in body["frames"]] == [{"time_s", "name"}] * 2
    assert [frame["time_s"] for frame in body["frames"]] == [1.0, 2.5]
    assert body["failed"] == []
    assert body["rev"] == rec["rev"] + 1
    names = [frame["name"] for frame in body["frames"]]
    assert read(client, rec["id"])["thumbnail"]["candidates"] == names
    asset = client.get(f"/api/library/{rec['id']}/asset/thumbnails/{names[0]}", headers=agent())
    assert asset.status_code == 200
    assert announced == [
        {"type": "record_updated", "video_id": rec["id"], "rev": body["rev"], "by": "agent"}
    ]


def test_a_request_where_every_grab_fails_writes_nothing(client, media, ffmpeg, announced) -> None:
    rec = create(client, media)
    ffmpeg.fail_at = {1.0}

    body = grab(client, rec["id"], [1.0])

    assert body["frames"] == []
    assert [set(f) for f in body["failed"]] == [{"time_s", "reason"}]
    assert body["failed"][0]["time_s"] == 1.0
    assert body["rev"] == rec["rev"]
    assert announced == []


@pytest.mark.parametrize("video_id", ["f" * 32, "not-a-record"])
def test_an_unknown_record_is_404(client, ffmpeg, video_id) -> None:
    r = client.post(f"/api/library/{video_id}/frames", json={"times": [1.0]}, headers=agent())
    assert r.status_code == 404


@pytest.mark.parametrize("body", [
    {"times": []},
    {"times": [0.5] * (frames.FRAMES_PER_REQUEST + 1)},
    {"times": [-1.0]},
    {"times": "1"},
    {"times": [1.0], "at": 2},
    {},
], ids=["empty", "over-per-request", "negative", "not-a-list", "extra-key", "missing"])
def test_bad_times_are_422_and_never_reach_ffmpeg(client, media, ffmpeg, body) -> None:
    rec = create(client, media)

    r = client.post(f"/api/library/{rec['id']}/frames", json=body, headers=agent())

    assert r.status_code == 422, r.text
    assert "detail" in r.json()
    assert ffmpeg.calls == []


def test_the_limits_answer_in_a_sentence(client, media, ffmpeg) -> None:
    rec = create(client, media)
    store = library_router.get_store()
    store.add_thumbnail_candidates(
        rec["id"], [f"{i:032x}.jpg" for i in range(frames.MAX_CANDIDATES - 1)], by="user"
    )

    over = client.post(f"/api/library/{rec['id']}/frames", json={"times": [1.0, 2.0]}, headers=agent())
    per_request = client.post(
        f"/api/library/{rec['id']}/frames",
        json={"times": [0.5] * (frames.FRAMES_PER_REQUEST + 1)}, headers=agent(),
    )

    assert over.status_code == per_request.status_code == 422
    assert isinstance(over.json()["detail"], str) and str(frames.MAX_CANDIDATES) in over.json()["detail"]
    assert isinstance(per_request.json()["detail"], str)
    assert ffmpeg.calls == []


def test_a_time_past_the_duration_is_422(client, media, ffmpeg) -> None:
    rec = create(client, media)
    library_router.get_store().set_probed_duration(rec["id"], 5.0)

    r = client.post(f"/api/library/{rec['id']}/frames", json={"times": [6.0]}, headers=agent())

    assert r.status_code == 422
    assert isinstance(r.json()["detail"], str)


def test_a_scratch_record_is_409(client, media, ffmpeg) -> None:
    rec = create(client, media, scratch=True)

    r = client.post(f"/api/library/{rec['id']}/frames", json={"times": [1.0]}, headers=agent())

    assert r.status_code == 409


# --- DELETE /{id}/frames/{name} --------------------------------------------------

def test_deleting_a_frame_answers_the_rev_and_announces(client, media, ffmpeg, announced) -> None:
    rec = create(client, media)
    body = grab(client, rec["id"], [1.0, 2.0])
    first, second = (frame["name"] for frame in body["frames"])

    r = client.delete(f"/api/library/{rec['id']}/frames/{first}", headers=user())

    assert r.status_code == 200
    assert r.json() == {"rev": body["rev"] + 1}
    assert read(client, rec["id"])["thumbnail"]["candidates"] == [second]
    gone = client.get(f"/api/library/{rec['id']}/asset/thumbnails/{first}", headers=agent())
    assert gone.status_code == 404
    assert announced[-1] == {
        "type": "record_updated", "video_id": rec["id"], "rev": body["rev"] + 1, "by": "user",
    }


@pytest.mark.parametrize("name", ["0" * 32 + ".jpg", "record.json", "nothex.jpg"])
def test_deleting_an_unknown_frame_is_404(client, media, ffmpeg, name) -> None:
    rec = create(client, media)
    grab(client, rec["id"], [1.0])

    assert client.delete(f"/api/library/{rec['id']}/frames/{name}", headers=user()).status_code == 404


def test_deleting_from_an_unknown_record_is_404(client) -> None:
    r = client.delete(f"/api/library/{'f' * 32}/frames/{'0' * 32}.jpg", headers=user())
    assert r.status_code == 404


def test_deleting_the_cover_clears_it(client, media, ffmpeg) -> None:
    rec = create(client, media)
    body = grab(client, rec["id"], [1.0])
    [name] = [frame["name"] for frame in body["frames"]]
    set_cover = patch(client, rec["id"], {"thumbnail": {"candidates": [name], "cover": name}}, body["rev"])
    assert set_cover.status_code == 200, set_cover.text

    client.delete(f"/api/library/{rec['id']}/frames/{name}", headers=user())

    assert read(client, rec["id"])["thumbnail"] == {"ideas": [], "candidates": [], "cover": None}


# --- PATCH: candidates_managed and the cover ---------------------------------------

def test_a_patch_that_changes_the_candidates_is_refused(client, media, ffmpeg) -> None:
    rec = create(client, media)
    body = grab(client, rec["id"], [1.0, 2.0])
    first = body["frames"][0]["name"]

    r = patch(client, rec["id"], {"thumbnail": {"candidates": [first]}}, body["rev"])

    assert r.status_code == 422
    assert rules(r) == [("thumbnail.candidates", "candidates_managed")]
    assert r.json()["violations"][0]["severity"] == "hard"
    assert len(read(client, rec["id"])["thumbnail"]["candidates"]) == 2


def test_a_stale_draft_carrying_the_old_list_is_refused_as_candidates_managed(client, media, ffmpeg) -> None:
    rec = create(client, media)
    grab(client, rec["id"], [1.0])

    r = patch(client, rec["id"], {"thumbnail": {"candidates": [], "ideas": []}}, rec["rev"])

    assert r.status_code == 422
    assert ("thumbnail.candidates", "candidates_managed") in rules(r)


def test_setting_the_cover_lands_and_the_package_prints_its_file(client, home, media, ffmpeg) -> None:
    rec = create(client, media)
    body = grab(client, rec["id"], [1.0, 2.0])
    names = [frame["name"] for frame in body["frames"]]
    before = client.get(f"/api/library/{rec['id']}/package", headers=agent()).json()["text"]
    assert "Cover file:" not in before

    r = patch(client, rec["id"], {"thumbnail": {"candidates": names, "cover": names[1]}}, body["rev"])

    assert r.status_code == 200, r.text
    assert r.json()["thumbnail"]["cover"] == names[1]
    text = client.get(f"/api/library/{rec['id']}/package", headers=agent()).json()["text"]
    expected = Path(home) / "library" / rec["id"] / frames.THUMBNAILS_DIR / names[1]
    assert f"Cover file: {expected}" in text


def test_a_cover_that_is_not_a_candidate_is_refused(client, media, ffmpeg) -> None:
    rec = create(client, media)
    body = grab(client, rec["id"], [1.0])
    names = [frame["name"] for frame in body["frames"]]

    r = patch(client, rec["id"], {"thumbnail": {"candidates": names, "cover": "0" * 32 + ".jpg"}}, body["rev"])

    assert r.status_code == 422
    assert rules(r) == [("thumbnail.cover", "cover_not_a_candidate")]


@pytest.mark.parametrize("start,end,rule", [(10.0, 31.0, "clip_past_end"), (20.0, 10.0, "clip_order")])
def test_a_bad_clip_is_refused(client, media, start, end, rule) -> None:
    rec = create(client, media)
    library_router.get_store().set_probed_duration(rec["id"], 30.0)
    shorts = {"caption": "", "clip_suggestions": [{"start_s": start, "end_s": end, "why": "x"}]}

    r = patch(client, rec["id"], {"shorts": shorts}, rec["rev"])

    assert r.status_code == 422
    assert rules(r) == [("shorts.clip_suggestions[0]", rule)]


def test_validate_reports_the_style_rules(client) -> None:
    fields = {
        "shorts": {"clip_suggestions": [{"start_s": 0, "end_s": 90, "why": "long"}]},
        "thumbnail": {"ideas": [
            {"label": "A", "type": "face", "headline": "One"},
            {"label": "B", "type": "text", "headline": "Two"},
        ]},
    }

    r = client.post("/api/library/validate", json={"fields": fields}, headers=agent())

    assert r.status_code == 200
    found = {(v["field"], v["rule"], v["severity"]) for v in r.json()["violations"]}
    assert found == {
        ("shorts.clip_suggestions[0]", "shorts_clip_length", "style"),
        ("thumbnail.ideas", "thumbnail_recommended", "style"),
    }


# --- an omitted thumbnail key means "unchanged" ------------------------------------

IDEA = {"label": "A", "type": "face", "headline": "One", "recommended": True}


def seeded(client, media) -> tuple[dict, list[str], int]:
    """A record with three frames, the first of them the cover."""
    rec = create(client, media)
    body = grab(client, rec["id"], [1.0, 2.0, 3.0])
    names = [frame["name"] for frame in body["frames"]]
    r = patch(client, rec["id"], {"thumbnail": {"candidates": names, "cover": names[0]}}, body["rev"])
    assert r.status_code == 200, r.text
    return rec, names, r.json()["rev"]


def test_an_ideas_only_patch_keeps_the_candidates_and_the_cover(client, media, ffmpeg) -> None:
    rec, names, rev = seeded(client, media)

    r = patch(client, rec["id"], {"thumbnail": {"ideas": [IDEA]}}, rev)

    assert r.status_code == 200, r.text
    thumbnail = r.json()["thumbnail"]
    assert (thumbnail["candidates"], thumbnail["cover"]) == (names, names[0])
    assert [idea["headline"] for idea in thumbnail["ideas"]] == ["One"]


def test_a_cover_only_patch_naming_a_stored_candidate_lands(client, media, ffmpeg) -> None:
    rec, names, rev = seeded(client, media)
    patch(client, rec["id"], {"thumbnail": {"ideas": [IDEA]}}, rev)

    r = patch(client, rec["id"], {"thumbnail": {"cover": names[2]}}, rev + 1)

    assert r.status_code == 200, r.text
    thumbnail = r.json()["thumbnail"]
    assert (thumbnail["candidates"], thumbnail["cover"]) == (names, names[2])
    assert [idea["headline"] for idea in thumbnail["ideas"]] == ["One"]


def test_a_cover_only_patch_naming_a_non_candidate_is_refused(client, media, ffmpeg) -> None:
    rec, _, rev = seeded(client, media)

    r = patch(client, rec["id"], {"thumbnail": {"cover": "0" * 32 + ".jpg"}}, rev)

    assert r.status_code == 422
    assert rules(r) == [("thumbnail.cover", "cover_not_a_candidate")]


def test_an_explicit_identical_list_lands(client, media, ffmpeg) -> None:
    rec, names, rev = seeded(client, media)

    r = patch(client, rec["id"], {"thumbnail": {"candidates": names, "cover": names[1]}}, rev)

    assert r.status_code == 200, r.text
    assert r.json()["thumbnail"]["cover"] == names[1]


def test_an_explicit_reordered_list_is_refused(client, media, ffmpeg) -> None:
    rec, names, rev = seeded(client, media)

    r = patch(client, rec["id"], {"thumbnail": {"candidates": [names[2], names[0], names[1]]}}, rev)

    assert r.status_code == 422
    assert rules(r) == [("thumbnail.candidates", "candidates_managed")]


def test_thumbnail_null_with_stored_candidates_is_refused(client, media, ffmpeg) -> None:
    rec, _, rev = seeded(client, media)

    r = patch(client, rec["id"], {"thumbnail": None}, rev)

    assert r.status_code == 422
    assert ("thumbnail.candidates", "candidates_managed") in rules(r)


def test_under_the_lock_a_partial_patch_inherits_the_fresh_record(client, media, ffmpeg) -> None:
    from backend.library.router_publish import locked_refusal
    from backend.library.schemas import RecordPatch

    rec, names, _ = seeded(client, media)
    store = library_router.get_store()
    stale = store.get(rec["id"])
    extra = grab(client, rec["id"], [4.0])["frames"][0]["name"]

    refusal, merged = locked_refusal(store, stale, RecordPatch.model_validate({"thumbnail": {"cover": extra}}))
    missing, _ = locked_refusal(
        store, stale, RecordPatch.model_validate({"thumbnail": {"cover": "0" * 32 + ".jpg"}})
    )

    assert refusal is None
    assert (merged.thumbnail.candidates, merged.thumbnail.cover) == ([*names, extra], extra)
    assert missing is not None and missing.status_code == 422


def test_validate_judges_a_partial_draft_against_the_stored_candidates(client, media, ffmpeg) -> None:
    rec, names, _ = seeded(client, media)

    def cover_rules(cover: str) -> list[str]:
        body = {"video_id": rec["id"], "fields": {"thumbnail": {"cover": cover}}}
        r = client.post("/api/library/validate", json=body, headers=agent())
        assert r.status_code == 200, r.text
        return [v["rule"] for v in r.json()["violations"]]

    assert cover_rules(names[1]) == []
    assert cover_rules("0" * 32 + ".jpg") == ["cover_not_a_candidate"]
