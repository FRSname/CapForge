"""The ``progressive`` word transition: every word visible, colour flips as it is said.

Unspoken words draw in ``text_color``; a word switches to ``active_word_color``
the moment it starts and KEEPS it until the group ends (no flicker in the
silence between two words, no return to the base colour). It is ``reveal`` with
every word shown from the first frame, and ``karaoke`` without the wipe.

Each frame is checked against an oracle built from the ``none`` transition plus
a per-word ``text_color`` override on exactly the words that should have
flipped — the same flat draw path, so the comparison is byte-exact.
"""

import pytest

from backend.exporters.video_render import _frame_state_key, _get_font, _render_frame
from backend.tests.test_render_golden import build_config, build_group

TEXT_COLOR = "#808080"
SPOKEN_COLOR = "#FFFFFF"
WORDS = ["first", "second", "third"]
WORD_START = 1.0
WORD_DUR = 0.5  # first 1.0–1.5, second 1.5–2.0, third 2.0–2.5


def _config(**overrides):
    return build_config(
        animation="none", text_color=TEXT_COLOR, active_word_color=SPOKEN_COLOR, **overrides
    )


def _font(config):
    return _get_font(config.font_family, config.font_size, config.custom_font_path,
                     bold=config.bold)


def _progressive_frame(t: float, group: dict) -> bytes:
    config = _config(word_transition="progressive")
    return _render_frame(config, _font(config), group, t).tobytes()


def _oracle_frame(t: float, group: dict, spoken: int) -> bytes:
    """``none`` transition with the first `spoken` words pinned to the spoken colour."""
    config = _config(word_transition="none")
    words = [
        {**w, "overrides": {"text_color": SPOKEN_COLOR}} if i < spoken else dict(w)
        for i, w in enumerate(group["words"])
    ]
    return _render_frame(config, _font(config), {**group, "words": words}, t).tobytes()


def _group() -> dict:
    return build_group(WORDS, start=WORD_START, word_dur=WORD_DUR)


@pytest.mark.parametrize("t,spoken", [
    (1.0, 1),    # the first word flips at exactly its start
    (1.25, 1),   # first word being said
    (1.5, 2),    # second word starts: the first KEEPS its colour
    (1.75, 2),
    (2.0, 3),
    (2.49, 3),   # last word being said: the whole group has flipped
])
def test_words_flip_at_their_start_and_stay_flipped(t: float, spoken: int) -> None:
    group = _group()
    assert _progressive_frame(t, group) == _oracle_frame(t, group, spoken)


def test_every_word_is_visible_before_the_first_one_is_said() -> None:
    # A group that is on screen before its first word starts (a manually
    # extended group): all three words show, all in the base text colour.
    group = {**_group(), "start": 0.5}
    assert _progressive_frame(0.75, group) == _oracle_frame(0.75, group, 0)


def test_a_spoken_word_keeps_its_colour_in_the_silence_before_the_next() -> None:
    group = _group()
    words = [dict(w) for w in group["words"]]
    words[0]["end"] = 1.3  # silence 1.3–1.5 between "first" and "second"
    gapped = {**group, "words": words}
    assert _progressive_frame(1.4, gapped) == _oracle_frame(1.4, gapped, 1)


def test_progressive_differs_from_instant_once_a_word_is_past() -> None:
    group = _group()
    config = _config(word_transition="instant")
    instant = _render_frame(config, _font(config), group, 1.75).tobytes()
    assert _progressive_frame(1.75, group) != instant


def test_per_word_override_flips_only_that_word() -> None:
    # Global transition "none"; only the second word is progressive.
    group = _group()
    words = [dict(w) for w in group["words"]]
    words[1]["overrides"] = {"word_transition": "progressive"}
    config = _config(word_transition="none")
    font = _font(config)

    def frame(t: float) -> bytes:
        return _render_frame(config, font, {**group, "words": words}, t).tobytes()

    plain = _config(word_transition="none")
    untouched = _render_frame(plain, font, group, 1.25).tobytes()
    assert frame(1.25) == untouched            # second word not said yet
    assert frame(1.75) != untouched            # being said
    assert frame(2.25) == frame(1.75)          # stays flipped while "third" plays


# --- frame-dedup key ------------------------------------------------------

def test_dedup_key_is_steady_while_a_word_is_said() -> None:
    config = _config(word_transition="progressive")
    group = _group()
    k_start = _frame_state_key(0, group, 1.5, config)
    k_mid = _frame_state_key(0, group, 1.75, config)
    assert k_start is not None  # nothing animates continuously
    assert k_start == k_mid


def test_dedup_key_changes_when_the_next_word_starts() -> None:
    config = _config(word_transition="progressive")
    group = _group()
    assert _frame_state_key(0, group, 1.75, config) != _frame_state_key(0, group, 2.0, config)


def test_dedup_key_ignores_the_silence_between_words() -> None:
    # A spoken word looks the same whether it is still being said or already
    # over, so the gap after it must not force a re-render.
    config = _config(word_transition="progressive")
    group = _group()
    words = [dict(w) for w in group["words"]]
    words[0]["end"] = 1.3
    gapped = {**group, "words": words}
    assert _frame_state_key(0, gapped, 1.2, config) == _frame_state_key(0, gapped, 1.4, config)
