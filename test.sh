#!/usr/bin/env bash
# Run all relaygent tests. Exit 1 if any suite fails.
# Usage: ./test.sh [--fast]   (--fast skips slower node suites)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PASS=0; FAIL=0

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

# --- Harness (Python, system python3) ---
run "harness" python3 -m pytest "$ROOT/tests/harness/" -q

# --- Notifications (Python, venv) ---
run "notifications" "$ROOT/notifications/.venv/bin/python" -m pytest \
  "$ROOT/tests/notifications/" -q

# --- Hub (Node) ---
run "hub" node --import="$ROOT/tests/hub/helpers/kit-loader.mjs" \
  --test "$ROOT/tests/hub/"*.test.js

# --- Secrets (Node) ---
run "secrets" node --test "$ROOT/tests/secrets/test_vault.mjs"

# --- Email (Node) ---
run "email" node --test "$ROOT/tests/email/test_email_poller.mjs" \
  "$ROOT/tests/email/test_gmail_client.mjs"

# --- Computer-use Python ---
run "computer-use/python" python3 -m pytest \
  "$ROOT/tests/computer-use/test_linux_input.py" \
  "$ROOT/tests/computer-use/test_linux_display.py" -q

# --- Computer-use Node ---
# test_cdp.mjs is mac-only (requires Chrome on port 9223 with mac CDP profile)
CU_NODE_TESTS=("$ROOT/tests/computer-use/test_hammerspoon_unit.mjs" "$ROOT/tests/computer-use/test_browser_exprs.mjs")
if [[ "$(uname)" == "Darwin" ]]; then
  CU_NODE_TESTS+=("$ROOT/tests/computer-use/test_cdp.mjs")
fi
run "computer-use/node" node --test "${CU_NODE_TESTS[@]}"

# --- Summary ---
printf '\n================================\n'
printf 'Suites passed: %d  failed: %d\n' "$PASS" "$FAIL"
printf '================================\n'
[ "$FAIL" -eq 0 ]
