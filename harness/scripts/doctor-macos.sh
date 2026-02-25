#!/bin/bash
# macOS-specific doctor checks (sourced by doctor.sh)
# Requires: REPO_DIR, DRY_RUN, do_fix, ok_msg from doctor.sh

# --- Hammerspoon app ---
echo -e "\n${CYAN}Hammerspoon:${NC}"
if [[ -d "/Applications/Hammerspoon.app" ]] || [[ -d "$HOME/Applications/Hammerspoon.app" ]]; then
    if ! pgrep -q Hammerspoon; then
        do_fix "Launch Hammerspoon" "open -a Hammerspoon"
    elif ! curl -sf --max-time 2 "http://127.0.0.1:${HS_PORT:-8097}/health" >/dev/null 2>&1; then
        skip_msg "Hammerspoon running but server not responding on :${HS_PORT:-8097} — check config"
    else
        ok_msg "Hammerspoon running and responding"
        # Verify screenshot permissions (Accessibility + Screen Recording)
        _SS=$(curl -sf --max-time 5 -X POST "http://127.0.0.1:${HS_PORT:-8097}/screenshot" \
            -H "Content-Type: application/json" -d '{}' 2>/dev/null || echo "")
        if echo "$_SS" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('path')" 2>/dev/null; then
            ok_msg "Screenshot permissions working"
        else
            skip_msg "Screenshot failed — grant Accessibility + Screen Recording in System Settings > Privacy & Security"
        fi
    fi
else
    skip_msg "Hammerspoon not installed — brew install --cask hammerspoon"
fi

# --- Hammerspoon Lua files ---
if [[ -d "$HOME/.hammerspoon" ]]; then
    _HS_OK=1
    for f in "$REPO_DIR"/hammerspoon/*.lua; do f="$(basename "$f")"
        if [[ ! -f "$HOME/.hammerspoon/$f" ]]; then
            do_fix "Copy $f to ~/.hammerspoon/" "cp '$REPO_DIR/hammerspoon/$f' '$HOME/.hammerspoon/$f'"
            _HS_OK=0
        elif ! diff -q "$REPO_DIR/hammerspoon/$f" "$HOME/.hammerspoon/$f" >/dev/null 2>&1; then
            do_fix "Update stale $f in ~/.hammerspoon/" "cp '$REPO_DIR/hammerspoon/$f' '$HOME/.hammerspoon/$f'"
            _HS_OK=0
        fi
    done
    [[ "$_HS_OK" == 1 ]] && ok_msg "All Lua files up to date"
fi

# --- VNC server (Remote Management) ---
echo -e "\n${CYAN}VNC server:${NC}"
_VNC_PORT=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('vnc',{}).get('port',5900))" 2>/dev/null || echo 5900)
_VNC_PW=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('vnc',{}).get('password',''))" 2>/dev/null || echo "")
if [[ -n "$_VNC_PW" ]]; then
    if nc -z localhost "$_VNC_PORT" 2>/dev/null; then
        ok_msg "VNC listening on :$_VNC_PORT"
    else
        _KS="/System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart"
        if [[ -x "$_KS" ]]; then
            do_fix "Restart VNC (kickstart)" \
                "sudo '$_KS' -activate -configure -access -on -clientopts -setvnclegacy -vnclegacy yes -restart -agent -privs -all -allowAccessFor -allUsers >/dev/null 2>&1 && sleep 2 && nc -z localhost $_VNC_PORT"
        else
            skip_msg "VNC not listening on :$_VNC_PORT and kickstart not found"
        fi
    fi
else
    ok_msg "VNC not configured (no vnc.password in config)"
fi

# --- macOS typing optimization ---
echo -e "\n${CYAN}macOS typing:${NC}"
_TYPING_OK=1
for key in NSAutocorrect NSAutomaticSpellingCorrectionEnabled NSAutomaticCapitalizationEnabled NSAutomaticPeriodSubstitutionEnabled NSAutomaticTextCompletionEnabled; do
    val=$(defaults read NSGlobalDomain "$key" 2>/dev/null || echo "")
    if [[ "$val" != "0" ]]; then
        do_fix "Disable $key" "defaults write NSGlobalDomain $key -bool false"
        _TYPING_OK=0
    fi
done
[[ "$_TYPING_OK" == 1 ]] && ok_msg "Autocorrect/autocapitalize disabled"
