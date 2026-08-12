"""The HTML/GSAP RSVP renderer's geometry, compared to Pillow's — offline.

``hyperframes_rsvp_runtime.RSVP_BUILD_JS`` is the third RSVP renderer, and it only
ever runs inside headless Chromium during a HyperFrames render — i.e. only the
opt-in ``test_caption_parity.py`` suite (Node + ffmpeg + network) exercises it.
That is far too coarse a net for "the pen walk dropped a tracking gap" or "the band
is centred on the wrong column", and far too slow to run on every change.

So this module runs the **emitted** runtime (``CAPTION_RUNTIME_JS``, not a copy) in
bare node against a fake DOM and a recording GSAP stub
(``backend/tests/rsvp_html_harness.js``), then asserts the numbers it produced
against ``backend/exporters/rsvp_layout.py`` — *the source of truth*, called for
real with the same synthetic measurement the harness feeds the browser side.

What that buys, and what it deliberately does not:

* Buys: band/pivot, per-word x, the three-piece pen walk and the pivot invariant,
  the reticle rects, the edge-fade ramp, the group box, the per-word box dimming,
  the slide tween's endpoints/ease/duration, and the one colouring rule — all
  against Pillow's own functions rather than a restated formula.
* Does not: real font metrics, real rasterisation, real GSAP easing. Those are what
  ``test_caption_parity.py::test_rsvp_parity`` measures in pixels.

The synthetic font (advance = 0.5 em per character, ink ascent/descent 0.8/0.2 em,
font ascent/descent 0.9/0.25 em) exists so both languages consume *identical*
numbers; the ratios are read back out of the harness's own report so the two
cannot drift.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

from backend.exporters.hyperframes_caption_html import (
    CAPTION_RUNTIME_JS,
    caption_cfg,
    caption_groups_json,
)
from backend.exporters.rsvp import focus_slices, orp_index
from backend.exporters.rsvp_layout import (
    RETICLE_GAP_EM,
    RETICLE_NOTCH_LEN_EM,
    RETICLE_RULE_LEN_EM,
    RETICLE_THICKNESS_EM,
    _tracking_gap,
    caption_band,
    layout_line,
)
from backend.models.schemas import VideoRenderConfig

HARNESS = Path(__file__).with_name("rsvp_html_harness.js")

#: Float slack for a JS-vs-Python comparison of the same arithmetic.
EPS = 1e-6

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node unavailable")


# ---------------------------------------------------------------------------
# Harness
# ---------------------------------------------------------------------------


def rsvp_config(**over) -> VideoRenderConfig:
    """A deterministic RSVP config: no wrap slack, no word spacing, one group."""
    base = dict(
        resolution_w=1280, resolution_h=720, font_size=90, font_family="Test Face",
        line_height=1.2, tracking=0, word_spacing=0, max_width=0.9,
        position_x=0.5, position_y=0.8, bg_opacity=0.0, bg_padding_h=20, bg_padding_v=10,
        stroke_width=0, animation="none", animation_duration=0.0,
        text_color="#101010", active_word_color="#F0F0F0",
        reading_mode="rsvp", rsvp_pivot_x=0.35, rsvp_focus_color="#E4851F",
        rsvp_context_opacity=0.75, rsvp_slide_duration=0.06, rsvp_edge_fade=0.12,
        rsvp_reticle=True,
    )
    base.update(over)
    return VideoRenderConfig(**base)


def group_of(words: list[tuple[str, float, float]], **extra) -> dict:
    """One group dict in the shape ``caption_groups_json`` / Pillow both consume."""
    ws = [{"word": w, "start": s, "end": e} for w, s, e in words]
    return {"text": " ".join(w for w, _, _ in words),
            "start": ws[0]["start"], "end": ws[-1]["end"], "words": ws, **extra}


def run_runtime(config: VideoRenderConfig, groups: list[dict]) -> dict:
    """Build the real runtime, run it in node, return the harness report."""
    payload = {
        "runtime": CAPTION_RUNTIME_JS,
        "cfg": caption_cfg(config),
        "groups": json.loads(caption_groups_json(groups)),
        "words": [[w["word"] for w in g["words"]] for g in groups],
    }
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump(payload, fh)
        path = fh.name
    proc = subprocess.run(
        ["node", str(HARNESS), path], capture_output=True, text=True, check=False,
    )
    assert proc.returncode == 0, f"harness failed:\n{proc.stderr}"
    return json.loads(proc.stdout)


class Report:
    """Typed-ish accessors over the harness JSON (uids, styles, tl calls)."""

    def __init__(self, data: dict) -> None:
        self.calls = data["calls"]
        self.metrics = data["metrics"]
        self.nodes: dict[int, dict] = {}
        self._index(data["tree"])
        self.root = data["tree"]

    def _index(self, node: dict) -> None:
        self.nodes[node["uid"]] = node
        for child in node["children"]:
            self._index(child)

    def by_class(self, cls: str) -> list[dict]:
        """Every node carrying ``cls``, in document order."""
        out: list[dict] = []

        def walk(node: dict) -> None:
            if cls in str(node["className"]).split():
                out.append(node)
            for child in node["children"]:
                walk(child)

        walk(self.root)
        return out

    def sets_for(self, uid: int) -> list[dict]:
        return [c for c in self.calls
                if c["kind"] == "set" and c["target"] == {"uid": uid}]

    def px(self, node: dict, key: str) -> float:
        return float(str(node["style"][key]).removesuffix("px"))


def px_of(value: str) -> float:
    return float(str(value).removesuffix("px"))


def word_spans(report: Report) -> list[tuple[dict, list[dict]]]:
    """The text row's ``(whole-word span, [its pieces])`` pairs, in DOM order.

    The runtime appends each word's whole-token span followed immediately by its
    prefix/focus/suffix pieces, so DOM order *is* the pairing — no need to guess
    from geometry (every word shares the same ``top``).
    """
    rows = [r for r in report.by_class("crsvp-row")
            if any("cw" in str(c["className"]).split() for c in r["children"])]
    assert len(rows) == 1, "expected exactly one text row per group"
    pairs: list[tuple[dict, list[dict]]] = []
    for child in rows[0]["children"]:
        classes = str(child["className"]).split()
        if "crsvp-piece" in classes:
            pairs[-1][1].append(child)
        elif "cw" in classes:
            pairs.append((child, []))
    return pairs


# ---------------------------------------------------------------------------
# Python-side expectations, from rsvp_layout itself
# ---------------------------------------------------------------------------


def synthetic(report: Report, size: float):
    """The harness's measurement primitive, in Python.

    Mirrors the runtime's ``measureWord``: one call for the whole string when
    tracking is 0, else per-character advances plus ``n - 1`` gaps (the convention
    ``_measure_tracked`` and ``measureTrackedWidth`` share).
    """
    ratio = report.metrics["charWRatio"]

    def measure(text: str, tracking: float = 0.0) -> float:
        if not tracking:
            return len(text) * size * ratio
        w = 0.0
        for ci, ch in enumerate(text):
            w += len(ch) * size * ratio
            if ci < len(text) - 1:
                w += tracking
        return w

    return measure


def word_size(config: VideoRenderConfig, overrides: dict | None) -> float:
    """The runtime's per-word font size (``Math.round(fontSize * scale)``)."""
    scale = float((overrides or {}).get("font_size_scale", 1.0))
    return round(config.font_size * scale)


