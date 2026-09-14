"""Failure mapping shared by the library tools (split out for the size ceiling).

Every tool returns a dict; these turn the three failure modes an HTTP call has
into error dicts an agent can read — nothing else is caught, so a real bug still
propagates instead of looking like a tidy answer.
"""

from __future__ import annotations

from typing import Any, Callable, Optional

import httpx

from .client import StaleRecord
from .discovery import BackendNotFound

#: Copy for the app-closed case — distinct from "no window open" (§2.1).
NOT_RUNNING = "CapForge is not running — launch it (the window can stay closed) and retry."

_ERROR = "error"
_OK = "ok"


def _fail(message: str, **extra: Any) -> dict:
    return {"status": _ERROR, _ERROR: message, **extra}


def _http_detail(exc: httpx.HTTPStatusError) -> str:
    """The backend's own `detail` string, or the bare status when it has none.

    The library routes already answer in sentences written for a human ("Record
    … has no session snapshot yet"), so passing them through beats paraphrasing.
    """
    try:
        body = exc.response.json()
    except ValueError:
        body = None
    detail = body.get("detail") if isinstance(body, dict) else None
    if isinstance(detail, str):
        return detail
    if isinstance(detail, list) and detail:
        return _validation_summary(detail)
    reason = (exc.response.reason_phrase or "").strip()
    return f"CapForge answered {exc.response.status_code} {reason}".strip()


#: How many field errors a 422 summary names before "and N more".
_VALIDATION_SUMMARY_LIMIT = 3


def _validation_summary(errors: list) -> str:
    """One line naming the fields a 422 refused — an agent cannot fix what it
    cannot see (a bare "422 Unprocessable Content" was the alternative)."""
    parts: list[str] = []
    for err in errors[:_VALIDATION_SUMMARY_LIMIT]:
        if not isinstance(err, dict):
            continue
        loc = [str(x) for x in (err.get("loc") or []) if x != "body"]
        field = ".".join(loc) or "body"
        parts.append(f"{field}: {err.get('msg', 'invalid')}")
    more = len(errors) - _VALIDATION_SUMMARY_LIMIT
    suffix = f" (and {more} more)" if more > 0 else ""
    return "CapForge refused the write — " + "; ".join(parts) + suffix


#: The status a refused body comes back as (FastAPI's, and the rule check's).
_UNPROCESSABLE = 422

#: What a rule refusal says when the backend sent violations but no sentence.
_VIOLATIONS_DETAIL = "CapForge refused the write — it breaks a hard publish rule."


def _violations_refusal(exc: httpx.HTTPStatusError) -> Optional[dict]:
    """The refusal dict for a 422 carrying `violations`, else None.

    `PATCH /api/library/{id}` runs the hard publish rules before writing, so its
    422 is a *rule* answer — `{field, rule, message, severity}` the agent can act
    on — not pydantic complaining about a body shape. Those keep the field
    summary above; only a body with a `violations` list takes this path.
    """
    if exc.response.status_code != _UNPROCESSABLE:
        return None
    try:
        body = exc.response.json()
    except ValueError:
        return None
    if not isinstance(body, dict):
        return None
    violations = body.get("violations")
    if not isinstance(violations, list):
        return None
    detail = body.get("detail")
    return {
        "status": _ERROR,
        "reason": "violations",
        "detail": detail if isinstance(detail, str) else _VIOLATIONS_DETAIL,
        "violations": violations,
    }


def _library_call(fn: Callable[[], dict]) -> dict:
    """Run a tool body, turning the three failure modes into error dicts.

    Nothing is swallowed: every branch reports, and an exception this does not
    know about still propagates (a bug should not look like a tidy answer).
    """
    try:
        return fn()
    except BackendNotFound:
        return _fail(NOT_RUNNING)
    except StaleRecord as exc:
        return {
            "status": _ERROR,
            "reason": "stale_rev",
            "detail": exc.detail,
            "current": exc.current,
        }
    except httpx.HTTPStatusError as exc:
        refusal = _violations_refusal(exc)
        return refusal if refusal is not None else _fail(_http_detail(exc))


