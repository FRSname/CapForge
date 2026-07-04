"""Tests for the HyperFrames CLI version probe + compatibility gate.

All probes are mocked — these never depend on a real HyperFrames CLI being
installed (CI has none). Covers semver parsing, per-process caching + path-keyed
invalidation, compat boundaries around MIN_SUPPORTED, and the graceful-degrade
path when the probe fails (unknown version must not read as "incompatible").
"""

import subprocess

import pytest

from backend.exporters import hyperframes_version as hv


@pytest.fixture(autouse=True)
def _clear_cache():
    hv.reset_version_cache()
    yield
    hv.reset_version_cache()


class _FakeCompleted:
    def __init__(self, stdout: str = "", stderr: str = "", returncode: int = 0):
        self.stdout = stdout
        self.stderr = stderr
        self.returncode = returncode


def _fake_run(stdout="0.7.26\n", returncode=0):
    """Build a subprocess.run stand-in that counts invocations."""
    calls = {"n": 0}

    def run(argv, **_kwargs):
        calls["n"] += 1
        return _FakeCompleted(stdout=stdout, returncode=returncode)

    return run, calls


# --- semver parsing --------------------------------------------------------

@pytest.mark.parametrize(
    "value,expected",
    [
        # Full releases carry release_rank 1.
        ("0.7.26", (0, 7, 26, 1)),
        ("v1.2.3", (1, 2, 3, 1)),
        ("hyperframes 0.7.21 (build)", (0, 7, 21, 1)),
        ("10.20.30", (10, 20, 30, 1)),
        # Pre-releases carry release_rank 0 → sort below the matching release.
        ("0.7.21-rc.1", (0, 7, 21, 0)),
        ("1.2.3-beta", (1, 2, 3, 0)),
    ],
)
def test_parse_semver_extracts_triplet(value, expected):
    assert hv._parse_semver(value) == expected


def test_parse_semver_prerelease_sorts_below_release():
    # Per semver: 0.7.21-rc.1 < 0.7.21.
    assert hv._parse_semver("0.7.21-rc.1") < hv._parse_semver("0.7.21")


@pytest.mark.parametrize("value", ["", "not a version", "1.2", "abc.def.ghi"])
def test_parse_semver_returns_none_on_junk(value):
    assert hv._parse_semver(value) is None


# --- probe + caching -------------------------------------------------------

def test_get_cli_version_parses_probe(monkeypatch):
    run, _calls = _fake_run(stdout="0.7.26\n")
    monkeypatch.setattr(hv, "hyperframes_argv", lambda: ["node", "cli.js"])
    monkeypatch.setattr(hv, "hyperframes_env", lambda: {})
    monkeypatch.setattr(subprocess, "run", run)

    assert hv.get_cli_version() == "0.7.26"


def test_probe_runs_once_then_caches(monkeypatch):
    run, calls = _fake_run(stdout="0.7.26\n")
    monkeypatch.setattr(hv, "hyperframes_argv", lambda: ["node", "cli.js"])
    monkeypatch.setattr(hv, "hyperframes_env", lambda: {})
    monkeypatch.setattr(subprocess, "run", run)

    assert hv.get_cli_version() == "0.7.26"
    assert hv.get_cli_version() == "0.7.26"
    assert hv.get_cli_version() == "0.7.26"
    assert calls["n"] == 1  # cached after the first real probe


def test_cache_invalidates_on_cli_path_change(monkeypatch):
    run, calls = _fake_run(stdout="0.7.26\n")
    monkeypatch.setattr(hv, "hyperframes_env", lambda: {})
    monkeypatch.setattr(subprocess, "run", run)

    monkeypatch.setattr(hv, "hyperframes_argv", lambda: ["node", "/old/cli.js"])
    assert hv.get_cli_version() == "0.7.26"
    # A re-provision changes the resolved CLI path → a fresh cache key → re-probe.
    monkeypatch.setattr(hv, "hyperframes_argv", lambda: ["node", "/new/cli.js"])
    assert hv.get_cli_version() == "0.7.26"
    assert calls["n"] == 2


def test_get_cli_version_none_when_no_argv(monkeypatch):
    monkeypatch.setattr(hv, "hyperframes_argv", lambda: None)
    # Must not even attempt a subprocess when the CLI can't be resolved.
    monkeypatch.setattr(
        subprocess, "run", lambda *a, **k: pytest.fail("probe attempted without argv")
    )
    assert hv.get_cli_version() is None


def test_get_cli_version_none_on_nonzero_exit(monkeypatch):
    run, _calls = _fake_run(stdout="boom", returncode=1)
    monkeypatch.setattr(hv, "hyperframes_argv", lambda: ["node", "cli.js"])
    monkeypatch.setattr(hv, "hyperframes_env", lambda: {})
    monkeypatch.setattr(subprocess, "run", run)
    assert hv.get_cli_version() is None


