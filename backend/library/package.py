"""The upload package: one record, rendered as the text the user pastes.

**Fields are the source, the package is the rendering** (the publish skill's
first rule). Nothing here authors anything — it reads a ``VideoRecord``, a
``Brief`` and the record's collection, and lays them out in the order the skill
promises, dropping every section whose data is empty so no header is ever
printed with nothing under it.

The DESCRIPTION block goes through the **effective** brief's
``description_template`` (``template.py``; collections plan, decision 4). An
empty template is ``DEFAULT_DESCRIPTION_TEMPLATE``, which reproduces the
pre-template layout byte for byte. Nothing is stored per video, so a changed
collection footer reaches every member's package on the next render.

``format_timestamp`` lives here and is the **one** formula with a renderer twin
(``lib/youtubeRules.ts``); both are pinned against
``backend/tests/fixtures/timestamp_cases.json`` — the RSVP precedent.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional, Sequence

from backend.library.brief import Brief
from backend.library.collection_store import Collection, effective_brief
from backend.library.schemas import Chapter, Link, Speaker, ThumbnailIdea, VideoRecord
from backend.library.template import (
    DEFAULT_DESCRIPTION_TEMPLATE,
    render_template,
    slot_references,
)

#: The skill's horizontal rule: 69 ``=``, above and below every section header.
RULE_WIDTH = 69
SECTION_RULE = "=" * RULE_WIDTH

SECONDS_PER_MINUTE = 60
SECONDS_PER_HOUR = 3600

#: Printed where a diarized speaker has no name yet, and listed under NOTES.
SPEAKER_NAME_PLACEHOLDER = "[SPEAKER NAME]"
#: Printed in SHORTS until the user pastes the published URL.
FULL_VIDEO_URL_PLACEHOLDER = "[FULL VIDEO URL]"
PLACEHOLDERS_HEADER = "Placeholders still open:"
#: Listed under NOTES for every ``{{slot}}`` nothing defines (never shipped silently).
UNKNOWN_SLOTS_HEADER = "Unknown template slots, printed as written:"

TAG_SEPARATOR = ", "
THUMBNAIL_SEPARATOR = " — "
SHORTS_HASHTAG = "#Shorts"
BLOCK_SEPARATOR = "\n\n"

#: Brief lines that are themselves templates: ``(slot, Brief field)``. Each is
#: expanded with every other slot, so ``{{footer}}`` inside the footer is unknown
#: rather than recursive.
EXPANDED_BRIEF_LINES = (("recorded_at", "recorded_at_line"), ("footer", "footer"))


def format_timestamp(seconds: float) -> str:
    """``MM:SS`` below an hour, ``H:MM:SS`` from one; floored to the second.

    A negative time is ``00:00`` rather than an error: this formats a chapter a
    user may still be dragging, and the validators are what refuse a bad one.
    """
    total = max(int(math.floor(seconds)), 0)
    hours, rest = divmod(total, SECONDS_PER_HOUR)
    minutes, secs = divmod(rest, SECONDS_PER_MINUTE)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


@dataclass(frozen=True)
class _Block:
    """A rendered section plus the placeholders it left open (never mutated)."""

    text: str
    placeholders: tuple[str, ...] = ()


@dataclass(frozen=True)
class AssembledDescription:
    """The DESCRIPTION body as pasted, what it left open, and what it could not fill."""

    body: str
    placeholders: tuple[str, ...] = ()
    unknown_slots: tuple[str, ...] = ()


def render_youtube_package(
    record: VideoRecord,
    brief: Brief,
    *,
    duration: Optional[float],
    source_name: str,
    diarized_ids: Sequence[str] = (),
    collection: Optional[Collection] = None,
) -> str:
    """The full package text. ``duration`` may be None (no transcript yet).

    ``diarized_ids`` are the speaker ids the transcript carries (``SPEAKER_00``
    …); one the record has not named yet is printed as the placeholder and
    listed under NOTES, so an unnamed speaker is never silently dropped.
    ``brief`` is the channel brief; ``collection``'s overrides are applied here.
    """
    description = assemble_description(
        record, brief, collection=collection, diarized_ids=diarized_ids
    )
    shorts = _shorts_section(record, effective_brief(brief, collection))
    notes = _notes_section(
        record,
        duration=duration,
        source_name=source_name,
        placeholders=(*description.placeholders, *shorts.placeholders),
        unknown_slots=description.unknown_slots,
    )
    sections = [
        _title_options_section(record),
        _section("DESCRIPTION", description.body, lead_blank=True),
        _section("TAGS", TAG_SEPARATOR.join(t.strip() for t in record.tags if t.strip())),
        _section("SHORT DESCRIPTION", record.short_description.strip()),
        shorts.text,
        _section("THUMBNAIL IDEAS", _thumbnail_lines(record.thumbnail.ideas)),
        notes,
    ]
    return BLOCK_SEPARATOR.join(part for part in sections if part) + "\n"


def _section(header: str, body: str, *, lead_blank: bool = False) -> str:
    """A ruled section, or ``""`` when there is nothing to put under the header."""
    if not body:
        return ""
    gap = "\n\n" if lead_blank else "\n"
    return f"{SECTION_RULE}\n{header}\n{SECTION_RULE}{gap}{body}"


def _join(blocks: Sequence[str]) -> str:
    return BLOCK_SEPARATOR.join(block for block in blocks if block)


def _labelled(header: str, lines: Sequence[str]) -> str:
    """``HEADER`` + its lines, or ``""`` — an unruled block inside DESCRIPTION."""
    return "\n".join([header, *lines]) if lines else ""


# --- TITLE OPTIONS -----------------------------------------------------------

def _title_options_section(record: VideoRecord) -> str:
    """The numbered options, led by the title the user picked.

    The chosen ``title`` goes first even when it is not one of the options:
    a package whose title is missing is the one thing the user cannot paste.
    """
    options: list[str] = []
    for candidate in (record.title, *record.title_options):
        text = candidate.strip()
        if text and text not in options:
            options.append(text)
    if not options:
        return ""
    return "\n".join(
        ["TITLE OPTIONS", *(f"{i}. {text}" for i, text in enumerate(options, start=1))]
    )


# --- DESCRIPTION -------------------------------------------------------------

def assemble_description(
    record: VideoRecord,
    brief: Brief,
    *,
    collection: Optional[Collection] = None,
    diarized_ids: Sequence[str] = (),
) -> AssembledDescription:
    """The DESCRIPTION body through the effective template, one expansion pass.

    The footer and the recorded-at line are expanded first (with every slot but
    themselves), then the template. Placeholders and unknown slots are reported
    only for text the template actually prints.
    """
    effective = effective_brief(brief, collection)
    speakers = _speaker_blocks(record.speakers, effective.speaker_block, diarized_ids)
    slots = {**effective.slots, **_builtin_blocks(record, effective, collection, speakers.text)}
    template = effective.description_template
    if not template.strip():
        template = DEFAULT_DESCRIPTION_TEMPLATE
    used = set(slot_references(template))
    lines = {
        slot: render_template(getattr(effective, field), slots)
        for slot, field in EXPANDED_BRIEF_LINES
    }
    body = render_template(template, {**slots, **{s: r.text for s, r in lines.items()}})
    unknown = [
        *(name for slot, line in lines.items() if slot in used for name in line.unknown),
        *body.unknown,
    ]
    return AssembledDescription(
        body.text,
        speakers.placeholders if "speakers" in used else (),
        tuple(dict.fromkeys(unknown)),
    )


def _builtin_blocks(
    record: VideoRecord, brief: Brief, collection: Optional[Collection], speakers: str
) -> dict[str, str]:
    """Every built-in slot but ``recorded_at`` and ``footer`` (expanded after)."""
    return {
        "description": record.description.strip(),
        "title": record.title.strip(),
        "short_description": record.short_description.strip(),
        "highlights": _labelled("WHAT YOU'LL LEARN", [
            f"- {h.text.strip()}" for h in record.highlights if h.text.strip()
        ]),
        "chapters": _labelled("CHAPTERS", _chapter_lines(record.chapters)),
        "links": _labelled("LINKS", _link_lines([*record.links, *brief.link_rows])),
        "speakers": speakers,
        "hashtags": " ".join(hashtags(brief.default_hashtags, record.hashtags)),
        "channel": brief.channel.strip(),
        "collection": collection.name if collection is not None else "",
    }


def _chapter_lines(chapters: Sequence[Chapter]) -> list[str]:
    return [
        f"{format_timestamp(c.start_s)} {c.title.strip()}"
        for c in chapters
        if c.title.strip()
    ]


def _link_lines(links: Sequence[Link]) -> list[str]:
    return [
        f"{link.label.strip()}: {link.url.strip()}"
        for link in links
        if link.url.strip()
    ]


def _speaker_blocks(
    speakers: dict[str, Speaker], template: str, diarized_ids: Sequence[str] = ()
) -> _Block:
    """The brief's template, filled once per speaker; unnamed ones stay open.

    With no template there is no speaker section at all — and therefore no open
    placeholder, because nothing was printed that a name would go into.
    """
    if not template.strip():
        return _Block("")
    blocks: list[str] = []
    placeholders: list[str] = []
    # Record speakers first, then transcript speakers the record has no entry
    # for yet (an empty Speaker → the placeholder path below).
    unnamed = {sid: Speaker(name="") for sid in diarized_ids if sid not in speakers}
    for diarized_id, speaker in {**speakers, **unnamed}.items():
        name = speaker.name.strip()
        if not name:
            name = SPEAKER_NAME_PLACEHOLDER
            placeholders.append(f"{SPEAKER_NAME_PLACEHOLDER} for {diarized_id}")
        blocks.append(
            template.replace("{{name}}", name)
            .replace("{{handle}}", (speaker.handle or "").strip())
            .replace("{{url}}", (speaker.url or "").strip())
        )
    return _Block(_join(blocks), tuple(placeholders))


def hashtags(defaults: Sequence[str], authored: Sequence[str]) -> list[str]:
    """The brief's defaults first, then the record's, deduped case-insensitively
    and always ``#``-prefixed (either side may be stored with or without one)."""
    out: list[str] = []
    seen: set[str] = set()
    for raw in (*defaults, *authored):
        tag = raw.strip().lstrip("#").strip()
        if not tag or tag.casefold() in seen:
            continue
        seen.add(tag.casefold())
        out.append(f"#{tag}")
    return out


