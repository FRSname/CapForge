#!/bin/bash
# Queries the status of a specific Apple notarization submission and pings
# Discord when it changes. Idempotent — only posts on status transitions, so
# running every hour doesn't spam.
#
# Invoked by ~/Library/LaunchAgents/com.capforge.notarization-watch.plist.
# Self-disables once the submission reaches a terminal state (Accepted/Invalid).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env.local ]; then
  echo "[$(date)] ERROR: .env.local not found at $ROOT" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env.local
set +a

if [ -z "${NOTARIZATION_SUBMISSION_ID:-}" ]; then
  echo "[$(date)] ERROR: NOTARIZATION_SUBMISSION_ID not set in .env.local" >&2
  exit 1
fi

STATE_FILE="$ROOT/.notarization-last-status"
PLIST="$HOME/Library/LaunchAgents/com.capforge.notarization-watch.plist"

# ---------- Query Apple ----------
INFO=$(xcrun notarytool info "$NOTARIZATION_SUBMISSION_ID" \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" 2>&1) || {
    echo "[$(date)] notarytool failed: $INFO" >&2
    exit 1
  }

CURRENT_STATUS=$(echo "$INFO" | awk -F': ' '/status:/ { print $2; exit }' | tr -d '[:space:]')

if [ -z "$CURRENT_STATUS" ]; then
  echo "[$(date)] Could not parse status from notarytool output" >&2
  echo "$INFO" >&2
  exit 1
fi

LAST_STATUS=""
if [ -f "$STATE_FILE" ]; then
  LAST_STATUS=$(cat "$STATE_FILE")
fi

if [ "$CURRENT_STATUS" = "$LAST_STATUS" ]; then
  echo "[$(date)] Status unchanged: $CURRENT_STATUS"
  exit 0
fi

echo "[$(date)] Status transition: ${LAST_STATUS:-<first check>} → $CURRENT_STATUS"

# ---------- Compose Discord message ----------
case "$CURRENT_STATUS" in
  Accepted)
    COLOR=3066993   # green
    TITLE="Notarization Accepted"
    DESC="Your submission has been approved by Apple. Time to staple and ship.\n\n\`\`\`\nxcrun stapler staple dist/mac-arm64/CapForge.app\n\`\`\`"
    ;;
  Invalid)
    COLOR=15158332  # red
    TITLE="Notarization FAILED"
    DESC="Apple rejected your submission. Fetch the log:\n\n\`\`\`\nxcrun notarytool log $NOTARIZATION_SUBMISSION_ID --apple-id \$APPLE_ID --password \$APPLE_APP_SPECIFIC_PASSWORD --team-id \$APPLE_TEAM_ID\n\`\`\`"
    ;;
  InProgress)
    # Skip the noisy first-check "In Progress" ping; only notify on real transitions.
    if [ -z "$LAST_STATUS" ]; then
      echo "$CURRENT_STATUS" > "$STATE_FILE"
      echo "[$(date)] Initial status is In Progress; saving state, no ping."
      exit 0
    fi
    COLOR=3447003   # blue
    TITLE="Notarization In Progress"
    DESC="Apple is processing your submission."
    ;;
  *)
    COLOR=9807270   # grey
    TITLE="Notarization: $CURRENT_STATUS"
    DESC="Unexpected status — check manually."
    ;;
esac

TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
PAYLOAD=$(cat <<EOF
{
  "embeds": [{
    "title": "$TITLE",
    "description": "$DESC",
    "color": $COLOR,
    "fields": [
      { "name": "Submission ID", "value": "\`$NOTARIZATION_SUBMISSION_ID\`", "inline": false },
      { "name": "Previous", "value": "${LAST_STATUS:-first check}", "inline": true },
      { "name": "Current", "value": "$CURRENT_STATUS", "inline": true }
    ],
    "timestamp": "$TIMESTAMP"
  }]
}
EOF
)

# ---------- Post to Discord ----------
HTTP_CODE=$(curl -sf -o /tmp/discord-response.txt -w "%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "$DISCORD_WEBHOOK_URL") || {
    echo "[$(date)] Discord POST failed with HTTP $HTTP_CODE"
    cat /tmp/discord-response.txt 2>/dev/null || true
    # Don't save state — retry on next run.
    exit 1
  }

echo "[$(date)] Discord notified (HTTP $HTTP_CODE)"
echo "$CURRENT_STATUS" > "$STATE_FILE"

# ---------- Self-disable on terminal state ----------
if [ "$CURRENT_STATUS" = "Accepted" ] || [ "$CURRENT_STATUS" = "Invalid" ]; then
  echo "[$(date)] Terminal state reached — unloading LaunchAgent."
  launchctl unload "$PLIST" 2>/dev/null || true
fi
