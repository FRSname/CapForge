"""Publish MCP tools — the channel brief, the rule checks, the upload package.

The publish loop CapForge is built around has three steps and one direction:

1. **write structured fields** onto the record with `set_video_meta` (title,
   title_options, description, chapters, tags, …),
2. **validate** them with `validate_video` (and `check_chapters` before you
   commit a chapter list),
3. **read the package** with `get_upload_package` and show it to the user.

The package is *rendered from* the record, so it is an output, never an input:
pasting its text back into a field would duplicate the record inside itself.

`grab_frames` is the one tool here that writes: it adds thumbnail frames (files)
to the record's `thumbnail.candidates`; omit `candidates` from a `set_video_meta`
patch to leave them unchanged.

The rules live in Python once (`backend/library/validate.py`) — hard ones are
YouTube's own limits and are refused by `PATCH /api/library/{id}` before a write
lands; style ones come from the channel brief and are advice.

Same shape as `library.py` and `tracks.py`: `TOOLS`, `register(mcp, get_client)`,
the client resolved per call, **no import of `server`**, and every failure is an
error *dict* (`_library_call`) rather than a raised exception.
"""

from __future__ import annotations

from typing import Any, Callable, Optional

from .library_errors import _OK, _fail, _library_call

#: Severity buckets `validate_fields` answers with. Anything else is kept under
#: `other` rather than dropped — an unclassified finding is still a finding.
HARD = "hard"
STYLE = "style"
OTHER = "other"

#: The platforms `get_upload_package` can render: YouTube's upload package, then
#: the three clipboard posts. An unknown one is refused here, before a round trip.
SUPPORTED_PLATFORMS = ("youtube", "linkedin", "x", "instagram")

#: What `grab_frames` expects: seconds, from the transcript.
_TIMES_SHAPE = "[61.25, 184.0]"

#: What a usable `lang` looks like, for the refusal sentence.
_LANG_SHAPE = '"pl", "de" or "pt-BR"'

#: The shape every chapter has to have before it is worth a round trip.
_CHAPTER_SHAPE = '[{"start_s": 0, "title": "Cold open"}, …]'

ClientFactory = Callable[[], Any]

_get_client: Optional[ClientFactory] = None


def _capforge() -> Any:
    """The live HTTP client, resolved at call time (never cached here)."""
    if _get_client is None:  # pragma: no cover - register() runs at import
        raise RuntimeError("mcp_server.publish was never registered on the MCP server")
    return _get_client()


def _grouped(violations: list) -> dict:
    """Split findings by severity and say whether anything blocks the write.

    `ok` is about the *hard* rules only: a style finding is the brief's opinion
    and never stops `set_video_meta`, so an agent that treated it as a blocker
    would loop forever on a channel rule the user is happy to break.
    """
    buckets: dict[str, list] = {HARD: [], STYLE: [], OTHER: []}
    for violation in violations:
        severity = violation.get("severity") if isinstance(violation, dict) else None
        buckets[severity if severity in (HARD, STYLE) else OTHER].append(violation)
    grouped = {"status": _OK, HARD: buckets[HARD], STYLE: buckets[STYLE],
               "ok": not buckets[HARD]}
    # `other` only appears when there is something in it — an empty key would
    # read as "there is a third kind of rule", and there is not.
    return {**grouped, OTHER: buckets[OTHER]} if buckets[OTHER] else grouped


def _lang_refusal(lang: Any) -> Optional[dict]:
    """An error dict for a `lang` that cannot be a language code, else None."""
    if lang is None or (isinstance(lang, str) and lang.strip()):
        return None
    return _fail(
        f"Pass 'lang' as a language code like {_LANG_SHAPE}, or leave it out for "
        "the source language."
    )


def _channel_refusal(channel: Any) -> Optional[dict]:
    """An error dict for a `channel` that cannot be a channel id, else None."""
    if channel is None or (isinstance(channel, str) and channel.strip()):
        return None
    return _fail(
        "Pass 'channel' as a channel id from list_channels (e.g. \"update-conf\"), or "
        "leave it out for the primary channel."
    )