# --- SHORTS ------------------------------------------------------------------

def _shorts_section(record: VideoRecord, brief: Brief) -> _Block:
    caption = record.shorts.caption.strip()
    clips = record.shorts.clip_suggestions
    if not caption and not clips:
        return _Block("")
    url = (record.publish.youtube.url or "").strip()
    placeholders = () if url else (FULL_VIDEO_URL_PLACEHOLDER,)
    tags = [SHORTS_HASHTAG, *(
        tag for tag in hashtags(brief.default_hashtags, record.hashtags)
        if tag.casefold() != SHORTS_HASHTAG.casefold()
    )]
    body = _join([
        _labelled("CAPTION", caption.splitlines()),
        f"Full video: {url or FULL_VIDEO_URL_PLACEHOLDER}",
        " ".join(tags),
        _labelled("CLIP CANDIDATES", [
            f"{format_timestamp(c.start_s)}-{format_timestamp(c.end_s)} {c.why.strip()}"
            for c in clips
        ]),
    ])
    return _Block(_section("SHORTS", body), placeholders)


# --- THUMBNAIL IDEAS ---------------------------------------------------------

def _thumbnail_lines(ideas: Sequence[ThumbnailIdea]) -> str:
    """``headline — visual suggestion``, the recommended ideas first."""
    ordered = sorted(ideas, key=lambda idea: not idea.recommended)
    lines = []
    for idea in ordered:
        headline = idea.headline.strip()
        visual = (idea.visual_suggestion or "").strip()
        if not headline:
            continue
        lines.append(f"{headline}{THUMBNAIL_SEPARATOR}{visual}" if visual else headline)
    return "\n".join(lines)


