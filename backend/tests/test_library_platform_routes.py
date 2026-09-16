"""``POST /api/library/{id}/posts/{channel}/draft?from=<channel>`` — "Start from…".

docs/plans/multi-channel-pr4-contract.md Part A. One tab's text rendered as
another tab's draft: the same three platform layouts the package route used to
serve under ``?platform=``, now reached as "start an Instagram post from the
YouTube tab". The route **never stores anything** — no write, no ``rev`` bump,
no history — and the target channel's default hashtags stay out of the body,
because ``pasted_text`` adds them when the post is copied.
"""

from __future__ import annotations

import pytest

from backend.library import posters

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
)

BASE = "/api/library"
PRIMARY = "youtube-channel"
DURATION_S = 600.0
URL = "https://youtu.be/abc123"
TITLE = "Captions without a render farm"
SHORT = "How CapForge renders captions locally."
#: Longer than the 150-character hook, so the paragraph break trips no house rule.
FIRST_PARAGRAPH = " ".join(["The render farm was the bottleneck."] * 5)
DESCRIPTION = f"{FIRST_PARAGRAPH}\n\nHere is what we run instead."
HASHTAGS = ["captions", "whisper", "ffmpeg"]
MOMENTS = "In this video:\n00:00 Intro\n01:00 Middle\n03:00 End"

#: platform → (the post field its body lands in, the body a YouTube tab becomes).
SOCIAL_DRAFTS = {
    "linkedin": ("text", f"{SHORT}\n\n{DESCRIPTION}\n\n{MOMENTS}\n\nWatch: {URL}"),
    "x": ("text", f"{TITLE}\n\n{URL}"),
    "instagram": ("caption", f"{SHORT}\n\nLink in bio"),
}


@pytest.fixture(autouse=True)
def _no_poster_grabs(monkeypatch):
    monkeypatch.setattr(posters, "start_grab", lambda store, record, on_changed=None: None)


def new_channel(client, platform: str, name: str, **body) -> str:
    r = client.post(f"{BASE}/channels", json={"platform": platform, "name": name, **body},
                    headers=agent())
    assert r.status_code == 201, r.text
    return r.json()["id"]


def patched(client, video_id: str, body: dict) -> dict:
    rev = client.get(f"{BASE}/{video_id}", headers=agent()).json()["rev"]
    r = client.patch(f"{BASE}/{video_id}", json=body, headers=agent(**{"If-Match": str(rev)}))
    assert r.status_code == 200, r.text
    return r.json()


def published_record(client, media, *, channels=(), **extra) -> str:
    """A record with a filled primary (YouTube) post, and an empty post per channel."""
    rec = create(client, media, channels=list(channels))
    client.put(f"{BASE}/{rec['id']}/project", json=project(duration=DURATION_S), headers=agent())
    patched(client, rec["id"], {
        "title": TITLE,
        "short_description": SHORT,
        "description": DESCRIPTION,
        "chapters": LEGAL_CHAPTERS,
        "hashtags": list(HASHTAGS),
        "publish": {"youtube": {"url": URL}},
        **extra,
    })
    return rec["id"]


def draft(client, video_id: str, channel_id: str, source: str):
    return client.post(f"{BASE}/{video_id}/posts/{channel_id}/draft",
                       params={"from": source}, headers=agent())


# --- the shapes ---------------------------------------------------------------------

@pytest.mark.parametrize("platform", sorted(SOCIAL_DRAFTS))
def test_each_platform_drafts_its_own_post_from_the_youtube_tab(client, media, platform) -> None:
    field, body = SOCIAL_DRAFTS[platform]
    target = new_channel(client, platform, f"Filip {platform}")
    video_id = published_record(client, media, channels=[target])

    r = draft(client, video_id, target, PRIMARY)

    assert r.status_code == 200, r.text
    answer = r.json()
    assert set(answer) == {"channel", "from", "platform", "fields"}
    assert (answer["channel"], answer["from"], answer["platform"]) == (target, PRIMARY, platform)
    assert answer["fields"] == {field: body, "hashtags": HASHTAGS}


def test_a_draft_carries_no_findings(client, media) -> None:
    """The text is a draft the user has not accepted; ``POST /validate`` judges it
    once it lands — an over-limit body is still handed back."""
    target = new_channel(client, "linkedin", "Filip LI")
    long_description = "D " * 1600  # legal on the record, past LinkedIn's 3000
    video_id = published_record(client, media, channels=[target],
                                description=long_description)

    answer = draft(client, video_id, target, PRIMARY).json()

    assert "violations" not in answer
    assert len(answer["fields"]["text"]) > 3000


