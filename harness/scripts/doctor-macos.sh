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
    fi
else
    skip_msg "Hammerspoon not installed — brew install --cask hammerspoon"
fi

# --- Hammerspoon Lua files ---
if [[ -d "$HOME/.hammerspoon" ]]; then
    _HS_OK=1
    for f in "$REPO_DIR"/hammerspoon/*.lua; do f="$(basename "$f")"
        if [[ ! -f "$HOME/.hammerspoon/$f" ]] && [[ -f "$REPO_DIR/hammerspoon/$f" ]]; then
            do_fix "Copy $f to ~/.hammerspoon/" "cp '$REPO_DIR/hammerspoon/$f' '$HOME/.hammerspoon/$f'"
            _HS_OK=0
        fi
    done
    [[ "$_HS_OK" == 1 ]] && ok_msg "All Lua files present"
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