# --- NOTES -------------------------------------------------------------------

def _notes_section(
    record: VideoRecord,
    *,
    duration: Optional[float],
    source_name: str,
    placeholders: tuple[str, ...],
    unknown_slots: tuple[str, ...] = (),
) -> str:
    source = f"Source: CapForge transcript, {source_name}"
    if duration is not None:
        source = f"{source}, {format_timestamp(duration)}"
    description = record.description
    lines = [
        source,
        f"Description: {len(description)} characters, "
        f"{len(description.encode('utf-8'))} bytes",
        f"Shorts caption: {len(record.shorts.caption)} characters",
        _chapters_note(record.chapters),
    ]
    if unknown_slots:
        lines += [UNKNOWN_SLOTS_HEADER, *(f"- {{{{{name}}}}}" for name in unknown_slots)]
    if placeholders:
        lines += [PLACEHOLDERS_HEADER, *(f"- {item}" for item in placeholders)]
    return _section("NOTES", "\n".join(lines))


def _chapters_note(chapters: Sequence[Chapter]) -> str:
    if not chapters:
        return "Chapters: none"
    note = f"Chapters: {len(chapters)}, first {format_timestamp(chapters[0].start_s)}"
    if len(chapters) < 2:
        return note  # a single chapter has no gap to report
    gap = min(b.start_s - a.start_s for a, b in zip(chapters, chapters[1:]))
    return f"{note}, minimum gap {gap:g}s"
