"""Translate raw exceptions into actionable user-facing messages.

The whole pipeline (whisperx, torch, ffmpeg, faster-whisper, HF Hub) throws
a mix of ImportError / RuntimeError / FileNotFoundError / OSError with
free-form strings. The frontend used to just show ``str(exc)`` which is
unhelpful ("CUDA out of memory. Tried to allocate 14.00 MiB ...").

``explain(exc)`` returns a short, actionable sentence the frontend can show
in a toast. It pattern-matches on exception type + message substrings, and
falls back to the original message when nothing matches.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class FriendlyError:
    """Actionable error payload for the frontend."""
    title: str
    hint: str

    def format(self) -> str:
        return f"{self.title} — {self.hint}"


# Ordered list of (matcher, friendly error). First match wins.
# Matchers are simple substring checks against the lowercased message;
# exception class is checked separately via type name.
_RULES: list[tuple[tuple[str, ...], FriendlyError]] = [
    # --- GPU / CUDA ---
    (
        ("cuda out of memory", "cublas", "cudnn_status_not_initialized", "cuda error: out of memory"),
        FriendlyError(
            "GPU ran out of memory",
            "Try a smaller model (Settings → Model) or close other GPU apps, then retry.",
        ),
    ),
    (
        ("no kernel image is available", "no cuda gpus are available", "cuda is not available"),
        FriendlyError(
            "CUDA not available on this machine",
            "CapForge was installed in CPU mode. Reinstall to enable GPU, or continue on CPU (slower).",
        ),
    ),
    (
        ("cudnn", "cublas", "cusparse"),
        FriendlyError(
            "CUDA runtime error",
            "Update your NVIDIA driver to the latest version and restart CapForge.",
        ),
    ),

    # --- ffmpeg ---
    (
        ("ffmpeg not found", "ffmpeg: not found", "no such file or directory: 'ffmpeg'"),
        FriendlyError(
            "Bundled FFmpeg is missing",
            "Reinstall CapForge so the ffmpeg binary under resources/bin is restored.",
        ),
    ),
    (
        ("invalid data found when processing input", "moov atom not found", "could not find codec parameters"),
        FriendlyError(
            "Unsupported or corrupted media file",
            "Try a different file, or re-export the source to MP4/H.264.",
        ),
    ),

    # --- Models / downloads ---
    (
        ("connection error", "max retries exceeded", "temporary failure in name resolution", "failed to establish a new connection"),
        FriendlyError(
            "Network error",
            "Check your internet connection and retry. If behind a proxy, set HTTPS_PROXY before launching CapForge.",
        ),
    ),
    (
        ("hfvalidationerror", "repository not found", "401 client error", "403 client error"),
        FriendlyError(
            "Model download blocked",
            "The selected model requires a HuggingFace token, or the model ID is invalid.",
        ),
    ),
    (
        ("could not download", "connectionerror", "readtimeouterror"),
        FriendlyError(
            "Model download failed",
            "Check your internet connection and retry. The partially downloaded files will be resumed.",
        ),
    ),

    # --- Files ---
    (
        ("permission denied", "access is denied", "[errno 13]"),
        FriendlyError(
            "File is locked or read-only",
            "Close the file in other apps (Premiere, Explorer preview, etc.) and retry.",
        ),
    ),
    (
        ("no space left on device", "[errno 28]"),
        FriendlyError(
            "Disk is full",
            "Free some space on the drive where CapForge writes output and retry.",
        ),
    ),
    (
        ("file name too long", "[errno 36]", "path too long"),
        FriendlyError(
            "File path too long",
            "Move the source file closer to the drive root (e.g. C:/Videos/) and retry.",
        ),
    ),

    # --- Import / install ---
    (
        ("no module named 'whisperx'", "no module named 'torch'", "no module named"),
        FriendlyError(
            "Runtime dependency missing",
            "The Python runtime is incomplete. Delete %APPDATA%/CapForge/runtime and relaunch to reinstall.",
        ),
    ),
]


def explain(exc: BaseException) -> FriendlyError:
    """Return an actionable error for the given exception."""
    msg = str(exc) or exc.__class__.__name__
    lower = msg.lower()

    for needles, friendly in _RULES:
        if any(n in lower for n in needles):
            return friendly

    # Type-based fallbacks
    if isinstance(exc, FileNotFoundError):
        return FriendlyError(
            "File not found",
            "The source file no longer exists. Re-open it and retry.",
        )
    if isinstance(exc, MemoryError):
        return FriendlyError(
            "Out of memory",
            "Try a smaller model or close other apps and retry.",
        )
    if isinstance(exc, TimeoutError):
        return FriendlyError(
            "Operation timed out",
            "Check your internet connection and retry.",
        )

    # Ultimate fallback: show the raw message, trimmed.
    short = msg.strip().splitlines()[0][:200]
    return FriendlyError("Something went wrong", short or "Unknown error")
