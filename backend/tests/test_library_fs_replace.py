"""``os.replace`` / read retries for Windows sharing violations.

On Windows ``os.replace`` (MoveFileEx) fails with ``PermissionError`` while any
other handle holds the destination open, because Python's ``open()`` does not
pass ``FILE_SHARE_DELETE`` — and the media-facts pool reads ``record.json`` on a
background thread while request threads write it. A reader can likewise hit a
sharing violation mid-swap. ``fs`` retries exactly that error, bounded, and
nothing else.
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any, Callable

import pytest

from backend.library import fs

#: How long the reader thread holds ``record.json`` open during the real race.
HOLD_S = 0.1
JOIN_TIMEOUT_S = 10.0


def _flaky(failures: int, exc: BaseException, real: Callable[..., Any]) -> Callable[..., Any]:
    """Raise ``exc`` for the first ``failures`` calls, then delegate to ``real``."""
    calls = {"n": 0}

    def fake(*args: Any, **kwargs: Any) -> Any:
        calls["n"] += 1
        if calls["n"] <= failures:
            raise exc
        return real(*args, **kwargs)

    fake.calls = calls  # type: ignore[attr-defined]
    return fake


def _expected_backoff(sleeps: int) -> list[float]:
    delays: list[float] = []
    delay = fs.REPLACE_BACKOFF_S
    for _ in range(sleeps):
        delays.append(delay)
        delay = min(delay * 2, fs.REPLACE_BACKOFF_MAX_S)
    return delays


def test_replace_retries_a_permission_error_then_succeeds(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    src, dst = tmp_path / "a.tmp", tmp_path / "a.json"
    src.write_text("new", encoding="utf-8")
    fake = _flaky(2, PermissionError(5, "Access is denied"), os.replace)
    monkeypatch.setattr(fs.os, "replace", fake)
    sleeps: list[float] = []

    fs.replace_with_retry(src, dst, sleep=sleeps.append)

    assert fake.calls["n"] == 3  # type: ignore[attr-defined]
    assert sleeps == _expected_backoff(2)
    assert dst.read_text(encoding="utf-8") == "new"
    assert not src.exists()


def test_backoff_is_capped() -> None:
    delays = _expected_backoff(fs.REPLACE_ATTEMPTS - 1)
    assert max(delays) == fs.REPLACE_BACKOFF_MAX_S
    assert sum(delays) < 1.5  # the worst case stays about a second


def test_replace_reraises_after_exactly_the_attempt_budget(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    src, dst = tmp_path / "a.tmp", tmp_path / "a.json"
    src.write_text("new", encoding="utf-8")
    fake = _flaky(10**6, PermissionError(5, "Access is denied"), os.replace)
    monkeypatch.setattr(fs.os, "replace", fake)
    sleeps: list[float] = []

    with pytest.raises(PermissionError):
        fs.replace_with_retry(src, dst, sleep=sleeps.append)

    assert fake.calls["n"] == fs.REPLACE_ATTEMPTS  # type: ignore[attr-defined]
    assert sleeps == _expected_backoff(fs.REPLACE_ATTEMPTS - 1)


def test_write_json_atomic_removes_the_tmp_after_a_final_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "record.json"
    fake = _flaky(10**6, PermissionError(5, "Access is denied"), os.replace)
    monkeypatch.setattr(fs.os, "replace", fake)
    monkeypatch.setattr(fs, "REPLACE_BACKOFF_S", 0.0)
    monkeypatch.setattr(fs, "REPLACE_BACKOFF_MAX_S", 0.0)

    with pytest.raises(PermissionError):
        fs.write_json_atomic(path, {"id": "x"})

    assert fake.calls["n"] == fs.REPLACE_ATTEMPTS  # type: ignore[attr-defined]
    assert not path.with_name(path.name + ".tmp").exists()
    assert not path.exists()


def test_a_missing_source_fails_without_retrying(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = {"n": 0}
    real = os.replace

    def counting(*args: Any, **kwargs: Any) -> None:
        calls["n"] += 1
        real(*args, **kwargs)

    monkeypatch.setattr(fs.os, "replace", counting)
    sleeps: list[float] = []

    with pytest.raises(FileNotFoundError):
        fs.replace_with_retry(tmp_path / "missing.tmp", tmp_path / "a.json", sleep=sleeps.append)

    assert calls["n"] == 1
    assert sleeps == []


def test_read_json_retries_a_permission_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "record.json"
    path.write_text(json.dumps({"id": "x"}), encoding="utf-8")
    fake = _flaky(2, PermissionError(32, "Sharing violation"), Path.read_text)
    monkeypatch.setattr(fs.Path, "read_text", fake)
    sleeps: list[float] = []

    assert fs.read_json(path, sleep=sleeps.append) == {"id": "x"}
    assert fake.calls["n"] == 3  # type: ignore[attr-defined]
    assert sleeps == _expected_backoff(2)


def test_read_json_does_not_retry_a_missing_file(tmp_path: Path) -> None:
    sleeps: list[float] = []
    with pytest.raises(FileNotFoundError):
        fs.read_json(tmp_path / "missing.json", sleep=sleeps.append)
    assert sleeps == []


def test_write_succeeds_while_a_reader_holds_the_destination_open(tmp_path: Path) -> None:
    """The real race: on Windows this only passes through the retry."""
    path = tmp_path / "record.json"
    fs.write_json_atomic(path, {"rev": 1})
    opened = threading.Event()
    errors: list[BaseException] = []

    def reader() -> None:
        try:
            with path.open("r", encoding="utf-8") as fh:
                opened.set()
                threading.Event().wait(HOLD_S)
                fh.read()
        except BaseException as exc:  # surfaced by the main thread below
            errors.append(exc)
            opened.set()

    thread = threading.Thread(target=reader)
    thread.start()
    assert opened.wait(JOIN_TIMEOUT_S)

    fs.write_json_atomic(path, {"rev": 2})

    thread.join(JOIN_TIMEOUT_S)
    assert not thread.is_alive()
    assert errors == []
    assert fs.read_json(path) == {"rev": 2}
    assert not path.with_name(path.name + ".tmp").exists()
