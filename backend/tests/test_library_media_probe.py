"""Duration at import: the one ffprobe call behind a fresh card's length.

No binary is ever run — the runner and the finder are injected. What is pinned:
the argv, the timeout, where ffprobe is looked for, and that every failure
(no binary, a non-zero exit, a timeout, junk, ``N/A``, a non-finite or
non-positive number) is ``None`` and a log line, never an exception.
"""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path

import pytest

from backend.library import media_probe

FAKE_FFPROBE = "/fake/ffprobe"


def completed(stdout: bytes, code: int = 0, stderr: bytes = b"") -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess([], code, stdout, stderr)


def recording_runner(result=None, exc: BaseException | None = None):
    calls: list[tuple[list[str], float]] = []

    def run(cmd: list[str], timeout: float) -> subprocess.CompletedProcess:
        calls.append((cmd, timeout))
        if exc is not None:
            raise exc
        return result

    return run, calls


def find_fake() -> str:
    return FAKE_FFPROBE


def source(tmp_path: Path) -> Path:
    p = tmp_path / "talk.mp4"
    p.write_bytes(b"media" * 20)
    return p


# --- parsing -------------------------------------------------------------------

@pytest.mark.parametrize(
    ("stdout", "expected"),
    [(b"2.000000\n", 2.0), (b"  61.5 \r\n", 61.5), (b"3600", 3600.0)],
)
def test_parse_duration_reads_a_positive_number(stdout: bytes, expected: float) -> None:
    assert media_probe.parse_duration(stdout) == expected


@pytest.mark.parametrize(
    "stdout",
    [b"", b"\n", b"N/A\n", b"abc", b"nan", b"inf", b"-inf", b"0", b"0.0", b"-1.5", b"1.0\n2.0", b"\xff\xfe"],
)
def test_parse_duration_refuses_everything_else(stdout: bytes) -> None:
    assert media_probe.parse_duration(stdout) is None


# --- the call --------------------------------------------------------------------

def test_probe_runs_one_ffprobe_call_with_a_named_timeout(tmp_path: Path) -> None:
    run, calls = recording_runner(completed(b"2.500000\n"))
    src = source(tmp_path)
    assert media_probe.probe_duration(src, find_ffprobe=find_fake, run=run) == 2.5
    assert calls == [(
        [
            FAKE_FFPROBE, "-v", "error", "-show_entries", "format=duration",
            "-of", "default=nw=1:nk=1", str(src),
        ],
        media_probe.PROBE_TIMEOUT_S,
    )]


@pytest.mark.parametrize(
    "result",
    [
        completed(b"", code=1, stderr=b"moov atom not found"),
        completed(b"N/A\n"),
        completed(b"garbage"),
        completed(b"nan\n"),
        completed(b"inf\n"),
        completed(b"0.000000\n"),
        completed(b"-3.0\n"),
    ],
)
def test_a_bad_answer_is_none_and_logged(tmp_path: Path, caplog, result) -> None:
    run, _ = recording_runner(result)
    with caplog.at_level(logging.INFO, logger=media_probe.logger.name):
        assert media_probe.probe_duration(source(tmp_path), find_ffprobe=find_fake, run=run) is None
    assert "duration" in caplog.text.lower()


@pytest.mark.parametrize(
    "exc",
    [
        FileNotFoundError("/fake/ffprobe"),
        PermissionError("not executable"),
        subprocess.TimeoutExpired(["ffprobe"], 10.0),
    ],
)
def test_a_failed_spawn_is_none_and_logged(tmp_path: Path, caplog, exc) -> None:
    run, calls = recording_runner(exc=exc)
    with caplog.at_level(logging.INFO, logger=media_probe.logger.name):
        assert media_probe.probe_duration(source(tmp_path), find_ffprobe=find_fake, run=run) is None
    assert len(calls) == 1
    assert caplog.text


def test_no_ffprobe_is_none_without_running_anything(tmp_path: Path, caplog) -> None:
    run, calls = recording_runner(completed(b"2.0"))

    def missing() -> str:
        raise FileNotFoundError("ffprobe not found")

    with caplog.at_level(logging.INFO, logger=media_probe.logger.name):
        assert media_probe.probe_duration(source(tmp_path), find_ffprobe=missing, run=run) is None
    assert calls == []
    assert "ffprobe" in caplog.text


def test_the_finder_is_resolved_per_call(tmp_path: Path, monkeypatch) -> None:
    """Lazy like the poster's ffmpeg finder: patched after import, still used."""
    run, calls = recording_runner(completed(b"4.0"))
    monkeypatch.setattr(media_probe, "_default_ffprobe", find_fake)
    monkeypatch.setattr(media_probe, "_run", run)
    assert media_probe.probe_duration(source(tmp_path)) == 4.0
    assert calls[0][0][0] == FAKE_FFPROBE


# --- where ffprobe is looked for ---------------------------------------------------

def executable(folder: Path, name: str) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    p = folder / name
    p.write_bytes(b"#!")
    return p


def test_the_bundled_ffprobe_wins(tmp_path: Path, monkeypatch) -> None:
    bundled = executable(tmp_path / "bundle", "ffprobe")
    monkeypatch.setenv("CAPFORGE_FFPROBE", str(bundled))
    found = media_probe.find_ffprobe(
        find_ffmpeg=lambda: str(executable(tmp_path / "bin", "ffmpeg")), which=lambda _: None
    )
    assert found == str(bundled)


def test_ffprobe_is_found_next_to_ffmpeg(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("CAPFORGE_FFPROBE", raising=False)
    # A folder named after ffmpeg must not be rewritten — only the file name is.
    bin_dir = tmp_path / "ffmpeg-7.0" / "bin"
    ffmpeg = executable(bin_dir, "ffmpeg")
    sibling = executable(bin_dir, "ffprobe")
    assert media_probe.find_ffprobe(find_ffmpeg=lambda: str(ffmpeg), which=lambda _: None) == str(sibling)


def test_a_windows_sibling_keeps_its_extension(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("CAPFORGE_FFPROBE", raising=False)
    ffmpeg = executable(tmp_path, "ffmpeg.exe")
    sibling = executable(tmp_path, "ffprobe.exe")
    assert media_probe.find_ffprobe(find_ffmpeg=lambda: str(ffmpeg), which=lambda _: None) == str(sibling)


def test_path_is_the_fallback_and_nothing_raises_file_not_found(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("CAPFORGE_FFPROBE", raising=False)
    ffmpeg = executable(tmp_path, "ffmpeg")  # no sibling ffprobe

    assert media_probe.find_ffprobe(
        find_ffmpeg=lambda: str(ffmpeg), which=lambda name: f"/usr/bin/{name}"
    ) == "/usr/bin/ffprobe"

    def no_ffmpeg() -> str:
        raise FileNotFoundError("FFmpeg not found")

    assert media_probe.find_ffprobe(
        find_ffmpeg=no_ffmpeg, which=lambda name: f"/usr/bin/{name}"
    ) == "/usr/bin/ffprobe"
    with pytest.raises(FileNotFoundError):
        media_probe.find_ffprobe(find_ffmpeg=no_ffmpeg, which=lambda _: None)