def _validate(body: dict) -> dict:
    """POST one validate body and group what comes back."""
    def _call() -> dict:
        answer = _capforge().library_validate(body) or {}
        return _grouped(answer.get("violations") or [])

    return _library_call(_call)


# --- Tools ----------------------------------------------------------------

def get_brief() -> dict:
    """Read the channel brief — who the channel is for and how it writes.

    The brief is an alias onto the **primary channel** (always a YouTube
    channel): `channel` is its name, `audience` and `voice` come from its
    context, then its `language` (empty means the transcript's) and its profile:
    `footer`, the recorded-at line, the speaker block, default hashtags, link
    rows, and `house_rules` (no em dashes, a description length window, a
    keyword count, hook-in-the-first-150). Prefer `get_channel` for channel
    work: it also shows the context the brief leaves out (about, title style
    and example titles, naming, keywords, notes).

    Read it **before** writing any text: it is the style contract the user
    already stated, and `validate_video` reports its house rules as `style`
    findings. It is not per-video — anything specific to one video belongs on
    the record via `set_video_meta`.
    """
    return _library_call(
        lambda: {"status": _OK, "brief": _capforge().library_brief_get()}
    )


def set_brief(patch: dict) -> dict:
    """Update the channel brief — top-level fields are merged, not replaced.

    The brief is an alias onto the **primary channel**: `channel` renames it,
    `audience` and `voice` land in its context, `language` on the channel, and
    the rest in its profile. Prefer `set_channel` for channel work.

    Use this only for what the user tells you about the *channel* (its audience,
    voice, footer, default hashtags, house rules), and prefer letting them edit
    it in Settings → Channels. A list field is replaced wholesale by the list you
    send, so read `get_brief()` first and send back the whole list.

    Never park a single video's title, description or chapters here — those are
    record fields (`set_video_meta`).
    """
    if not isinstance(patch, dict) or not patch:
        return _fail("Pass a non-empty 'patch' object of brief fields.")

    return _library_call(
        lambda: {"status": _OK, "brief": _capforge().library_brief_patch(patch)}
    )


def validate_video(
    video_id: str, lang: Optional[str] = None, channel: Optional[str] = None
) -> dict:
    """Check a record's authored fields against the publish rules.

    Run it after writing fields with `set_video_meta` and before reading the
    package. Returns `{hard, style, ok}` — each finding names the `field`, the
    `rule` it broke and a `message`:

    - **hard** — YouTube's own limits and the chapter rules (title ≤ 100 chars,
      description ≤ 5000 bytes, tags line ≤ 500 chars, no angle brackets, first
      chapter at 0, at least three, ascending, ≥ 10s apart, inside the
      duration). CapForge *refuses the write* on these, so fix every one.
    - **style** — the channel brief's house rules. Follow them unless the user
      said otherwise; they never block a write.

    `ok` is true when there is no hard finding left. Fields and duration are
    read from the record, so nothing needs to be open in the app.

    Without `lang`, every language under `localized` is checked too (findings
    name `localized.<lang>.<field>`). Pass `lang` (e.g. "pl", a key of the
    record's `localized`) to check that language's package view: its translated
    fields are judged by the same rules under `localized.<lang>.<field>`, and a
    field still in the source language keeps its root name. The source
    language, or no `lang`, checks the record as written. See
    `publish_guide("localized")`.

    Pass `channel` (an id from `list_channels`) to judge that channel's post
    (`get_video` → `posts.<channel>`) against its platform's rules: a YouTube
    post by the rules above under that channel's brief, a TikTok, Instagram,
    LinkedIn or X post by that platform's limits on the pasted text. Findings
    then name `posts.<channel>.<field>`, and a field the platform does not have
    (a TikTok `title`) is a hard `field_not_on_platform`. No `channel` checks
    the root fields, which are the primary channel's post. See
    `publish_guide("channels")`.
    """
    refusal = _lang_refusal(lang) or _channel_refusal(channel)
    if refusal is not None:
        return refusal
    body: dict = {"video_id": video_id}
    if lang is not None:
        body = {**body, "lang": lang}
    if channel is not None:
        body = {**body, "channel": channel}
    return _validate(body)


