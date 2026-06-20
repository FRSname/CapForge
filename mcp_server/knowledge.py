"""HyperFrames creative knowledge — served to the connected agent over MCP.

The agent driving CapForge isn't the same Claude that has the HyperFrames skills
installed; over MCP it only sees our tool docstrings. This module ships a curated,
*verbatim* slice of the HyperFrames creative references (vendored under
``knowledge/``) plus a CapForge-specific entry (``INDEX.md``) that rebinds the
standalone CLI/project workflow onto CapForge's tool surface.

Delivery is pull-on-demand (progressive disclosure): the entry lists topics, and
the agent fetches one at a time — we never dump the whole library into context.

The TOPICS manifest is the single source of truth for both the ``hyperframes_guide``
tool and the ``hyperframes://`` resources in ``server.py``. It also acts as an
allowlist: only mapped ids resolve to a file, so a topic argument can never escape
the knowledge directory.
"""

from __future__ import annotations

from pathlib import Path

_KNOWLEDGE_DIR = Path(__file__).parent / "knowledge"
_INDEX_FILE = "INDEX.md"


class TopicNotFound(LookupError):
    """Raised when a requested topic id isn't in the manifest.

    LookupError (not KeyError) so ``str(exc)`` is the plain message — KeyError
    wraps its message in quotes, which would leak into the tool's error text.
    """


#: topic id -> (filename, one-line description). Keep in sync with INDEX.md.
TOPICS: dict[str, tuple[str, str]] = {
    "captions": ("captions.md", "Caption timing, grouping, one-group-visible, the hard-kill rule — the source of the custom-caption contract. Start here for any custom caption."),
    "text-animation": ("text-animation.md", "Animating text per word/char: reveals, marker sweeps, scribble, sketchout, burst — the highlight vocabulary."),
    "dynamic-techniques": ("dynamic-techniques.md", "Animated text-highlighting techniques (marker sweep, hand-drawn circle, burst lines, scribble)."),
    "motion-principles": ("motion-principles.md", "Easing, timing, anticipation, overshoot — making motion feel intentional, not default."),
    "gsap-easing": ("gsap-easing.md", "GSAP easing curves + stagger for word entrances."),
    "gsap-timeline": ("gsap-timeline.md", "GSAP paused-timeline + labels structure — mirrors the caption contract."),
    "gsap-perf": ("gsap-perf.md", "Compositor-friendly transforms + performance."),
    "animation-techniques": ("animation-techniques.md", "General animation technique catalog."),
    "typography": ("typography.md", "Type scale, weight, tracking, legibility for on-video text."),
    "css-patterns": ("css-patterns.md", "Reusable CSS (gradients, strokes, shadows, glass, masks) for caption styling."),
    "audio-reactive": ("audio-reactive.md", "Beat sync / pulse / glow driven by audio — for emphasis hits."),
    "transitions": ("transitions.md", "Catalog of scene/element transitions — use for group-to-group + effect enter/exit."),
    "transitions-css": ("transitions-css.md", "The full CSS transition families (dissolve, push, cover, blur, scale, 3d, …)."),
    "visual-styles": ("visual-styles.md", "8 named visual style presets to anchor a caption look."),
    "palettes": ("palettes.md", "Nine curated color systems (neon, dark-premium, editorial, …)."),
    "house-style": ("house-style.md", "Default look/feel conventions + palette guidance."),
}


def list_topics() -> list[dict]:
    """Manifest of available topics: ``[{"id", "description"}, ...]``."""
    return [{"id": tid, "description": desc} for tid, (_, desc) in TOPICS.items()]


def read_index() -> str:
    """The CapForge entry/cover (operating model + caption contract + topic index)."""
    return (_KNOWLEDGE_DIR / _INDEX_FILE).read_text(encoding="utf-8")


def read_topic(topic: str) -> str:
    """Return one topic's reference content.

    Raises ``TopicNotFound`` for an unknown id (which is also the traversal guard —
    only ids in TOPICS map to a file).
    """
    entry = TOPICS.get(topic)
    if entry is None:
        known = ", ".join(TOPICS)
        raise TopicNotFound(f"Unknown topic '{topic}'. Available: {known}.")
    return (_KNOWLEDGE_DIR / entry[0]).read_text(encoding="utf-8")
