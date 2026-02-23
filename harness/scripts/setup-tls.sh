#!/bin/bash
# relaygent setup-tls — configure TLS for hub using Tailscale certs
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
load_config

CERT_DIR="$HOME/.relaygent/certs"

echo -e "${CYAN}Setting up TLS for Relaygent Hub${NC}\n"

# Check Tailscale
if ! command -v tailscale &>/dev/null; then
    echo -e "  ${RED}Tailscale not installed.${NC}"
    echo -e "  Install: ${CYAN}https://tailscale.com/download${NC}"
    exit 1
fi

# Get Tailscale hostname
TS_HOSTNAME=$(tailscale status --self --json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['Self']['DNSName'].rstrip('.'))" 2>/dev/null || echo "")
if [[ -z "$TS_HOSTNAME" ]]; then
    echo -e "  ${RED}Tailscale not connected.${NC} Run: ${CYAN}tailscale up${NC}"
    exit 1
fi
echo -e "  Tailscale hostname: ${GREEN}$TS_HOSTNAME${NC}"

# Generate certs
mkdir -p "$CERT_DIR"
echo -n "  Generating certificate..."
if tailscale cert --cert-file "$CERT_DIR/cert.pem" --key-file "$CERT_DIR/key.pem" "$TS_HOSTNAME" 2>/dev/null; then
    echo -e " ${GREEN}done${NC}"
else
    echo -e " ${RED}failed${NC}"
    echo -e "  ${YELLOW}Ensure HTTPS is enabled in Tailscale admin console.${NC}"
    echo -e "  ${YELLOW}Admin → DNS → Enable HTTPS certificates${NC}"
    exit 1
fi

# Update config
CONFIG="$HOME/.relaygent/config.json"
if [[ -f "$CONFIG" ]]; then
    python3 -c "
import json, sys
cfg = json.load(open('$CONFIG'))
cfg.setdefault('hub', {})['tls'] = {
    'cert': '$CERT_DIR/cert.pem',
    'key': '$CERT_DIR/key.pem',
    'hostname': '$TS_HOSTNAME'
}
json.dump(cfg, open('$CONFIG', 'w'), indent=2)
print('  Config updated: hub.tls paths set')
"
fi

chmod 600 "$CERT_DIR/key.pem"

echo -e "\n${GREEN}TLS configured!${NC}"
echo -e "  Cert: $CERT_DIR/cert.pem"
echo -e "  Key:  $CERT_DIR/key.pem"
echo -e "  Host: $TS_HOSTNAME"
echo -e "\n  Restart hub: ${CYAN}relaygent restart${NC}"
echo -e "  Then visit:  ${CYAN}https://$TS_HOSTNAME:$HUB_PORT/${NC}"