def expected_line(report: Report, config: VideoRenderConfig, group: dict, t: float):
    """``rsvp_layout``'s own layout for this frame, on the synthetic font."""
    tracking = float(config.tracking or 0)
    base = synthetic(report, config.font_size)
    metrics = []
    for w in group["words"]:
        ov = w.get("overrides") or {}
        measure = synthetic(report, word_size(config, ov))
        metrics.append({"word": w["word"], "start": w["start"], "end": w["end"],
                        "overrides": ov or None,
                        "width": measure(w["word"], tracking)})
    row_center_x = (config.resolution_w * config.position_x
                    + (config.text_offset_x or 0))
    band = caption_band(config, row_center_x)
    line = layout_line(
        metrics,
        space_w=base(" "),
        tracking=tracking,
        measure=lambda i, s: synthetic(report, word_size(config, metrics[i]["overrides"]))(
            s, tracking),
        current_time=t,
        pivot_px=band.pivot(config.rsvp_pivot_x),
        slide_duration=config.rsvp_slide_duration,
    )
    return band, line, metrics


def row_center_y(config: VideoRenderConfig) -> float:
    """The single row's visual centre (``totalTextH == textH``, so the ri=0 term)."""
    return config.resolution_h * config.position_y + (config.text_offset_y or 0)


