#!/bin/bash
# Doctor: service health + security checks (sourced by doctor.sh)
# Requires: HUB_PORT, NOTIF_PORT, HUB_SCHEME, CURL_K, CONFIG_FILE
# Requires: ok_msg, skip_msg, do_fix from doctor.sh

# --- Service health ---
echo -e "\n${CYAN}Service health:${NC}"
_check_svc() {
    local name=$1 port=$2 svc_name=$3
    local path=${4:-/health}
    local scheme="http"; [[ "$port" = "$HUB_PORT" ]] && scheme="${HUB_SCHEME:-http}"
    if curl -sf $CURL_K --max-time 2 "${scheme}://127.0.0.1:$port$path" >/dev/null 2>&1; then
        ok_msg "$name responding on :$port"
    elif is_docker 2>/dev/null; then
        skip_msg "$name not responding on :$port — restart container: docker restart <name>"
    elif [[ "$(uname)" == "Darwin" ]]; then
        local plist="com.relaygent.${svc_name}.plist"
        if [[ -f "$HOME/Library/LaunchAgents/$plist" ]]; then
            do_fix "Restart $name (LaunchAgent)" \
                "launchctl kickstart -k 'gui/$(id -u)/com.relaygent.$svc_name' 2>/dev/null || launchctl stop 'com.relaygent.$svc_name' 2>/dev/null; sleep 1; launchctl start 'com.relaygent.$svc_name' 2>/dev/null"
        else
            skip_msg "$name not responding and no LaunchAgent found"
        fi
    else
        local unit="relaygent-${svc_name}.service"
        if systemctl --user is-enabled "$unit" &>/dev/null; then
            do_fix "Restart $name (systemd)" "systemctl --user restart '$unit'"
        else
            skip_msg "$name not responding and no systemd service found"
        fi
    fi
}
_check_svc "Hub" "$HUB_PORT" "hub" "/api/health"
_check_svc "Notifications" "$NOTIF_PORT" "notifications"

# --- Security ---
echo -e "\n${CYAN}Security:${NC}"
_has_tls=0; _has_pw=0
[[ -f "$CONFIG_FILE" ]] && {
    _tls_cert=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf-8'));console.log(c.hub?.tls?.cert||'')}catch{}" 2>/dev/null || true)
    _pw_hash=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf-8'));console.log(c.hub?.passwordHash||'')}catch{}" 2>/dev/null || true)
    [[ -n "$_tls_cert" ]] && _has_tls=1
    [[ -n "$_pw_hash" ]] && _has_pw=1
}
[[ "$_has_tls" == 1 ]] && ok_msg "TLS configured" || echo -e "  ${YELLOW}▸ HTTPS not configured — run: relaygent setup-tls${NC}"
[[ "$_has_pw" == 1 ]] && ok_msg "Hub password set" || echo -e "  ${YELLOW}▸ No hub password — run: relaygent set-password${NC}"
