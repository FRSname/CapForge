"""Whole-track wrap/overflow scan for the agent's layout loop.

``analyze_layout`` (frame_qa.py) answers "where is the caption box at time *t*"
by rendering a frame. That is the right tool for one moment and the wrong one
for a question like "which of these 1 150 groups will spill onto a third line" —
rasterizing every group would take minutes.

So this module measures instead of drawing: it reuses the renderer's own
``measure_group_words`` + ``wrap_rows`` (moved out of ``_render_frame`` for
exactly this) so the row split reported here is the row split Pillow will draw.
No frame is ever rendered.

Translating captions is what makes this necessary: Polish and German run
10-15 % longer than English, so a track that fits on two lines in the source
routinely spills on the translation. See
docs/plans/multi-language-caption-tracks-plan.md → Phase 4.
"""

from __future__ import annotations

from backend.exporters.video_render import _get_font, measure_group_words, wrap_rows
from backend.models.schemas import VideoRenderConfig

# Two rows is the caption convention every platform's guidance assumes, and the
# default the agent scans against unless it asks for another.
DEFAULT_MAX_LINES = 2

# Why RSVP reports no violations: it is a single unwrapped line that slides, so
# "wraps onto a third row" is not a state it has.
RSVP_NOTE = "RSVP is a single sliding line; wrap overflow does not apply"


def scan_layout(
    config: VideoRenderConfig,
    groups: list[dict],
    max_lines: int = DEFAULT_MAX_LINES,
) -> dict:
    """Measure every caption group and report the ones that will not fit.

    ``groups`` must already be the *rendered* groups (i.e. run through
    ``groups_for_render``), so the scan sees the same list Pillow will.

    A group is a violation when it wraps onto more than ``max_lines`` rows, or
    when its widest row exceeds the caption box (one word longer than
    ``max_width`` — unbreakable, so wrapping cannot save it). Word-less
    placeholder groups (an untranslated group on a translated track) are counted
    in ``scanned`` and can never violate.
    """
    reading_mode = getattr(config, "reading_mode", "wrap")
    max_w_px = config.resolution_w * getattr(config, "max_width", 0.9)
    out: dict = {
        "scanned": len(groups),
        "mode": reading_mode,
        "max_lines": max_lines,
        "max_width_px": max_w_px,
        "violations": [],
    }
    if reading_mode == "rsvp":
        out["note"] = RSVP_NOTE
        return out

    # One font for the whole scan: it is a property of the config, not of a
    # group, and _get_font hits the filesystem on every call.
    font = _get_font(
        config.font_family, config.font_size, config.custom_font_path, bold=config.bold
    )
    effective_space_w = font.getlength(" ") + config.word_spacing
    num_lines = max(1, getattr(config, "lines", 1))

    for index, group in enumerate(groups):
        metrics = measure_group_words(config, font, group.get("words") or [])
        if not metrics:
            continue
        rows = wrap_rows(
            metrics,
            effective_space_w=effective_space_w,
            max_w_px=max_w_px,
            num_lines=num_lines,
            is_rsvp=False,
        )
        row_widths = [
            sum(m["width"] for m in row) + effective_space_w * max(0, len(row) - 1)
            for row in rows
        ]
        max_row_w = max(row_widths)
        if len(rows) > max_lines or max_row_w > max_w_px:
            out["violations"].append({
                "group_id": group.get("id"),
                "index": index,
                "start": group.get("start"),
                "end": group.get("end"),
                "text": group.get("text", ""),
                "lines": len(rows),
                "max_row_px": max_row_w,
                "overflow_px": max(0.0, max_row_w - max_w_px),
            })

    return out
