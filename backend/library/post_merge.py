"""How a ``posts`` patch lands on the stored posts (PR 2 contract → Merge). Pure.

* **Per channel:** an omitted channel is kept, ``{channel: null}`` removes its
  post, and a channel with no post yet starts from an empty one.
* **Per field:** sent fields replace, omitted ones are kept, and a field sent as
  ``null`` goes back to its default (``cover: null`` clears the cover).
* **``localized``** inside a post merges per language, exactly like the root's
  (``localized.merge_localized``); ``localized: null`` clears every language.
* **A YouTube ``published.url`` with no ``id``** gets the id read from the URL.
"""

from __future__ import annotations

from typing import Any, Mapping, Optional

from backend.library.localized import merge_localized
from backend.library.platforms import YOUTUBE
from backend.library.schemas import Post, PostPatch
from backend.library.youtube_url import youtube_id_from_url

LOCALIZED = "localized"
PUBLISHED = "published"


def merge_post(stored: Optional[Post], patch: PostPatch, *, platform: Optional[str]) -> Post:
    """``stored`` (or an empty post) with ``patch``'s sent fields applied."""
    base = stored or Post()
    update = {name: _merged_field(base, name, getattr(patch, name))
              for name in patch.model_fields_set}
    merged = base.model_copy(update=update, deep=True)
    return _with_derived_id(merged, platform) if PUBLISHED in update else merged


def merge_posts(
    stored: Mapping[str, Post],
    patch: Mapping[str, Optional[PostPatch]],
    *,
    platforms: Mapping[str, str],
) -> dict[str, Post]:
    """Every stored post with ``patch`` applied per channel, as a new dict.

    Stored channels keep their order; new ones follow in the patch's order.
    ``platforms`` maps a channel id to its platform (an unknown id derives no
    YouTube id; the route refuses unknown ids before this runs).
    """
    removed = {cid for cid, value in patch.items() if value is None}
    kept = {
        cid: merge_post(post, patch[cid], platform=platforms.get(cid)) if cid in patch else post
        for cid, post in stored.items()
        if cid not in removed
    }
    added = {
        cid: merge_post(None, value, platform=platforms.get(cid))
        for cid, value in patch.items()
        if value is not None and cid not in stored
    }
    return {**kept, **added}


def _merged_field(base: Post, name: str, value: Any) -> Any:
    if name == LOCALIZED:
        return {} if value is None else merge_localized(base.localized, value)
    if value is None:
        return Post.model_fields[name].get_default(call_default_factory=True)
    return value


def _with_derived_id(post: Post, platform: Optional[str]) -> Post:
    published = post.published
    if platform != YOUTUBE or published.id or not published.url:
        return post
    derived = youtube_id_from_url(published.url)
    if derived is None:
        return post
    return post.model_copy(update={PUBLISHED: published.model_copy(update={"id": derived})})