def check_chapters(video_id: str, chapters: list[dict]) -> dict:
    """Dry-run a chapter list against the record's duration — nothing is written.

    Pass the list you are *about to* write, shaped like
    `[{"start_s": 0, "title": "Cold open"}, …]`; `start_s` is **seconds**
    (floats are fine), and the times must come from the transcript —
    `find_video_moments(video_id, kind="pause")` or `kind="speaker_change"`, or
    a segment start — never from an estimate of where a topic "probably" begins.

    Checks only the chapters, against the duration CapForge knows: first at 0,
    at least three, strictly ascending, at least 10 seconds apart, all inside
    the video. Same `{hard, style, ok}` answer as `validate_video`. Once it is
    clean, write the list with `set_video_meta`.
    """
    if not isinstance(chapters, list) or not chapters:
        return _fail(f"Pass a non-empty 'chapters' list shaped like {_CHAPTER_SHAPE}.")
    if any(not isinstance(chapter, dict) for chapter in chapters):
        return _fail(f"Every chapter must be an object like {_CHAPTER_SHAPE}.")

    # A copy: the caller's list is theirs, and the body must not alias it.
    return _validate({"video_id": video_id, "fields": {"chapters": list(chapters)}})


def get_upload_package(
    video_id: str,
    platform: str = "youtube",
    lang: Optional[str] = None,
    channel: Optional[str] = None,
) -> dict:
    """Render the record into one copy-ready block of text for the user.

    The last step: by default (`platform="youtube"`) CapForge assembles the
    stored fields and the channel brief into the layout the user pastes into
    YouTube Studio (title options,
    description with chapters and links, tags, short description, Shorts,
    thumbnail ideas, notes). Show the `text` as-is — it is plain text on
    purpose.

    This is **output only**. Never write any of it back with `set_video_meta`:
    the fields are the source, the package is the rendering. To change the
    package, change a field and read it again.

    It renders even when rules are unmet and the findings ride along in
    `violations`, so run `validate_video` first and fix the hard ones —
    otherwise you are handing the user text YouTube will reject.

    Pass `lang` (a key of the record's `localized`, e.g. "pl") for the package in
    that language: the translated title, description, short description, tags,
    hashtags, chapter titles and Shorts caption replace the source ones, title
    options and highlights are left out, and NOTES lists every field still in
    the source language. No `lang`, or the source language, is the source
    package; a language with no localized fields is an error.

    The other platforms render one post each from the same fields and brief
    (and `lang`). They are clipboard text: nothing is posted, CapForge holds no
    account access, and the user pastes the text themselves.

    - **LinkedIn** (`"linkedin"`): the hook (the short description, else the
      description's first paragraph), the rest of the description, up to 5
      chapters under "In this video:", `Watch: <url>` on its own line, then the
      first 5 hashtags. Limit 3000 characters; fewer than 3 hashtags is a style
      finding.
    - **X** (`"x"`): the title (else the short description), the URL, then as
      many whole hashtags as still fit, dropped from the end. Limit 280, with
      every URL counted as 23. The prose is never cut, so a long title is a
      hard finding rather than a shorter post. X's heavier weighting of emoji
      and CJK characters is not modelled, so leave headroom when using them.
    - **Instagram** (`"instagram"`): the short description (else the first
      paragraph), "Link in bio" (captions don't link), then at most 30 hashtags
      in one block. Limit 2200 characters.

    The posts read `publish.youtube.url`; until it is recorded they print
    [FULL VIDEO URL] with a `video_url_missing` finding. The brief's footer is
    YouTube-only and never printed. A post's `violations` are the record's own
    findings, then the post's (field `package.<platform>`); a hard
    `<platform>_max_chars` means the text won't paste as-is, so shorten the
    field it came from and read the post again.

    **Per channel** (`channel`, an id from `list_channels`): renders that
    channel's own post (`get_video` → `posts.<channel>`) instead of deriving one
    from the root fields. A YouTube channel gets the layout above with that
    channel's brief; a TikTok, Instagram, LinkedIn or X channel gets the pasted
    text (its caption or text, then its hashtags line). The answer carries the
    `channel` and its `platform`. A channel names its platform already, so
    `channel` together with a `platform` other than "youtube" is refused. A
    channel the video has no post for is an error (`no_post`). No `channel` is
    the primary channel's package, exactly as before.
    """
    if platform not in SUPPORTED_PLATFORMS:
        supported = ", ".join(SUPPORTED_PLATFORMS)
        return _fail(
            f"CapForge has no {platform!r} package layout — supported: {supported}."
        )
    refusal = _lang_refusal(lang) or _channel_refusal(channel)
    if refusal is not None:
        return refusal
    if channel is not None and platform != "youtube":
        return _fail(
            f"Pass either 'channel' or 'platform', not both: channel {channel!r} already "
            f"names its platform. Drop platform={platform!r} to render that channel's post."
        )
    if channel is not None:
        return _channel_package(video_id, channel, lang)
    extra = {} if lang is None else {"lang": lang}

    def _call() -> dict:
        rendered = _capforge().library_package(video_id, platform=platform, **extra) or {}
        return {
            "status": _OK,
            "platform": rendered.get("platform", platform),
            "text": rendered.get("text", ""),
            "violations": rendered.get("violations") or [],
        }

    return _library_call(_call)