def span_top(report: Report, config: VideoRenderConfig, size: float, oy: float) -> float:
    """The runtime's span ``top`` for a word of font size ``size``."""
    m = report.metrics
    ink_a, ink_d = size * m["inkAscent"], size * m["inkDescent"]
    f_a, f_d = size * m["fontAscent"], size * m["fontDescent"]
    span_base = (size - f_a - f_d) / 2 + f_a
    gap = f_a - ink_a
    base_gap = config.font_size * (m["fontAscent"] - m["inkAscent"])
    return row_center_y(config) + (gap - base_gap) + (ink_a - ink_d) / 2 - span_base + oy


# ---------------------------------------------------------------------------
# 0. The emitted runtime itself
# ---------------------------------------------------------------------------


def test_emitted_runtime_parses_and_splices_the_rsvp_core_first() -> None:
    """``CAPTION_RUNTIME_JS`` must be valid JS, and the RSVP core must be spliced
    ahead of the builder that consumes it — the order the module documents. (Every
    other test here would still pass on a shuffled order, since function
    declarations hoist; this is what pins the documented shape.)"""
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as fh:
        fh.write(CAPTION_RUNTIME_JS)
        path = fh.name
    proc = subprocess.run(["node", "--check", path], capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr

    core = CAPTION_RUNTIME_JS.index("var __capRsvp =")
    renderer = CAPTION_RUNTIME_JS.index("function __capRsvpBuild")
    builder = CAPTION_RUNTIME_JS.index("function __capBuild")
    assert core < renderer < builder


# ---------------------------------------------------------------------------
# 1. Layout: band, pivot, per-word x and the single line translation
# ---------------------------------------------------------------------------

WORDS = [("Hello", 0.0, 0.75), ("brave", 0.75, 1.5), ("world", 1.5, 2.5)]
HOLD_T = 1.2   # mid "brave", well past its 60 ms slide


def test_word_positions_and_line_translation_match_pillow() -> None:
    config, group = rsvp_config(), group_of(WORDS)
    report = Report(run_runtime(config, [group]))
    band, line, metrics = expected_line(report, config, group, HOLD_T)

    # Every word span sits at its line-origin x (the row container carries lineX),
    # and the row is translated by the ONE scalar rsvp_layout solved.
    spans = [span for span, _ in word_spans(report)]
    assert len(spans) == len(WORDS)
    for i, span in enumerate(spans):
        assert report.px(span, "left") == pytest.approx(line.word_x[i], abs=EPS)
        assert report.px(span, "top") == pytest.approx(
            span_top(report, config, config.font_size, 0.0), abs=EPS)

    rows = report.by_class("crsvp-row")
    assert len(rows) == 2, "expected a sliding row for the boxes and one for the text"
    x_sets = [c for c in report.calls
              if c["kind"] == "set" and "x" in c["vars"] and c["at"] == group["start"]]
    assert len(x_sets) == 1
    assert x_sets[0]["vars"]["x"] == pytest.approx(
        expected_line(report, config, group, group["start"])[1].line_x, abs=EPS)
    assert x_sets[0]["vars"]["force3D"] is False


def test_the_focus_glyph_centre_lands_on_the_pivot() -> None:
    """The pivot invariant, in the HTML layer: the three-piece pen walk must put the
    focus glyph's centre exactly on the pivot column once the row is translated."""
    for tracking in (0, 7):
        config = rsvp_config(tracking=tracking)
        group = group_of(WORDS)
        report = Report(run_runtime(config, [group]))
        band, line, metrics = expected_line(report, config, group, HOLD_T)
        pivot = band.pivot(config.rsvp_pivot_x)
        measure = synthetic(report, config.font_size)
        anchor = line.anchor_index

        # The anchor word's pieces, in DOM order: prefix / focus glyph / suffix.
        _, pieces = word_spans(report)[anchor]
        token = metrics[anchor]["word"]
        slices = focus_slices(token, orp_index(token))
        want = [p for p in (slices.prefix, slices.focus, slices.suffix) if p]
        assert [p["text"] for p in pieces] == want
        focus_span = pieces[want.index(slices.focus)]
        assert focus_span["style"]["color"] == config.rsvp_focus_color

        centre = (px_of(focus_span["style"]["left"])
                  + line.line_x
                  + measure(slices.focus, tracking) / 2)
        assert centre == pytest.approx(pivot, abs=1e-4), (
            f"tracking={tracking}: focus glyph centre {centre} is not on the pivot {pivot}"
        )

        # And the pen walk agrees with Pillow's, gap for gap: the ONE tracking gap
        # a prefix measurement is short of is added at both sites or neither.
        pen = line.word_x[anchor]
        for piece, span in zip(want, pieces):
            assert px_of(span["style"]["left"]) == pytest.approx(pen, abs=EPS)
            pen += measure(piece, tracking) + _tracking_gap(piece, tracking)


def test_mid_slide_tween_matches_line_offset_at() -> None:
    """The slide is one GSAP tween per boundary, from the ARRAY-previous word's
    target to the new one's, ``power1.out`` (the repo's quad — ``power2`` is cubic),
    lasting ``rsvpSlideDuration``. Its endpoints are `lineOffsetAt`'s own."""
    config, group = rsvp_config(), group_of(WORDS)
    report = Report(run_runtime(config, [group]))
    slide = config.rsvp_slide_duration
    # At exactly the boundary the pure function is still at the OLD target (p = 0),
    # and it has arrived once the slide has elapsed — i.e. the tween's two ends.
    _, at_start, _ = expected_line(report, config, group, 0.75)
    _, at_end, _ = expected_line(report, config, group, 0.75 + slide)

    tweens = [c for c in report.calls if c["kind"] == "fromTo" and "x" in c["to"]]
    assert [c["at"] for c in tweens] == [0.75, 1.5]
    first = tweens[0]
    assert first["from"]["x"] == pytest.approx(at_start.line_x, abs=EPS)
    assert first["to"]["x"] == pytest.approx(at_end.line_x, abs=EPS)
    assert first["to"]["duration"] == pytest.approx(slide)
    assert first["to"]["ease"] == "power1.out"
    assert first["to"]["immediateRender"] is False
    assert first["to"]["force3D"] is False

    # The ease NAME has to be the curve the pure function uses, or the two renderers
    # diverge only mid-slide (the failure a hold-only test cannot see). Halfway
    # through, GSAP 'power1.out' is 1-(1-p)^2 = 0.75 — 'power2.out' would be 0.875.
    _, midway, _ = expected_line(report, config, group, 0.75 + slide / 2)
    quad = 1 - (1 - 0.5) ** 2
    assert midway.line_x == pytest.approx(
        at_start.line_x + (at_end.line_x - at_start.line_x) * quad, abs=EPS)

    # Both rows slide together — the boxes must not lag the text.
    row_uids = {n["uid"] for n in report.by_class("crsvp-row")}
    assert {t["uid"] for t in first["target"]} == row_uids


def test_zero_slide_duration_snaps_without_a_tween() -> None:
    config, group = rsvp_config(rsvp_slide_duration=0.0), group_of(WORDS)
    report = Report(run_runtime(config, [group]))
    assert not [c for c in report.calls if c["kind"] == "fromTo"]
    x_sets = [c for c in report.calls if c["kind"] == "set" and "x" in c["vars"]]
    assert [c["at"] for c in x_sets] == [0.0, 0.75, 1.5]
    for call in x_sets:
        _, line, _ = expected_line(report, config, group, call["at"])
        assert call["vars"]["x"] == pytest.approx(line.line_x, abs=EPS)


# ---------------------------------------------------------------------------
# 2. Colouring: ONE rule, the line's own anchor
# ---------------------------------------------------------------------------


def test_colour_toggles_follow_last_started_index_not_start_end() -> None:
    """Toggles fire at each word's ``start`` and never at its ``end``.

    ``start <= t < end`` would need an ``end`` boundary; ``lastStartedIndex`` does
    not, which is exactly why the glyph parked on the pivot keeps the focus colour
    through inter-word silence. The words below have a 0.25 s gap after each end, so
    an end-driven implementation would visibly drop the colour mid-hold.
    """
    words = [("Hello", 0.0, 0.5), ("brave", 0.75, 1.25), ("world", 1.5, 2.0)]
    config, group = rsvp_config(), group_of(words)
    report = Report(run_runtime(config, [group]))

    # Whole-word spans default to the context alpha and are hidden only while their
    # own word is the anchor.
    ctx_alpha = config.rsvp_context_opacity
    for i, (span, pieces) in enumerate(word_spans(report)):
        assert float(span["style"]["opacity"]) == pytest.approx(ctx_alpha)
        toggles = [(c["at"], c["vars"]["opacity"]) for c in report.sets_for(span["uid"])]
        expected = [(words[i][1], 0)]  # hidden at its own start (it is the anchor)
        if i + 1 < len(words):
            expected.append((words[i + 1][1], ctx_alpha))  # dimmed again at the next
        assert [(at, pytest.approx(op)) for at, op in toggles] == expected, (
            f"word {i}: {toggles}"
        )
        # Its pieces are the exact complement: shown only while it is the anchor.
        assert "".join(p["text"] for p in pieces) == words[i][0]
        for piece in pieces:
            assert float(piece["style"]["opacity"]) == 0
            piece_toggles = [(c["at"], c["vars"]["opacity"])
                             for c in report.sets_for(piece["uid"])]
            assert piece_toggles == [(words[i][1], 1)] + (
                [(words[i + 1][1], 0)] if i + 1 < len(words) else []
            )

    # No word-level event happens at any word's END (the only call at 2.0 is the
    # group's own hide, which is the shared Caption Exit Guarantee).
    ends = {w[2] for w in words}
    assert not [c for c in report.calls
                if c["at"] in ends and not isinstance(c["target"], str)]


def test_context_words_dim_fill_stroke_and_shadow_together() -> None:
    """A context word is dimmed with element opacity — which takes the fill, the
    text stroke AND the shadow with it. Pillow needed an explicit ``_dim_alpha`` on
    its stroke for the same reason: dimming only the fill drew an opaque outline
    around a ghost."""
    config = rsvp_config(stroke_width=6, stroke_color="#000000",
                         shadow_enabled=True, shadow_color="#000000")
    report = Report(run_runtime(config, [group_of(WORDS)]))
    spans = [span for span, _ in word_spans(report)]
    for span in spans:
        assert float(span["style"]["opacity"]) == pytest.approx(config.rsvp_context_opacity)
    # The stroke/shadow live on `.cw` in CSS, so they are inside that opacity.
    assert "-webkit-text-stroke" not in json.dumps(spans)


def test_per_word_colour_overrides_are_honoured() -> None:
    group = group_of([("Hello", 0.0, 0.75), ("brave", 0.75, 1.5), ("world", 1.5, 2.5)])
    group["words"][1]["overrides"] = {"text_color": "#3EC1FF",
                                      "active_word_color": "#FF4D6D"}
    config = rsvp_config()
    report = Report(run_runtime(config, [group]))
    spans = [span for span, _ in word_spans(report)]
    assert spans[1]["style"]["color"] == "#3EC1FF"
    assert spans[0]["style"]["color"] == config.text_color

    pieces = report.by_class("crsvp-piece")
    # "brave" -> orp index 1 -> pieces "b" / "r" / "ave"; the non-focus pieces take
    # the word's own active colour, the focus glyph the global focus colour.
    brave = [p for p in pieces if p["text"] in ("b", "r", "ave")]
    assert {p["style"]["color"] for p in brave if p["text"] != "r"} == {"#FF4D6D"}
    assert next(p for p in brave if p["text"] == "r")["style"]["color"] == "#E4851F"


# ---------------------------------------------------------------------------
# 3. The band's furniture: reticle, edge fade, background box
# ---------------------------------------------------------------------------


def test_reticle_rects_match_the_em_formula_and_are_unmasked() -> None:
    config, group = rsvp_config(), group_of(WORDS)
    report = Report(run_runtime(config, [group]))
    band, _, _ = expected_line(report, config, group, HOLD_T)
    pivot = band.pivot(config.rsvp_pivot_x)
    text_h = config.font_size  # ink ascent + descent = 1 em on the synthetic font
    cy = row_center_y(config)

    thickness = max(1.0, text_h * RETICLE_THICKNESS_EM)
    half_len = text_h * RETICLE_RULE_LEN_EM / 2
    gap = text_h * RETICLE_GAP_EM
    notch = text_h * RETICLE_NOTCH_LEN_EM
    top, bottom = cy - text_h / 2 - gap, cy + text_h / 2 + gap
    want = [
        (pivot - half_len, top - thickness, half_len * 2, thickness),
        (pivot - half_len, bottom, half_len * 2, thickness),
        (pivot - thickness / 2, top, thickness, notch),
        (pivot - thickness / 2, bottom - notch, thickness, notch),
    ]

    guides = report.by_class("crsvp-guide")
    assert len(guides) == 4
    for guide, (x, y, w, h) in zip(guides, want):
        assert report.px(guide, "left") == pytest.approx(x, abs=EPS)
        assert report.px(guide, "top") == pytest.approx(y, abs=EPS)
        assert report.px(guide, "width") == pytest.approx(w, abs=EPS)
        assert report.px(guide, "height") == pytest.approx(h, abs=EPS)
        assert guide["style"]["background"] == config.rsvp_focus_color
        # Exempt from the edge fade: a fixed guide, so it must never be a child of
        # a masked band (Pillow gives it its own unmasked layer for this reason).
        assert "crsvp-band" not in str(report.nodes[guide["uid"]]["className"])
    masked = {n["uid"] for b in report.by_class("crsvp-band") for n in _descend(b)}
    assert not masked & {g["uid"] for g in guides}

    off = Report(run_runtime(rsvp_config(rsvp_reticle=False), [group]))
    assert off.by_class("crsvp-guide") == []


def _descend(node: dict) -> list[dict]:
    out = [node]
    for child in node["children"]:
        out.extend(_descend(child))
    return out


def test_edge_fade_is_a_mask_on_the_static_band_not_the_sliding_row() -> None:
    config, group = rsvp_config(), group_of(WORDS)
    report = Report(run_runtime(config, [group]))
    band, _, _ = expected_line(report, config, group, HOLD_T)
    fade_px = band.width * config.rsvp_edge_fade

    bands = report.by_class("crsvp-band")
    assert len(bands) == 2
    for b in bands:
        ramp = b["style"]["maskImage"]
        assert b["style"]["webkitMaskImage"] == ramp
        assert b["style"]["maskRepeat"] == "no-repeat"
        # Alpha 0 outside the band, ramping to 1 over `fade_px` at each edge — the
        # ramp `rsvp_layout._fade_alpha` computes per column.
        stops = [(float(a), float(x)) for a, x in
                 re.findall(r"rgba\(0,0,0,([\d.]+)\) ([\d.]+)px", ramp)]
        assert stops == [(0.0, pytest.approx(0.0)),
                         (0.0, pytest.approx(band.left)),
                         (1.0, pytest.approx(band.left + fade_px)),
                         (1.0, pytest.approx(band.right - fade_px)),
                         (0.0, pytest.approx(band.right))], ramp
        assert ramp.endswith("rgba(0,0,0,0) 100%)")
    # The rows must NOT carry the mask: they translate, and a mask on a moving
    # element slides with it instead of staying in frame coordinates.
    for row in report.by_class("crsvp-row"):
        assert "maskImage" not in row["style"]

    off = Report(run_runtime(rsvp_config(rsvp_edge_fade=0.0), [group]))
    for b in off.by_class("crsvp-band"):
        assert "maskImage" not in b["style"], "fade 0 must be a clean no-op"


def test_group_background_box_frames_the_band() -> None:
    config = rsvp_config(bg_opacity=0.85, bg_color="#2E5FCC", text_offset_x=40)
    group = group_of(WORDS)
    report = Report(run_runtime(config, [group]))
    band, _, _ = expected_line(report, config, group, HOLD_T)

    box = report.by_class("cbubble-bg")[0]
    bg_w = band.width + config.bg_padding_h * 2 + config.bg_width_extra
    assert report.px(box, "width") == pytest.approx(bg_w, abs=EPS)
    # Centred on the BAND (which text_offset_x moved), never on the raw anchor.
    assert report.px(box, "left") == pytest.approx(
        band.left + band.width / 2 - bg_w / 2, abs=EPS)
    assert report.px(box, "left") != pytest.approx(
        config.resolution_w * config.position_x - bg_w / 2, abs=1.0)
    # Unmasked: the box frames the band rather than sliding inside it.
    masked = {n["uid"] for b in report.by_class("crsvp-band") for n in _descend(b)}
    assert box["uid"] not in masked

    # An inverted box is skipped, exactly as Pillow skips it (PIL raises).
    inverted = rsvp_config(bg_opacity=0.85, bg_height_extra=-500)
    assert Report(run_runtime(inverted, [group])).by_class("cbubble-bg") == []


# ---------------------------------------------------------------------------
# 4. Per-word overrides
# ---------------------------------------------------------------------------


def test_per_word_font_override_is_measured_and_drawn_in_its_own_font() -> None:
    group = group_of(WORDS)
    group["words"][1]["overrides"] = {"font_size_scale": 1.5}
    config = rsvp_config()
    report = Report(run_runtime(config, [group]))
    band, line, metrics = expected_line(report, config, group, HOLD_T)

    spans = [span for span, _ in word_spans(report)]
    scaled_size = word_size(config, {"font_size_scale": 1.5})
    assert spans[1]["style"]["fontSize"] == f"{scaled_size}px"
    assert report.px(spans[1], "top") == pytest.approx(
        span_top(report, config, scaled_size, 0.0), abs=EPS)
    # Layout still lands ITS focus glyph on the pivot, measured in its own font.
    pivot = band.pivot(config.rsvp_pivot_x)
    measure = synthetic(report, scaled_size)
    slices = focus_slices("brave", orp_index("brave"))
    focus_span = next(p for p in report.by_class("crsvp-piece")
                      if p["text"] == slices.focus
                      and p["style"].get("fontSize") == f"{scaled_size}px")
    centre = px_of(focus_span["style"]["left"]) + line.line_x + measure(slices.focus) / 2
    assert centre == pytest.approx(pivot, abs=1e-4)


def test_pos_offsets_move_the_word_and_its_focus_glyph() -> None:
    group = group_of(WORDS)
    group["words"][1]["overrides"] = {"pos_offset_x": 12, "pos_offset_y": -8}
    config = rsvp_config()
    report = Report(run_runtime(config, [group]))
    _, line, _ = expected_line(report, config, group, HOLD_T)

    spans = [span for span, _ in word_spans(report)]
    assert report.px(spans[1], "left") == pytest.approx(line.word_x[1] + 12, abs=EPS)
    assert report.px(spans[1], "top") == pytest.approx(
        span_top(report, config, config.font_size, -8.0), abs=EPS)
    # The offset moves the drawn word INCLUDING its focus glyph (intended: it is an
    # explicit nudge), so the whole three-piece walk starts 12px right.
    prefix = next(p for p in report.by_class("crsvp-piece") if p["text"] == "b")
    assert report.px(prefix, "left") == pytest.approx(line.word_x[1] + 12, abs=EPS)


def test_per_word_background_box_rides_the_line_and_dims_with_its_word() -> None:
    group = group_of(WORDS)
    group["words"][0]["overrides"] = {"word_bg_opacity": 0.8, "word_bg_color": "#7A1FA2"}
    group["words"][1]["overrides"] = {"word_bg_opacity": 0.8}
    config = rsvp_config()
    report = Report(run_runtime(config, [group]))
    _, line, metrics = expected_line(report, config, group, HOLD_T)

    boxes = report.by_class("cw-bg")
    assert len(boxes) == 2
    # In the masked, sliding box row — never floating past the band without its word.
    box_row = next(r for r in report.by_class("crsvp-row")
                   if any(c["className"] == "cw-bg" for c in r["children"]))
    assert {b["uid"] for b in boxes} <= {c["uid"] for c in box_row["children"]}
    pad_h = max(config.bg_padding_h, config.stroke_width + 2)
    width0 = metrics[0]["width"] + pad_h * 2
    assert report.px(boxes[0], "width") == pytest.approx(width0, abs=EPS)
    assert report.px(boxes[0], "left") == pytest.approx(
        line.word_x[0] + metrics[0]["width"] / 2 - width0 / 2, abs=EPS)

    # A CONTEXT word's box is dimmed by rsvpContextOpacity, the anchor word's is not.
    ctx_alpha = config.rsvp_context_opacity
    assert float(boxes[0]["style"]["opacity"]) == pytest.approx(0.8 * ctx_alpha)
    toggles = {c["at"]: c["vars"]["opacity"] for c in report.sets_for(boxes[1]["uid"])}
    assert toggles[0.75] == pytest.approx(0.8)          # becomes the anchor
    assert toggles[1.5] == pytest.approx(0.8 * ctx_alpha)  # back to context


# ---------------------------------------------------------------------------
# 5. Wrap mode is untouched
# ---------------------------------------------------------------------------


def test_wrap_mode_builds_no_rsvp_furniture() -> None:
    config = rsvp_config(reading_mode="wrap", bg_opacity=0.85, word_transition="highlight")
    report = Report(run_runtime(config, [group_of(WORDS)]))
    for cls in ("crsvp-band", "crsvp-row", "crsvp-guide", "crsvp-piece"):
        assert report.by_class(cls) == [], f"{cls} leaked into wrap mode"
    # The wrap cursor still centres the row on the anchor, and the pill is back.
    assert report.by_class("cw-pill")
    box = report.by_class("cbubble-bg")[0]
    widths = [len(w) * config.font_size * 0.5 for w, _, _ in WORDS]
    row_w = sum(widths) + config.font_size * 0.5 * (len(WORDS) - 1)
    assert report.px(box, "width") == pytest.approx(row_w + config.bg_padding_h * 2, abs=EPS)
    assert report.px(box, "left") == pytest.approx(
        config.resolution_w * config.position_x - report.px(box, "width") / 2, abs=EPS)


@pytest.mark.parametrize("count", [1, 12], ids=["one-word", "twelve-word"])
def test_degenerate_group_sizes_lay_out_sanely(count: int) -> None:
    """A one-word group has no boundary to slide at (and must still park its focus
    glyph on the pivot); a 12-word group is far wider than the band, which is the
    point of the mode. Both are on the manual-QA list, so pin them here."""
    words = [(f"w{i:02d}", i * 0.25, i * 0.25 + 0.25) for i in range(count)]
    config, group = rsvp_config(), group_of(words)
    report = Report(run_runtime(config, [group]))
    band, line, metrics = expected_line(report, config, group, words[0][1])

    pairs = word_spans(report)
    assert len(pairs) == count
    for i, (span, pieces) in enumerate(pairs):
        assert report.px(span, "left") == pytest.approx(line.word_x[i], abs=EPS)
        assert "".join(p["text"] for p in pieces) == words[i][0]
    tweens = [c for c in report.calls if c["kind"] == "fromTo"]
    assert len(tweens) == max(0, count - 1)
    # The line is wider than the band exactly when there is more than a word or two,
    # which is what the edge fade is for.
    total = line.word_x[-1] + metrics[-1]["width"]
    assert (total > band.width) == (count == 12)


def test_multi_group_rsvp_keeps_each_line_independent() -> None:
    groups = [group_of([("one", 0.0, 0.5), ("two", 0.5, 1.0)]),
              group_of([("three", 1.0, 1.5), ("four", 1.5, 2.0)])]
    config = rsvp_config()
    report = Report(run_runtime(config, groups))
    assert len(report.by_class("crsvp-row")) == 4      # two per group
    assert len(report.by_class("crsvp-guide")) == 8    # one reticle per group
    for gi, group in enumerate(groups):
        _, line, _ = expected_line(report, config, group, group["start"])
        init = [c for c in report.calls
                if c["kind"] == "set" and "x" in c["vars"] and c["at"] == group["start"]]
        assert any(c["vars"]["x"] == pytest.approx(line.line_x, abs=EPS) for c in init)
