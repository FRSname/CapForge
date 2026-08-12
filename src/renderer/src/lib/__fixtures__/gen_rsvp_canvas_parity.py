"""Generate ``rsvp_canvas_parity.json`` by RUNNING the Pillow reference.

Pillow is the declared source of truth for caption rendering
(``docs/caption-parity.md``), so the Canvas preview's numbers must be checked
against numbers the reference actually produced — not against a second reading of
its code. This script imports ``backend/exporters/rsvp_layout.py`` and
``caption_draw._measure_tracked`` (the real measurement primitive, whose ``n - 1``
tracking convention is the whole subtlety) and dumps what they return.

Run from the repo root::

    .venv-dev/bin/python src/renderer/src/lib/__fixtures__/gen_rsvp_canvas_parity.py

Consumed from **both** sides, so the JSON cannot go stale unnoticed:

* ``src/renderer/src/lib/overlayGeometry.rsvp.test.ts`` — asserts the Canvas
  renderer reproduces these numbers.
* ``backend/tests/test_rsvp_canvas_fixture.py`` — re-derives them from the live
  ``rsvp_layout`` reference and asserts the committed JSON still matches, so a
  drift in Pillow fails the backend suite instead of quietly invalidating the
  frontend one. That suite calls :func:`build_payload`, which is why the payload
  is built separately from :func:`main`'s file write.

**No font is loaded.** Both ``layout_line``'s ``measure`` callback and each word's
line advance are injected, so a *synthetic* font — a per-character width table —
drives the real primitives. That is what makes the expected values reproducible in
JS at all: with a real font file, ``getlength("eli")`` carries kerning that
``ctx.measureText`` would only approximate, and the fixture would be pinning font
data instead of the layout formula. The measurement *equivalence* itself
(``ctx.measureText`` ≡ ``font.getlength``) is pinned elsewhere, by
``docs/caption-parity.md`` and the parity suite.

The JSON stays here rather than under ``backend/tests/fixtures/`` (where the five
``rsvp_*_cases.json`` core fixtures live) because it is generated *for* the Canvas
suite and lives next to it; the Python side reaches across by path, which is the
cheaper direction — the frontend loader needs no knowledge of ``backend/``.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(REPO_ROOT))

from backend.exporters.caption_draw import _measure_tracked  # noqa: E402
from backend.exporters.rsvp import focus_slices, orp_index  # noqa: E402
from backend.exporters.rsvp_layout import (  # noqa: E402
    caption_band,
    cull_bleed,
    layout_line,
    visible_range,
    visible_window,
)
from backend.models.schemas import VideoRenderConfig  # noqa: E402

OUT_PATH = Path(__file__).with_name("rsvp_canvas_parity.json")

GEN_COMMAND = ".venv-dev/bin/python src/renderer/src/lib/__fixtures__/gen_rsvp_canvas_parity.py"

# ---------------------------------------------------------------------------
# The synthetic font: a per-character advance table. Deliberately uneven so a
# prefix measurement cannot accidentally be right (a uniform table would make
# every ORP index land on a multiple of one width).
# ---------------------------------------------------------------------------

DEFAULT_CHAR_WIDTH = 11.0
CHAR_WIDTHS = {
    " ": 6.5,
    ",": 5.25,
    "I": 8.0,
    "a": 12.5,
    "c": 10.25,
    "d": 13.0,
    "e": 12.75,
    "i": 6.0,
    "l": 5.5,
    "m": 18.5,
    "n": 13.25,
    "o": 12.0,
    "p": 13.5,
    "r": 9.75,
    "s": 10.5,
    "t": 8.25,
    "v": 11.5,
    "x": 11.25,
    "y": 11.0,
}

#: Frame + band, at the reference clip's geometry (1320 wide, max_width 0.9,
#: position_x 0.5 → band x 66→1254, pivot 0.35 → 481.8).
RESOLUTION_W = 1320
RESOLUTION_H = 2868
MAX_WIDTH = 0.9
ROW_CENTER_X = RESOLUTION_W * 0.5
PIVOT_FRACTION = 0.35
SLIDE_DURATION = 0.06

#: One word per row of the Spritz ORP table, plus the two hard cases: trailing
#: punctuation (which counts toward the token length) and a font-size override
#: (the word is measured AND drawn in its own font, so its focus glyph still
#: lands on the pivot — only the words *after* it move).
WORDS = [
    {"word": "I", "widthScale": 1.0},  # 1 char  -> f 0
    {"word": "rapid", "widthScale": 1.0},  # 5      -> f 1
    {"word": "saccades,", "widthScale": 1.0},  # 9   -> f 2 (punctuation counts)
    {"word": "eliminates", "widthScale": 1.0},  # 10 -> f 3
    {"word": "extraordinarily", "widthScale": 1.0},  # 15 -> f 4
    {"word": "overridden", "widthScale": 1.3},  # 10 -> f 3, in its own font
]
GROUP_START = 1.0
WORD_DUR = 0.5
#: Long enough after a word's start that the slide has finished.
HOLD_OFFSET = 0.3
TRACKINGS = [0.0, 7.0]

#: Vertical inputs (`_draw_all_rows`' `top_y` for the single RSVP row).
VERTICAL = {"cy": 2351.76, "alignShiftY": -12.0, "tyOff": 5.0, "textH": 43.5}

#: Groups where the line's anchor rule (`last_started_index`) and the decoration
#: modes' `start <= t < end` test DISAGREE, which is where colouring by the wrong
#: rule paints a word that is not on the pivot column.
ANCHOR_CASES = {
    # Displayed order != play order, i.e. what a manual word reorder produces.
    "reordered": (
        [
            {"word": "bravo", "start": 1.50, "end": 2.00},
            {"word": "alpha", "start": 1.00, "end": 1.50},
        ],
        1.70,
    ),
    # Ascending starts, but word 0 is still "active" when word 1 has begun.
    "overlapping": (
        [
            {"word": "alpha", "start": 1.00, "end": 1.60},
            {"word": "bravo", "start": 1.50, "end": 2.00},
        ],
        1.55,
    ),
}


# ---------------------------------------------------------------------------
# Culling (`rsvp_layout.cull_bleed` / `visible_window` / `visible_range`).
#
# Only Pillow and Canvas cull — the HTML layer draws every word and lets its
# edge-fade mask do the work — so this is exactly a two-sided pin, and a bleed or
# a window that drifts between them shows up as a word one renderer draws and the
# other does not.
# ---------------------------------------------------------------------------

#: A line far wider than the frame: the reel case, where culling is the point.
#: ``WORDS`` alone is ~700px against an 1188px band, so every range would be
#: "all of them" and the cases would pin nothing.
CULL_REPEATS = 8

#: Deliberately all non-zero, so a term dropped on either side changes the answer.
CULL_BLEED_INPUTS = {
    "textH": 43.5,
    "strokeWidth": 4.0,
    "shadowBlur": 8.0,
    "shadowOffsetX": 3.0,
    "maxPosOffsetX": 12.0,
}

#: ``bleed: None`` means "use ``cull_bleed(**CULL_BLEED_INPUTS)``".
CULL_CASES = [
    {"name": "fade on: the window is the band", "fadeFrac": 0.12, "lineX": 0.0, "bleed": 0.0},
    {"name": "fade off: the window is the whole frame", "fadeFrac": 0.0, "lineX": 0.0,
     "bleed": 0.0},
    {"name": "scrolled: a window into the middle of the line", "fadeFrac": 0.12,
     "lineX": -2500.0, "bleed": 0.0},
    {"name": "scrolled, with the real bleed", "fadeFrac": 0.12, "lineX": -2500.0,
     "bleed": None},
    {"name": "straddling words are kept, not clipped", "fadeFrac": 0.12, "lineX": -1188.0,
     "bleed": 0.0},
    {"name": "line entirely to the right of the window", "fadeFrac": 0.12, "lineX": 99999.0,
     "bleed": 0.0},
    {"name": "line entirely to the left of the window", "fadeFrac": 0.0, "lineX": -99999.0,
     "bleed": 0.0},
]


class SyntheticFont:
    """Just enough of a PIL font for ``_measure_tracked``: an advance table."""

    def __init__(self, scale: float = 1.0) -> None:
        self.scale = scale

    def getlength(self, text: str) -> float:
        return self.scale * sum(CHAR_WIDTHS.get(ch, DEFAULT_CHAR_WIDTH) for ch in text)


def config() -> VideoRenderConfig:
    return VideoRenderConfig(
        resolution_w=RESOLUTION_W,
        resolution_h=RESOLUTION_H,
        max_width=MAX_WIDTH,
        reading_mode="rsvp",
        rsvp_pivot_x=PIVOT_FRACTION,
        rsvp_slide_duration=SLIDE_DURATION,
    )


def space_w(tracking: float) -> float:
    """``effective_space_w``: one space in the base font (no extra word spacing)."""
    return SyntheticFont().getlength(" ")


def drawn_focus_center(token: str, x: float, font: SyntheticFont, tracking: float) -> float:
    """Where the focus glyph's centre lands when the word is DRAWN.

    Re-derived from ``_draw_single_word``'s pen walk — ``tracking`` after *every*
    character — and deliberately not from ``_measure_tracked``, which counts
    ``n - 1`` gaps. If a renderer drops the one missing gap, this number and the
    pivot part company by exactly ``tracking``.
    """
    pieces = focus_slices(token, orp_index(token))
    if tracking == 0:
        pen = x + font.getlength(pieces.prefix)
    else:
        pen = x + sum(font.getlength(ch) + tracking for ch in pieces.prefix)
    return pen + font.getlength(pieces.focus) / 2


def build_metrics(words: list[dict], tracking: float) -> list[dict]:
    out = []
    for i, w in enumerate(words):
        font = SyntheticFont(float(w.get("widthScale", 1.0)))
        start = w["start"] if "start" in w else GROUP_START + i * WORD_DUR
        end = w["end"] if "end" in w else start + WORD_DUR
        out.append(
            {
                "word": w["word"],
                "width": _measure_tracked(w["word"], font, tracking),
                "start": start,
                "end": end,
                "overrides": None,
            }
        )
    return out


def solve(words: list[dict], tracking: float, t: float, cfg: VideoRenderConfig) -> dict:
    band = caption_band(cfg, ROW_CENTER_X)
    pivot = band.pivot(PIVOT_FRACTION)
    metrics = build_metrics(words, tracking)
    fonts = [SyntheticFont(float(w.get("widthScale", 1.0))) for w in words]

    line = layout_line(
        metrics,
        space_w=space_w(tracking),
        tracking=tracking,
        measure=lambda i, s: _measure_tracked(s, fonts[i], tracking),
        current_time=t,
        pivot_px=pivot,
        slide_duration=SLIDE_DURATION,
    )
    positions = list(line.positions())
    anchor = line.anchor_index
    focus_center = drawn_focus_center(
        metrics[anchor]["word"], positions[anchor], fonts[anchor], tracking
    )
    return {
        "bandLeft": band.left,
        "bandWidth": band.width,
        "pivotPx": pivot,
        "wordWidths": [m["width"] for m in metrics],
        "wordX": list(line.word_x),
        "focusOffsets": list(line.focus_offsets),
        "lineX": line.line_x,
        "positions": positions,
        "anchorIndex": anchor,
        "drawnFocusCenter": focus_center,
    }


def build_cull(cfg: VideoRenderConfig) -> dict:
    """The cull section: one long line, then a window + range per case."""
    words = [dict(w) for _ in range(CULL_REPEATS) for w in WORDS]
    metrics = build_metrics(words, 0.0)
    widths = [m["width"] for m in metrics]
    word_x: list[float] = []
    x = 0.0
    for width in widths:
        word_x.append(x)
        x += width + space_w(0.0)

    band = caption_band(cfg, ROW_CENTER_X)
    # The fixture spells the bleed inputs the way the Canvas twin takes them
    # (camelCase); Pillow is the snake_case side of the same five scalars.
    real_bleed = cull_bleed(
        text_h=CULL_BLEED_INPUTS["textH"],
        stroke_width=CULL_BLEED_INPUTS["strokeWidth"],
        shadow_blur=CULL_BLEED_INPUTS["shadowBlur"],
        shadow_offset_x=CULL_BLEED_INPUTS["shadowOffsetX"],
        max_pos_offset_x=CULL_BLEED_INPUTS["maxPosOffsetX"],
    )
    cases = []
    for case in CULL_CASES:
        bleed = real_bleed if case["bleed"] is None else case["bleed"]
        left, right = visible_window(
            band, fade_frac=case["fadeFrac"], resolution_w=RESOLUTION_W, bleed=bleed,
        )
        first, last = visible_range(
            word_x, widths, line_x=case["lineX"], left=left, right=right,
        )
        cases.append({
            **case,
            "bleed": bleed,
            "expected": {"left": left, "right": right, "first": first, "last": last},
        })

    return {
        "words": [w["word"] for w in words],
        "widths": widths,
        "wordX": word_x,
        "bleedInputs": CULL_BLEED_INPUTS,
        "expectedBleed": real_bleed,
        "cases": cases,
    }


def row_center_y() -> float:
    """``_draw_all_rows``' ``top_y`` for RSVP's single row (`total_text_h == text_h`)."""
    total_text_h = VERTICAL["textH"]  # one row
    return (
        VERTICAL["cy"]
        - total_text_h / 2
        + VERTICAL["textH"] / 2
        + VERTICAL["alignShiftY"]
        + VERTICAL["tyOff"]
    )


def build_payload() -> dict:
    """Derive the whole fixture payload from the live ``rsvp_layout`` reference.

    Pure apart from the ``git rev-parse`` provenance stamp: no file is written, so
    ``backend/tests/test_rsvp_canvas_fixture.py`` can call this and diff the result
    against the committed JSON.
    """
    cfg = config()
    cases = []
    for tracking in TRACKINGS:
        for i, w in enumerate(WORDS):
            cases.append(
                {
                    "name": f"hold on {w['word']!r} (tracking {tracking:g})",
                    "tracking": tracking,
                    "t": GROUP_START + i * WORD_DUR + HOLD_OFFSET,
                    "expectedAnchorIndex": i,
                    "expected": solve(WORDS, tracking, GROUP_START + i * WORD_DUR + HOLD_OFFSET, cfg),
                }
            )
        # Mid-slide: strictly inside the slide into word 3, where the eased value
        # (and only the eased value) decides where the line sits.
        mid = GROUP_START + 3 * WORD_DUR + SLIDE_DURATION / 2
        cases.append(
            {
                "name": f"mid-slide into 'eliminates' (tracking {tracking:g})",
                "tracking": tracking,
                "t": mid,
                "expectedAnchorIndex": 3,
                "midSlide": {"index": 3, "progress": 0.5, "eased": 0.75},
                "expected": solve(WORDS, tracking, mid, cfg),
            }
        )

    anchor_cases = []
    for name, (words, t) in ANCHOR_CASES.items():
        active_in_window = next(
            (i for i, w in enumerate(words) if w["start"] <= t < w["end"]), -1
        )
        solved = solve(words, 0.0, t, cfg)
        assert active_in_window != solved["anchorIndex"], f"{name}: rules agree, case is vacuous"
        anchor_cases.append(
            {
                "name": name,
                "words": words,
                "t": t,
                "activeInWindow": active_in_window,
                "expected": solved,
            }
        )

    payload = {
        "_generatedBy": GEN_COMMAND,
        "_reference": "backend/exporters/rsvp_layout.py (layout_line + caption_band)",
        "_pillowCommit": subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=REPO_ROOT, capture_output=True, text=True
        ).stdout.strip(),
        "_assertedBy": [
            "src/renderer/src/lib/overlayGeometry.rsvp.test.ts",
            "backend/tests/test_rsvp_canvas_fixture.py",
        ],
        "measure": {"defaultCharWidth": DEFAULT_CHAR_WIDTH, "charWidths": CHAR_WIDTHS},
        "layout": {
            "resolutionW": RESOLUTION_W,
            "maxWidth": MAX_WIDTH,
            "rowCenterX": ROW_CENTER_X,
            "pivotFraction": PIVOT_FRACTION,
            "spaceW": space_w(0.0),
            "slideDuration": SLIDE_DURATION,
        },
        "words": [
            {
                "word": w["word"],
                "widthScale": w["widthScale"],
                "start": GROUP_START + i * WORD_DUR,
                "end": GROUP_START + i * WORD_DUR + WORD_DUR,
                "orpIndex": orp_index(w["word"]),
            }
            for i, w in enumerate(WORDS)
        ],
        "vertical": {**VERTICAL, "expectedRowCenterY": row_center_y()},
        "cases": cases,
        "anchorCases": anchor_cases,
        "cull": build_cull(cfg),
    }
    return payload


def main() -> None:
    payload = build_payload()
    cases = payload["cases"]
    anchor_cases = payload["anchorCases"]

    OUT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT_PATH.relative_to(REPO_ROOT)}: "
          f"{len(cases)} cases, {len(anchor_cases)} anchor cases")
    # The fixture lives under `src/`, where `npx prettier --check` is part of the
    # frontend hygiene pass and would reject `json.dumps`' one-element-per-line
    # arrays. Reformatting here keeps regeneration idempotent instead of leaving a
    # trap for the next person who runs this.
    prettier = subprocess.run(
        ["npx", "prettier", "--write", str(OUT_PATH)],
        cwd=REPO_ROOT, capture_output=True, text=True,
    )
    if prettier.returncode != 0:
        print(f"WARNING: prettier failed ({prettier.stderr.strip()}); run "
              f"`npx prettier --write {OUT_PATH.relative_to(REPO_ROOT)}` by hand",
              file=sys.stderr)
    for case in cases:
        exp = case["expected"]
        assert abs(exp["drawnFocusCenter"] - exp["pivotPx"]) < 1e-9 or "mid-slide" in case["name"], (
            f"{case['name']}: focus centre {exp['drawnFocusCenter']} != pivot {exp['pivotPx']}"
        )
    print("pivot invariant holds for every mid-hold case (Python side)")


if __name__ == "__main__":
    main()
