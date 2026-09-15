"""``GET /api/library/{id}/package?platform=linkedin|x|instagram`` (publish-editors C1).

Same record, effective brief and ``lang`` view as the YouTube package; the
answer is ``{platform, text, violations, description: null}``.
"""

from __future__ import annotations

import pytest

from backend.library import posters
from backend.library.package import FULL_VIDEO_URL_PLACEHOLDER

# The route fixtures (stubbed-ML app, both tokens) — imported so pytest sees them.
from backend.tests.test_library_routes import (  # noqa: F401
    LEGAL_CHAPTERS,
    agent,
    client,
    create,
    home,
    main_module,
    media,
    project,
    transcribed_record,
)

URL = "https://youtu.be/abc123"
SOCIAL = ("linkedin", "x", "instagram")
#: Longer than the 150-character hook, so the paragraph break trips no house rule.
FIRST_PARAGRAPH = " ".join(["The render farm was the bottleneck."] * 5)
DESCRIPTION = f"{FIRST_PARAGRAPH}\n\nHere is what we run instead."


@pytest.fixture(autouse=True)
def _no_poster_grabs(monkeypatch):
    monkeypatch.setattr(posters, "start_grab", lambda store, record, on_changed=None: None)


def package(client, video_id: str, **params):
    return client.get(f"/api/library/{video_id}/package", params=params, headers=agent())


def patched(client, video_id: str, body: dict) -> dict:
    rev = client.get(f"/api/library/{video_id}", headers=agent()).json()["rev"]
    r = client.patch(f"/api/library/{video_id}", json=body,
                     headers=agent(**{"If-Match": str(rev)}))
    assert r.status_code == 200, r.text
    return r.json()


def rules(body: dict) -> list[tuple[str, str]]:
    return [(v["field"], v["rule"]) for v in body["violations"]]


def published_record(client, media, **extra) -> str:
    video_id = transcribed_record(client, media)
    patched(client, video_id, {
        "title": "Captions without a render farm",
        "short_description": "How CapForge renders captions locally.",
        "description": DESCRIPTION,
        "chapters": LEGAL_CHAPTERS,
        "hashtags": ["captions", "whisper", "ffmpeg"],
        "publish": {"youtube": {"url": URL}},
        **extra,
    })
    return video_id


@pytest.mark.parametrize("platform", SOCIAL)
def test_each_platform_answers_the_package_shape_with_no_description(client, media, platform) -> None:
    video_id = published_record(client, media)

    r = package(client, video_id, platform=platform)

    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"platform", "text", "violations", "description"}
    assert body["platform"] == platform
    assert body["description"] is None
    assert body["violations"] == []
    assert "\r" not in body["text"] and not body["text"].endswith("\n")


def test_the_three_posts_as_rendered(client, media) -> None:
    video_id = published_record(client, media)
    tags = "#captions #whisper #ffmpeg"

    linkedin = package(client, video_id, platform="linkedin").json()["text"]
    x = package(client, video_id, platform="x").json()["text"]
    instagram = package(client, video_id, platform="instagram").json()["text"]

    assert linkedin == (
        "How CapForge renders captions locally.\n\n"
        f"{DESCRIPTION}\n\n"
        "In this video:\n00:00 Intro\n01:00 Middle\n03:00 End\n\n"
        f"Watch: {URL}\n\n{tags}"
    )
    assert x == f"Captions without a render farm\n\n{URL}\n\n{tags}"
    assert instagram == f"How CapForge renders captions locally.\n\nLink in bio\n\n{tags}"


def test_the_youtube_package_is_unchanged_and_keeps_its_description(client, media) -> None:
    video_id = published_record(client, media)

    default = package(client, video_id)
    explicit = package(client, video_id, platform="youtube")

    assert default.status_code == explicit.status_code == 200
    assert explicit.json() == default.json()
    assert default.json()["platform"] == "youtube"
    assert default.json()["description"].startswith("The render farm was the bottleneck.")
    assert default.json()["text"].startswith("TITLE OPTIONS\n")


def test_an_unknown_platform_is_still_400_and_names_the_supported_ones(client, media) -> None:
    video_id = published_record(client, media)

    r = package(client, video_id, platform="tiktok")

    assert r.status_code == 400
    detail = r.json()["detail"]
    assert "tiktok" in detail
    assert all(name in detail for name in ("youtube", "linkedin", "'x'", "instagram"))


def test_an_unknown_lang_is_still_404_on_a_platform_post(client, media) -> None:
    video_id = published_record(client, media)

    assert package(client, video_id, platform="linkedin", lang="fr").status_code == 404


def test_a_missing_url_prints_the_placeholder_and_reports_it(client, media) -> None:
    video_id = published_record(client, media, publish={"youtube": {"url": None}})

    for platform, expected in (("linkedin", ["video_url_missing"]), ("x", ["video_url_missing"]),
                               ("instagram", [])):
        body = package(client, video_id, platform=platform).json()
        assert [rule for _, rule in rules(body)] == expected, platform
        assert (FULL_VIDEO_URL_PLACEHOLDER in body["text"]) is bool(expected)


def test_the_record_findings_ride_first_then_the_posts(client, media) -> None:
    video_id = published_record(client, media, hashtags=[], publish={"youtube": {"url": None}},
                                description="A talk — with an em dash.")
    client.patch("/api/library/brief", json={"house_rules": {"no_em_dashes": True}},
                 headers=agent())

    body = package(client, video_id, platform="linkedin").json()

    assert rules(body) == [
        ("description", "no_em_dashes"),
        ("package.linkedin", "video_url_missing"),
        ("package.linkedin", "linkedin_hashtags"),
    ]


def test_the_assembled_description_findings_are_youtube_only(client, media) -> None:
    video_id = published_record(client, media)
    client.patch("/api/library/brief", json={"description_template": "{{description}} {{nope}}"},
                 headers=agent())

    youtube = package(client, video_id).json()
    linkedin = package(client, video_id, platform="linkedin").json()

    assert ("package.description", "unknown_slot") in rules(youtube)
    assert rules(linkedin) == []


def test_an_over_limit_post_is_still_rendered_with_its_hard_finding(client, media) -> None:
    video_id = published_record(client, media, title="T" * 100, short_description="S" * 200,
                                description="D " * 1400)

    x = package(client, video_id, platform="x").json()
    linkedin = package(client, video_id, platform="linkedin").json()

    assert x["text"].startswith("T" * 100) and rules(x) == []
    assert linkedin["text"].startswith("S" * 200)
    assert rules(linkedin) == [("package.linkedin", "linkedin_max_chars")]
    assert linkedin["violations"][0]["severity"] == "hard"


def test_lang_renders_the_localized_view_and_names_its_findings(client, media) -> None:
    video_id = published_record(client, media, localized={"de": {
        "title": "Untertitel — ohne Renderfarm",
        "short_description": "Wie CapForge lokal rendert.",
        "hashtags": ["Untertitel", "Lokal", "Schnell"],
    }})
    client.patch("/api/library/brief", json={"house_rules": {"no_em_dashes": True}},
                 headers=agent())

    x = package(client, video_id, platform="x", lang="de").json()
    instagram = package(client, video_id, platform="instagram", lang="de").json()

    assert x["text"] == f"Untertitel — ohne Renderfarm\n\n{URL}\n\n#Untertitel #Lokal #Schnell"
    assert rules(x) == [("localized.de.title", "no_em_dashes")]
    assert instagram["text"].startswith("Wie CapForge lokal rendert.\n\nLink in bio")
