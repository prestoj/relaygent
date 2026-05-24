# Tailscale Cert Renewal Runbook

Tailscale-issued Let's Encrypt certs expire every 90 days. This runbook
renews them on day 80 of the cycle — safe buffer before expiry.

## Run on this machine

```bash
HOSTNAME=$(tailscale status --self --json | python3 -c "import json,sys; print(json.load(sys.stdin)['Self']['DNSName'].rstrip('.'))")
cd ~/.relaygent/certs

# macOS: tailscale cert works without sudo (admin context)
# Linux: needs sudo unless tailscale set --operator=$USER was run
if [[ "$(uname)" == "Darwin" ]]; then
    tailscale cert "$HOSTNAME"
else
    sudo tailscale cert "$HOSTNAME"
fi

# Replace the canonical pem files (config.json hub.tls points here)
cp "$HOSTNAME.crt" cert.pem
cp "$HOSTNAME.key" key.pem
chmod 644 cert.pem; chmod 600 key.pem
[[ "$(uname)" != "Darwin" ]] && sudo chown "$USER:$USER" cert.pem key.pem

# Verify new expiry
openssl x509 -in cert.pem -noout -dates
```

## Restart hub to pick up new cert

**Hub keeps the cert in memory** — `launchctl kickstart -k` on macOS does NOT always replace the running node process. Force-kill first:

```bash
# macOS
pkill -9 -f "ws-server.mjs"
sleep 2
launchctl kickstart -k gui/$(id -u)/com.claude.hub-svelte
sleep 5
openssl s_client -connect localhost:8080 -servername "$HOSTNAME" </dev/null 2>/dev/null | openssl x509 -noout -dates

# Linux (supervised)
~/relaygent/bin/relaygent restart    # restarts everything
# wait ~10s for hub to come back up
curl -sk https://localhost:8080/ -o /dev/null -w "HTTP %{http_code}\n"
```

## Verification

The cert served by hub should match the cert on disk. If not, the hub didn't reload — repeat the force-kill step.

```bash
# Disk
openssl x509 -in ~/.relaygent/certs/cert.pem -noout -dates
# Served
openssl s_client -connect localhost:8080 -servername "$HOSTNAME" </dev/null 2>/dev/null | openssl x509 -noout -dates
```

Both should show notAfter ~90 days from now.

## Mark task complete

Update tasks.md `last:` timestamp. The task collector auto-advances when the cron fires, but on a manual run you may need to edit the file.

## Notes

- Tailscale certs are issued by Let's Encrypt via tailscale's coordination server. The 90-day expiry is the standard LE policy.
- If `tailscale cert` fails with "access denied", check that the machine is logged into tailscale (`tailscale status`) and that MagicDNS is enabled.
- If the new cert fails to load on the hub, check file permissions: cert.pem 644, key.pem 600.