def _channel_package(video_id: str, channel: str, lang: Optional[str]) -> dict:
    """One channel's package, relaying the `channel` and `platform` the backend
    answers with (the platform is the channel's, so it is never assumed here)."""
    extra = {} if lang is None else {"lang": lang}

    def _call() -> dict:
        rendered = _capforge().library_package(video_id, channel=channel, **extra) or {}
        return {
            "status": _OK,
            "channel": rendered.get("channel", channel),
            "platform": rendered.get("platform"),
            "text": rendered.get("text", ""),
            "violations": rendered.get("violations") or [],
        }

    return _library_call(_call)


def grab_frames(video_id: str, times: list[float]) -> dict:
    """Grab still frames from a video as thumbnail candidates (JPEG files on the record).

    Pick the times from the transcript, never a guess:
    `find_video_moments(video_id, query=…)` for the moment a thumbnail idea is
    about, or a highlight's `start_s`. Times are **seconds**, inside the video;
    at most 8 per call and 24 frames per record. A frame is at most 1280 px on
    its long edge (a vertical video gives a vertical frame) and at most 2 MB.

    Returns `{frames: [{time_s, name}], failed: [{time_s, reason}], rev}`: each
    kept frame is appended to the record's `thumbnail.candidates`, and `rev` is
    the record's new revision. A time ffmpeg could not use is under `failed`;
    the rest still land.

    To choose the cover, call `set_video_meta` with that `rev` and
    `{"thumbnail": {"cover": "<name>"}}`. Omit `candidates` (and `cover`) to
    leave them unchanged; this tool adds frames, and only an explicit changed
    `candidates` list is refused (`candidates_managed`). A cover that is not one
    of the candidates is refused too. The upload package then prints the cover's
    file path.
    """
    if not isinstance(times, list) or not times:
        return _fail(f"Pass a non-empty 'times' list of seconds, e.g. {_TIMES_SHAPE}.")
    if any(isinstance(t, bool) or not isinstance(t, (int, float)) for t in times):
        return _fail(f"Every entry in 'times' must be a number of seconds, e.g. {_TIMES_SHAPE}.")
    requested = [float(t) for t in times]

    def _call() -> dict:
        answer = _capforge().library_grab_frames(video_id, requested) or {}
        return {
            "status": _OK,
            "frames": answer.get("frames") or [],
            "failed": answer.get("failed") or [],
            "rev": answer.get("rev"),
        }

    return _library_call(_call)


#: The six tools this module contributes, in the order they are registered.
TOOLS = (
    get_brief,
    set_brief,
    validate_video,
    check_chapters,
    get_upload_package,
    grab_frames,
)


def register(mcp: Any, get_client: ClientFactory) -> None:
    """Register the publish tools on the server's FastMCP instance.

    `get_client` is called per request rather than stored, so the server's own
    `_client` remains the one object that has to exist (or be patched).
    """
    global _get_client
    _get_client = get_client
    for tool in TOOLS:
        mcp.tool()(tool)