def test_the_targets_default_hashtags_are_neither_pasted_twice_nor_in_the_body(
    client, media
) -> None:
    target = new_channel(client, "instagram", "Filip IG",
                         profile={"default_hashtags": ["FilipIG"]})
    video_id = published_record(client, media, channels=[target])

    fields = draft(client, video_id, target, PRIMARY).json()["fields"]

    assert "FilipIG" not in fields["caption"] and "#" not in fields["caption"]
    assert fields["hashtags"] == HASHTAGS


def test_a_youtube_target_takes_the_source_body_and_never_a_title(client, media) -> None:
    second = new_channel(client, "youtube", "Second")
    video_id = published_record(client, media, channels=[second])

    fields = draft(client, video_id, second, PRIMARY).json()["fields"]

    assert fields == {"description": DESCRIPTION, "short_description": SHORT,
                      "hashtags": HASHTAGS}


def test_a_non_youtube_source_maps_its_body_onto_the_draft(client, media) -> None:
    source = new_channel(client, "linkedin", "Filip LI")
    target = new_channel(client, "instagram", "Filip IG")
    video_id = published_record(client, media, channels=[source, target])
    patched(client, video_id, {"posts": {source: {"text": "A LinkedIn post.\n\nTwo paragraphs.",
                                                  "hashtags": ["devops"]}}})

    to_youtube = draft(client, video_id, PRIMARY, source).json()["fields"]
    to_instagram = draft(client, video_id, target, source).json()["fields"]

    assert to_youtube == {"description": "A LinkedIn post.\n\nTwo paragraphs.",
                          "short_description": "", "hashtags": ["devops"]}
    # Instagram's own layout, over the LinkedIn body: no short description, so the
    # first paragraph is the caption.
    assert to_instagram == {"caption": "A LinkedIn post.\n\nLink in bio",
                            "hashtags": ["devops"]}


def test_a_tiktok_target_has_no_layout_and_takes_the_source_body(client, media) -> None:
    """TikTok is a channel platform with no post layout (``platform_posts.PLATFORMS``),
    so the draft is the plain adaptation rather than a 500."""
    target = new_channel(client, "tiktok", "Clips")
    video_id = published_record(client, media, channels=[target])

    fields = draft(client, video_id, target, PRIMARY).json()["fields"]

    assert fields == {"caption": DESCRIPTION, "hashtags": HASHTAGS}


# --- it never stores ----------------------------------------------------------------

def test_a_draft_leaves_the_record_exactly_as_it_was(client, media) -> None:
    target = new_channel(client, "linkedin", "Filip LI")
    video_id = published_record(client, media, channels=[target])
    before = client.get(f"{BASE}/{video_id}", headers=agent()).json()

    assert draft(client, video_id, target, PRIMARY).status_code == 200

    after = client.get(f"{BASE}/{video_id}", headers=agent()).json()
    assert after == before
    assert after["rev"] == before["rev"]
    assert after["posts"][target] == {**after["posts"][target], "text": "", "hashtags": []}


# --- refusals -----------------------------------------------------------------------

def test_an_unknown_record_is_404(client, media) -> None:
    target = new_channel(client, "x", "Filip X")

    assert draft(client, "nope", target, PRIMARY).status_code == 404


@pytest.mark.parametrize("target,source", [("nowhere", PRIMARY), (PRIMARY, "nowhere")])
def test_an_unknown_channel_on_either_side_is_404(client, media, target, source) -> None:
    video_id = published_record(client, media)

    r = draft(client, video_id, target, source)

    assert r.status_code == 404
    assert r.json().get("reason") != "no_post"


@pytest.mark.parametrize("swap", [False, True])
def test_a_channel_with_no_post_on_either_side_is_404_no_post(client, media, swap) -> None:
    other = new_channel(client, "instagram", "Filip IG")
    video_id = published_record(client, media)  # only the primary has a post
    target, source = (PRIMARY, other) if swap else (other, PRIMARY)

    r = draft(client, video_id, target, source)

    assert r.status_code == 404
    assert r.json()["reason"] == "no_post" and other in r.json()["detail"]


def test_a_tab_cannot_start_from_itself(client, media) -> None:
    target = new_channel(client, "linkedin", "Filip LI")
    video_id = published_record(client, media, channels=[target])

    r = draft(client, video_id, target, target)

    assert r.status_code == 422
    assert "itself" in r.json()["detail"]


def test_the_package_route_no_longer_takes_a_platform(client, media) -> None:
    """Part B: ``?platform=`` is gone; an unknown query param is simply ignored."""
    video_id = published_record(client, media)

    plain = client.get(f"{BASE}/{video_id}/package", headers=agent())
    with_param = client.get(f"{BASE}/{video_id}/package", params={"platform": "linkedin"},
                            headers=agent())

    assert plain.status_code == with_param.status_code == 200
    assert with_param.json() == plain.json()
    assert plain.json()["platform"] == "youtube"
