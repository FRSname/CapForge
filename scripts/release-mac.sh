#!/usr/bin/env bash
# CapForge — full macOS release build with signing and notarization.
#
# Usage: ./scripts/release-mac.sh
#
# What it does:
#   1. Verifies .env.local exists
#   2. Loads signing credentials
#   3. Builds the React renderer
#   4. Runs electron-builder, which signs + notarizes + builds the DMG

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env.local ]]; then
  echo "ERROR: .env.local not found at $ROOT_DIR" >&2
  echo "Create it with APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID." >&2
  exit 1
fi

# Load .env.local (set -a exports every var defined between the toggles)
set -a
# shellcheck disable=SC1091
source .env.local
set +a

echo "[release-mac] Preparing Python runtime (extracting for signing)…"
node scripts/prepare-mac-python.js

echo "[release-mac] Building renderer…"
npm run build:react

echo "[release-mac] Building, signing, and notarizing DMG…"
npm run dist:mac

echo ""
echo "[release-mac] Done. Output:"
ls -lh dist/*.dmg 2>/dev/null || echo "  (no DMG found — check electron-builder output above)"
