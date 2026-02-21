#!/usr/bin/env bash
# Run all relaygent tests, or a specific suite.
# Usage: ./test.sh [suite]   (e.g. hub, harness, notifications, email, slack, setup, secrets, computer-use)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PASS=0; FAIL=0; SUITE="${1:-all}"

run() {
  local label="$1"; shift
  printf '\n=== %s ===\n' "$label"
  if "$@"; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    echo "FAILED: $label"
  fi
}

should_run() { [[ "$SUITE" == "all" || "$SUITE" == "$1" ]]; }

# --- Harness (Python, system python3) ---
should_run harness && run "harness" python3 -m pytest "$ROOT/tests/harness/" -q

# --- Notifications (Python, venv) ---
if should_run notifications; then
  NOTIF_VENV="$ROOT/notifications/.venv"
  if [ ! -d "$NOTIF_VENV" ]; then
    python3 -m venv "$NOTIF_VENV"
    "$NOTIF_VENV/bin/pip" install -q flask croniter python-dateutil pytz
  fi
  "$NOTIF_VENV/bin/python" -c "import pytest" 2>/dev/null || "$NOTIF_VENV/bin/pip" install -q pytest
  run "notifications" "$NOTIF_VENV/bin/python" -m pytest "$ROOT/tests/notifications/" -q
fi

# --- Hub (Node) ---
should_run hub && run "hub" node --import="$ROOT/tests/hub/helpers/kit-loader.mjs" \
  --test "$ROOT/tests/hub/"*.test.js

# --- Secrets (Node) ---
should_run secrets && run "secrets" node --test "$ROOT/tests/secrets/test_vault.mjs"

# --- Email (Node) ---
should_run email && run "email" node --test "$ROOT/tests/email/test_email_poller.mjs" \
  "$ROOT/tests/email/test_gmail_client.mjs"

# --- Computer-use Python ---
if should_run computer-use; then
  run "computer-use/python" python3 -m pytest "$ROOT/tests/computer-use/" -q
  CU_NODE_TESTS=("$ROOT/tests/computer-use/test_hammerspoon_unit.mjs" "$ROOT/tests/computer-use/test_browser_exprs.mjs")
  if [[ "$(uname)" == "Darwin" ]]; then
    CU_NODE_TESTS+=("$ROOT/tests/computer-use/test_cdp.mjs")
  fi
  run "computer-use/node" node --test "${CU_NODE_TESTS[@]}"
fi

# --- Slack (Node) ---
should_run slack && run "slack" node --test "$ROOT/tests/slack/test_slack_helpers.mjs" \
  "$ROOT/tests/slack/test_slack_client.mjs"

# --- Setup (Node) ---
should_run setup && run "setup" node --test "$ROOT/tests/setup/test_setup_helpers.mjs" \
  "$ROOT/tests/setup/test_setup_utils.mjs"

# --- Summary ---
printf '\n================================\n'
if [[ "$SUITE" != "all" ]]; then
  printf 'Suite: %s — passed: %d  failed: %d\n' "$SUITE" "$PASS" "$FAIL"
else
  printf 'Suites passed: %d  failed: %d\n' "$PASS" "$FAIL"
fi
printf '================================\n'
[ "$FAIL" -eq 0 ]
