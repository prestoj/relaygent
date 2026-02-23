#!/bin/bash
# macOS-specific doctor checks (sourced by doctor.sh)
# Requires: REPO_DIR, DRY_RUN, do_fix, ok_msg from doctor.sh

# --- Hammerspoon Lua files ---
if [[ -d "$HOME/.hammerspoon" ]]; then
    echo -e "\n${CYAN}Hammerspoon config:${NC}"
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
