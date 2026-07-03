"""Reproduce the diarization model load in isolation and print the REAL error.

The app maps failures to a friendly message via backend/engine/errors.py, which
hides the underlying exception. This script loads the pipeline directly so the
full traceback (the actual HuggingFace / pyannote cause) is visible.

Usage (run with the CapForge runtime python; token via env var so it is never
echoed):

    HF_TOKEN=hf_xxx "/Users/tobbot/Library/Application Support/CapForge/runtime/python/bin/python3.11" scripts/diagnose_diarization.py
"""
import os
import sys
import traceback

MODEL = "pyannote/speaker-diarization-community-1"

token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
if not token:
    print("ERROR: set HF_TOKEN=hf_xxx in the environment first.")
    sys.exit(2)

print(f"token: len={len(token)} prefix={token[:3]!r} "
      f"(trailing space: {token != token.strip()})")

try:
    import whisperx
    import pyannote.audio
    import importlib.metadata as m
    print("whisperx", m.version("whisperx"), "| pyannote.audio", m.version("pyannote.audio"))
except Exception:
    traceback.print_exc()
    sys.exit(1)

# 1) Verify the token identity and gated-repo access via the HF Hub API directly.
try:
    from huggingface_hub import whoami, model_info
    who = whoami(token=token)
    print(f"whoami: name={who.get('name')!r} type={who.get('type')!r}")
    auth = who.get("auth", {}).get("accessToken", {})
    print(f"token role/permissions: {auth.get('role')} {auth.get('fineGrained')}")
    info = model_info(MODEL, token=token)
    print(f"model_info OK: gated={getattr(info, 'gated', '?')} — token CAN read {MODEL}")
except Exception:
    print("\n--- HF Hub access check FAILED (this is the real cause) ---")
    traceback.print_exc()
    sys.exit(1)

# 2) Actually build the pyannote pipeline the way whisperx does.
try:
    from whisperx.diarize import DiarizationPipeline
    print(f"\nLoading pipeline {MODEL} ...")
    DiarizationPipeline(model_name=MODEL, token=token, device="cpu")
    print("SUCCESS: pipeline loaded. Diarization should work in-app.")
except Exception:
    print("\n--- Pipeline load FAILED — full traceback ---")
    traceback.print_exc()
    sys.exit(1)
