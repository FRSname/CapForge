"""One publish finding — the shape every validator answers with.

Split out of ``validate.py`` so the rule modules it calls (``validate_media``)
can build findings without importing it back. ``validate.py`` re-exports
``Violation`` and ``Severity``; import them from there.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

Severity = Literal["hard", "style"]


class Violation(BaseModel):
    """One finding, addressed to a field the Publish panel can highlight."""

    model_config = ConfigDict(frozen=True)

    field: str
    rule: str
    message: str
    severity: Severity


def hard(field: str, rule: str, message: str) -> Violation:
    """A finding that blocks a ``PATCH``."""
    return Violation(field=field, rule=rule, message=message, severity="hard")


def style(field: str, rule: str, message: str) -> Violation:
    """Advice that never blocks a write."""
    return Violation(field=field, rule=rule, message=message, severity="style")
