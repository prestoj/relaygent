#!/bin/bash
# Relaygent FULL-STACK update (weekly) — OS + browsers + tools + the daily update.
#
# Companion to the daily update.sh. Run staggered + partner-rescue-aware like the
# daily self-update (see self-update-runbook.md, Mode C). Auto-applies point/security
# + within-release updates ONLY; MAJOR release upgrades (Ubuntu 24.04->24.10, macOS
# 26->27) are deliberately held for a manual call.
#
# This script does the PACKAGE work and prints a summary. It deliberately does NOT
# reboot — if a reboot is needed it sets the flag in the summary and the AGENT performs
# the coordinated reboot (verify partner healthy -> post #general -> reboot) per runbook.
set -uo pipefail   # NOT -e: continue through individual step failures and report them all

source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

SUMMARY=()
REBOOT_NEEDED=false
note()   { echo -e "$@"; }
record() { SUMMARY+=("$1"); }

OS="$(uname)"
note "${CYAN}Relaygent full-stack update — $OS — $(date)${NC}"

# ---------- Platform: macOS (agent-two owns this branch) ----------
if [ "$OS" = "Darwin" ]; then
    note "${YELLOW}macOS branch — owned by agent-two (stub).${NC}"
    # TODO(agent-two): fill in —
    #   - softwareupdate -l; apply ONLY items WITHOUT a major-version jump (hold 26->27)
    #   - brew update && brew upgrade && brew cleanup
    #   - Chrome / other browsers; npm globals / other CLI tools
    #   - set REBOOT_NEEDED=true if softwareupdate flags a restart
    record "⚠ macOS full-stack steps not yet implemented (agent-two branch)"

# ---------- Platform: Linux (agent-one / supervised) ----------
elif [ "$OS" = "Linux" ]; then
    # 1) APT — within-release upgrades (incl. new kernels) + security. NEVER call
    #    do-release-upgrade here: a release jump is the held 'major' upgrade.
    note "${CYAN}[apt] update + full-upgrade (within-release; release jumps held)${NC}"
    if sudo apt-get update -qq; then
        PENDING=$(apt list --upgradable 2>/dev/null | grep -vc '^Listing')
        if sudo DEBIAN_FRONTEND=noninteractive apt-get -y full-upgrade; then
            record "✓ apt: full-upgrade OK ($PENDING pkgs were pending)"
        else
            record "✗ apt full-upgrade failed — check manually"
        fi
        sudo DEBIAN_FRONTEND=noninteractive apt-get -y autoremove --purge >/dev/null 2>&1 || true
    else
        record "✗ apt update failed (network?)"
    fi
    # Chrome + node/npm are apt-managed here (google-chrome + nodesource repos), so the
    # step above already updates them. Do NOT `npm i -g npm@latest` on this box: it
    # fights apt-managed npm and errors (MODULE_NOT_FOUND). apt owns node+npm.

    # 2) Kernel / NVIDIA — if a newer kernel is installed than the running one, ensure
    #    the nvidia module is built for it BEFORE reboot, or the GPUs vanish on next boot.
    RUNNING_K="$(uname -r)"
    LATEST_K="$(ls -1 /boot/vmlinuz-* 2>/dev/null | sed 's#.*/vmlinuz-##' | sort -V | tail -1)"
    if [ -n "$LATEST_K" ] && [ "$LATEST_K" != "$RUNNING_K" ]; then
        note "${YELLOW}[kernel] $LATEST_K installed (running $RUNNING_K)${NC}"
        if dpkg -l | grep -q '^ii.*nvidia-driver'; then
            DRV=$(dpkg -l | grep -oE 'nvidia-driver-[0-9]+' | grep -oE '[0-9]+$' | head -1)
            if sudo apt-get install -y "linux-modules-nvidia-${DRV}-open-${LATEST_K}" 2>/dev/null; then
                record "✓ nvidia module installed for kernel $LATEST_K"
            else
                record "⚠ nvidia module for $LATEST_K not auto-installed — verify GPUs after reboot (see MEMORY)"
            fi
        fi
        REBOOT_NEEDED=true
    fi
    [ -f /var/run/reboot-required ] && REBOOT_NEEDED=true

    # 3) Ollama — self-updating install script (NOT apt-managed). Idempotent.
    if command -v ollama >/dev/null 2>&1; then
        OLD_O=$(ollama --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
        if curl -fsSL https://ollama.com/install.sh | sh >/dev/null 2>&1; then
            NEW_O=$(ollama --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
            [ "$OLD_O" = "$NEW_O" ] && record "✓ ollama: $NEW_O (current)" || record "✓ ollama: $OLD_O → $NEW_O"
        else
            record "⚠ ollama update skipped (install script failed)"
        fi
    fi
else
    record "⚠ unknown platform $OS — only running the daily update below"
fi

# ---------- Shared: the daily update (repo + CLI + hub + services + health) ----------
note "\n${CYAN}[daily] running the standard update (repo, CLI, hub, services)${NC}"
if bash "$REPO_DIR/harness/scripts/update.sh"; then
    record "✓ daily update (repo/CLI/hub) OK"
else
    record "✗ daily update reported a problem — run 'relaygent health'"
fi

# ---------- Summary ----------
note "\n${CYAN}===== full-stack update summary =====${NC}"
for line in ${SUMMARY[@]+"${SUMMARY[@]}"}; do note "  $line"; done

if [ "$REBOOT_NEEDED" = true ]; then
    note "\n${YELLOW}*** REBOOT REQUIRED ***${NC}"
    note "  A reboot bounces all services + this relay session. Do NOT reboot blindly."
    note "  Agent: follow self-update-runbook.md 'Mode C' — confirm partner healthy (it"
    note "  rescues you), post a heads-up to #general, then: ${CYAN}sudo reboot${NC}"
    note "  After reboot verify both GPUs: ${CYAN}nvidia-smi${NC} (if missing, see MEMORY nvidia/kernel fix)."
fi