def test_get_cli_version_none_when_probe_raises(monkeypatch):
    def boom(*_a, **_k):
        raise subprocess.TimeoutExpired(cmd="hyperframes", timeout=20)

    monkeypatch.setattr(hv, "hyperframes_argv", lambda: ["node", "cli.js"])
    monkeypatch.setattr(hv, "hyperframes_env", lambda: {})
    monkeypatch.setattr(subprocess, "run", boom)
    assert hv.get_cli_version() is None  # never raises


# --- compat gate -----------------------------------------------------------

def _stub_version(monkeypatch, version):
    monkeypatch.setattr(hv, "get_cli_version", lambda *a, **k: version)


def test_compat_ok_at_min_supported(monkeypatch):
    _stub_version(monkeypatch, "0.7.21")
    result = hv.check_cli_compat()
    assert result == {"version": "0.7.21", "ok": True, "reasons": []}


def test_compat_ok_above_min(monkeypatch):
    _stub_version(monkeypatch, "0.7.26")
    assert hv.check_cli_compat()["ok"] is True


def test_compat_not_ok_below_min(monkeypatch):
    _stub_version(monkeypatch, "0.7.20")
    result = hv.check_cli_compat()
    assert result["ok"] is False
    assert result["version"] == "0.7.20"
    assert "older than 0.7.21" in result["reasons"][0]
    assert "Reinstall" in result["reasons"][0]


def test_compat_prerelease_below_min_not_ok(monkeypatch):
    # A pre-release of the floor is BELOW the floor (0.7.21-rc.1 < 0.7.21).
    _stub_version(monkeypatch, "0.7.21-rc.1")
    result = hv.check_cli_compat()
    assert result["ok"] is False
    assert result["version"] == "0.7.21-rc.1"
    # ...while the final release at the floor is ok.
    _stub_version(monkeypatch, "0.7.21")
    assert hv.check_cli_compat()["ok"] is True


def test_compat_unknown_when_probe_fails(monkeypatch):
    _stub_version(monkeypatch, None)
    result = hv.check_cli_compat()
    # Tri-state: unknown is None (NOT False) so callers degrade, not block. Reasons
    # is empty — the null state already means "unknown", no internal diagnostic.
    assert result == {"version": None, "ok": None, "reasons": []}


def test_min_supported_below_snapshot_threshold():
    # Sanity: the two documented thresholds are ordered and parse cleanly.
    assert hv._parse_semver(hv.MIN_SUPPORTED) < hv._parse_semver(
        hv.SNAPSHOT_EXTRA_FRAME_SINCE
    )


# --- GET /api/hyperframes/status endpoint ----------------------------------

@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    import backend.main as main_module

    # No context manager: skip startup/shutdown (agent discovery file IO).
    return TestClient(main_module.app), main_module


def test_status_endpoint_reports_compat(client, monkeypatch):
    tc, main_module = client
    monkeypatch.setattr(hv, "get_cli_version", lambda *a, **k: "0.7.26")
    resp = tc.get("/api/hyperframes/status")
    assert resp.status_code == 200
    assert resp.json() == {
        "cli_version": "0.7.26",
        "compat_ok": True,
        "compat_reasons": [],
    }


def test_status_endpoint_survives_probe_failure(client, monkeypatch):
    """A failed probe must degrade to compat_ok=null — never a 500."""
    tc, main_module = client
    monkeypatch.setattr(hv, "get_cli_version", lambda *a, **k: None)
    resp = tc.get("/api/hyperframes/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["cli_version"] is None
    assert body["compat_ok"] is None
    assert body["compat_reasons"] == []


def test_status_probe_flag_flushes_cache(client, monkeypatch):
    """Two plain calls probe once (per-process cache); ?probe=1 forces a re-probe.

    Counts the underlying subprocess probe rather than stubbing get_cli_version —
    the endpoint calls get_cli_version on every hit by design, so the cache is only
    observable at the subprocess boundary, exactly where ?probe=1's
    reset_version_cache takes effect.
    """
    tc, _main = client
    run, calls = _fake_run(stdout="0.7.26\n")
    monkeypatch.setattr(hv, "hyperframes_argv", lambda: ["node", "cli.js"])
    monkeypatch.setattr(hv, "hyperframes_env", lambda: {})
    monkeypatch.setattr(subprocess, "run", run)

    assert tc.get("/api/hyperframes/status").json()["cli_version"] == "0.7.26"
    assert tc.get("/api/hyperframes/status").json()["cli_version"] == "0.7.26"
    assert calls["n"] == 1  # second plain call served from the cache

    assert tc.get("/api/hyperframes/status?probe=1").json()["cli_version"] == "0.7.26"
    assert calls["n"] == 2  # ?probe=1 reset the cache → fresh probe
