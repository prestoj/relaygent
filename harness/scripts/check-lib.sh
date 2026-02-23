#!/usr/bin/env bash
# Check/diagnostic helpers (ck_ok, ck_warn, ck_fail, ck_summary).
# Source lib.sh first for color vars, then source this file.

_CK_PASS=0; _CK_FAIL=0; _CK_WARN=0
ck_ok()   { echo -e "  ✓ $1: ${GREEN}$2${NC}";   _CK_PASS=$((_CK_PASS+1)); }
ck_warn() { echo -e "  ⚠ $1: ${YELLOW}$2${NC}"; _CK_WARN=$((_CK_WARN+1)); }
ck_fail() { echo -e "  ✗ $1: ${RED}$2${NC}";    _CK_FAIL=$((_CK_FAIL+1)); }

ck_summary() {
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    if [ "$_CK_FAIL" -gt 0 ]; then
        echo -e "  ${RED}$_CK_FAIL failed, $_CK_WARN warnings, $_CK_PASS passed.${NC}"
        echo -e "  ${RED}Try: relaygent doctor (auto-fix) or fix manually, then: relaygent start${NC}"
        return 1
    elif [ "$_CK_WARN" -gt 0 ]; then
        echo -e "  ${YELLOW}$_CK_WARN warnings, $_CK_PASS passed. Try: relaygent doctor${NC}"
    else
        echo -e "  ${GREEN}All $_CK_PASS checks passed.${NC}"
    fi
}
