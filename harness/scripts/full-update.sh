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
ensure_detached "$0" "$@"   # survive relay session-sleep — detaches, tails log (lib.sh)

SUMMARY=()
REBOOT_NEEDED=false
note()   { echo -e "$@"; }
record() { SUMMARY+=("$1"); }

OS="$(uname)"
note "${CYAN}Relaygent full-stack update — $OS — $(date)${NC}"

# ---------- Platform: macOS (agent-two / unsupervised) ----------
if [ "$OS" = "Darwin" ]; then
    # 1) Homebrew — formulae + casks (the bulk of CLI tools + GUI apps). No reboot, no creds.
    if command -v brew >/dev/null 2>&1; then
        note "${CYAN}[brew] update + upgrade + cleanup${NC}"
        brew update >/dev/null 2>&1 || true
        N=$(brew outdated --quiet 2>/dev/null | grep -c .)
        NODE_MAJOR_BEFORE=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo "")
        if brew upgrade >/dev/null 2>&1; then
            brew upgrade --cask >/dev/null 2>&1 || true
            brew cleanup >/dev/null 2>&1 || true
            record "✓ brew: upgrade OK ($N formulae were outdated) + casks + cleanup"
        else
            record "✗ brew upgrade failed — run 'brew upgrade' manually"
        fi
        # A node-major bump can leave `node` UNLINKED (`/opt/homebrew/bin/node` vanishes) →
        # fails brew upgrade + blanks NODE_MAJOR_AFTER (skips the ABI heal). Relink (2026-06-14):
        if ! command -v node >/dev/null 2>&1 && brew list --versions node >/dev/null 2>&1; then
            note "${YELLOW}[node] keg left unlinked by brew upgrade — relinking${NC}"
            brew link --overwrite node >/dev/null 2>&1 || true
            if command -v node >/dev/null 2>&1; then
                record "↻ node keg was left unlinked by brew upgrade — relinked ($(node --version 2>/dev/null))"
            else
                record "‼ node keg unlinked AND relink failed — run 'brew link --overwrite node' (hub can't restart without it)"
            fi
        fi
        # A Node MAJOR bump changes the V8 ABI → hub's native better-sqlite3 won't load (chat-db
        # 500s, health stays 200 — s199). `npm rebuild` re-runs prebuild (not `npm install`, #765):
        NODE_MAJOR_AFTER=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo "")
        if [ -n "$NODE_MAJOR_BEFORE" ] && [ -n "$NODE_MAJOR_AFTER" ] && [ "$NODE_MAJOR_BEFORE" != "$NODE_MAJOR_AFTER" ]; then
            note "${YELLOW}[node] major $NODE_MAJOR_BEFORE -> $NODE_MAJOR_AFTER — rebuilding hub better-sqlite3${NC}"
            # ~/.npm cache is sometimes root-owned (breaks npm) — fix non-fatally first.
            if [ -d "$HOME/.npm" ] && [ ! -w "$HOME/.npm" ]; then
                sudo -n /usr/sbin/chown -R "$(id -u):$(id -g)" "$HOME/.npm" 2>/dev/null || true
            fi
            ( cd "$REPO_DIR/hub" && npm install >/dev/null 2>&1; npm rebuild better-sqlite3 >/dev/null 2>&1 )
            if (cd "$REPO_DIR/hub" && node -e "new (require('better-sqlite3'))(':memory:').close()" >/dev/null 2>&1); then
                record "↻ Node $NODE_MAJOR_BEFORE→$NODE_MAJOR_AFTER: hub better-sqlite3 rebuilt + load-verified for new ABI"
            else
                record "‼ Node $NODE_MAJOR_BEFORE→$NODE_MAJOR_AFTER: better-sqlite3 won't load (ABI) — hub chat 500s (s199). Fix: cd hub && npm rebuild better-sqlite3 (or bump it, cf #763)."
            fi
        fi
    fi

    # 2) npm globals — current CLI tools; EXCLUDE @anthropic-ai/claude-code (daily owns the CLI) + npm.
    if command -v npm >/dev/null 2>&1; then
        note "${CYAN}[npm] update global packages (excluding claude-code + npm)${NC}"
        PKGS=$(npm ls -g --depth=0 --parseable 2>/dev/null | tail -n +2 | sed "s#.*/node_modules/##" \
               | grep -vE '^(@anthropic-ai/claude-code|npm)$')
        if [ -n "$PKGS" ] && npm update -g $PKGS >/dev/null 2>&1; then
            record "✓ npm: $(echo "$PKGS" | grep -c .) globals updated (claude-code via daily update)"
        else
            record "⚠ npm globals update had issues — check 'npm outdated -g'"
        fi
    fi

    # 3) Chrome — no brew cask / Keystone here; just report the version (Chrome self-updates in-app).
    CHROME_APP="/Applications/Google Chrome.app"
    if [ -d "$CHROME_APP" ]; then
        CHROME_V=$(defaults read "$CHROME_APP/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null)
        record "ℹ Chrome $CHROME_V (self-updates in-app; no CLI updater installed)"
    fi

    # 4) softwareupdate — point + security ONLY; MAJOR macOS jumps (26->27) HELD (`-r` excludes them).
    #    Never installs a restart-needing update (needs a volume-owner cred) — AGENT reboots, Mode C.
    note "${CYAN}[softwareupdate] scanning (~30-60s)...${NC}"
    SWU=$(/usr/sbin/softwareupdate -l 2>&1)
    CUR_MAJOR=$(sw_vers -productVersion | cut -d. -f1)
    HELD=""
    for m in $(echo "$SWU" | grep -i 'Title: macOS' | grep -oE 'Version: [0-9]+' | grep -oE '[0-9]+'); do
        [ "$m" -gt "$CUR_MAJOR" ] 2>/dev/null && HELD="macOS $m"
    done
    [ -n "$HELD" ] && record "⚠ HELD major upgrade available ($HELD) — surface to Preston, do NOT auto-apply"

    if echo "$SWU" | grep -qi 'No new software available'; then
        record "✓ softwareupdate: macOS $CUR_MAJOR up to date"
    elif echo "$SWU" | grep -qiE 'action: restart|\[restart\]'; then
        # A recommended update needs a restart → defer install+restart to the agent (Mode C).
        record "⚠ macOS update needs a restart — agent applies via credentialed restart (Mode C)"
        REBOOT_NEEDED=true
        # Reboot guard (agent-one's insurance): if auto-login is off, the post-reboot box strands
        # at the login window (no GUI -> no LaunchAgents). Warn LOUDLY so the agent doesn't reboot.
        AL=$(defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null)
        if [ "$AL" = "claude" ] && [ -f /etc/kcpassword ]; then
            record "✓ reboot-safe: auto-login enabled (claude) — box self-recovers after restart"
        else
            record "‼ AUTO-LOGIN OFF — DO NOT REBOOT: box will strand at login window. Enable auto-login first (MEMORY 'Rescuing the Mac')."
        fi
    else
        note "${CYAN}[softwareupdate] applying recommended (non-restart) updates${NC}"
        if sudo -n /usr/sbin/softwareupdate -i -r --no-scan >/dev/null 2>&1; then
            record "✓ softwareupdate: recommended (non-restart) updates applied"
        else
            record "⚠ softwareupdate -i -r failed — run manually"
        fi
    fi

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
    note "  rescues you), post a heads-up to #general, then reboot:"
    if [ "$OS" = "Darwin" ]; then
        note "  macOS: do NOT 'sudo reboot' (it won't apply the STAGED OS update). The install"
        note "  happens AT restart and needs a volume-owner credential. First assert auto-login is"
        note "  ON (claude) — see the summary above — then pull vault 'system_password' INLINE:"
        note "    ${CYAN}printf '%s\\n' \"\$PW\" | sudo -n /usr/sbin/softwareupdate -i -r -R --user claude --stdinpass --agree-to-license${NC}"
        note "  (-r = recommended only, so a major macOS jump stays held; -R restarts when done.)"
    else
        note "  Linux: ${CYAN}sudo reboot${NC} — then verify both GPUs: ${CYAN}nvidia-smi${NC} (if missing, see MEMORY nvidia/kernel fix)."
    fi
fi
