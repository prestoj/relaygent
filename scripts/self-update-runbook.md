# Runbook: Coordinated self-update (agent-two ↔ agent-one)

You were woken by a recurring task to keep this machine current. The two relay agents
update on a **staggered** schedule so they're never both down at once and each can rescue
the other. Default schedule (local Pacific time):

- **agent-two @ 04:00** — update self
- **agent-one @ 04:30** — verify agent-two recovered, then update self
- **agent-two @ 05:00** — verify agent-one recovered (check-only, no self-update)

Identify yourself by hostname (`hostname`): `unsupervised` = **agent-two**, `supervised` =
**agent-one**. Your **partner** is the other one. This is off-hours by design — keep it quiet
unless something is wrong.

## Modes — read the task line that woke you

The `tasks.md` entry says **update**, **partner-check**, or **full-update** in its description. Do
that mode. **update**/**partner-check** are the *daily* lightweight cycle; **full-update** is the
*weekly* full-stack sweep (Mode C) that also updates the OS, browsers, and other tooling.

---

## Mode A — UPDATE (run `relaygent update` on this machine)

1. **Pre-check your partner first** (skip only if the partner hasn't had their slot yet today —
   agent-two's 04:00 run precedes agent-one's, so there's nothing to check then). Read **Health
   signals** below before interpreting any result — the cross-machine hub curl is unreliable. The
   short version: partner is fine if its **Tailscale node is `active`** AND it **posted a healthy
   update line** to #general (or hasn't reached its slot yet). Only go to **Rescue** if the
   Tailscale node is **offline**, or the partner **reported a failed update / went silent well past
   its slot**.

2. **Run the update** and capture output:
   `relaygent update` (pulls main, updates the Claude CLI, rebuilds hub, restarts services,
   health-checks hub + notifications). It does NOT kill this session.

3. **Verify**: confirm the tail shows "Update complete — all services healthy." If a service is
   unhealthy, run `relaygent health` / `relaygent doctor` and fix (autonomous on hub/notifications
   ops; NEVER restart the *relay* without Preston — see Rescue).

4. **Report** one short line to Slack #general (`C0AG77MFLAU`): e.g.
   `agent-two: daily update ✅ — main <short-sha>, CLI <ver>, hub+notif healthy`.
   Include the git short-sha (`git -C ~/projects/relaygent rev-parse --short HEAD`) and
   `claude --version`.

5. **Land on the new binary IF it changed**: `relaygent update` installs the latest Claude CLI on
   disk, but this running session keeps the old binary until the relay restarts. If `claude --version`
   or git HEAD advanced this run → **write HANDOFF.md and `retire`** so the successor session starts
   on the new code/binary. If nothing changed, do NOT retire — just finish.

6. Update your `tasks.md` `last:` is auto-advanced by the collector; update the **Agent Work** line
   to note the update.

---

## Mode B — PARTNER-CHECK (verify your partner recovered; no self-update)

1. Check the partner's health via the **Health signals** below (NOT the bare hub curl — it
   false-negatives cross-machine). Authoritative-enough = Tailscale node `active` + the partner's
   #general update line shows success. Give it a couple of retries over ~2 min (they may still be
   restarting / their successor may still be coming up).
2. **Healthy** → post one line to #general (`agent-X: partner agent-Y healthy post-update ✅`) and finish.
3. **Down** (Tailscale node offline, or partner reported a failed update / silent past slot) → **Rescue**.

---

## Mode C — FULL-UPDATE (weekly full-stack sweep)

Same staggered + partner-rescue discipline as Mode A, but it also updates the OS and tooling, so
it can require a **reboot**. Preston's rule (2026-06-02): keep the whole stack current — OS, Claude
CLI, relaygent, browsers, and any other tools — but **HOLD major release upgrades** (Ubuntu
24.04→24.10, macOS 26→27) for a manual call. The script encodes that: it never runs
`do-release-upgrade` / a major `softwareupdate` jump.

1. **Pre-check your partner** (same as Mode A — Tailscale `active` + healthy #general line).
2. **Run** `relaygent full-update` and capture output. It applies apt/`softwareupdate` (point +
   security + within-release only), kernel + NVIDIA module (Linux), Ollama, browsers, then the
   standard daily update (repo/CLI/hub/services), and prints a **summary** with a `✓/✗/⚠` per step.
3. **Read the summary.** Fix any `✗` (autonomous on hub/notifications/package ops; never the relay).
4. **If the summary says `*** REBOOT REQUIRED ***`** — the script does NOT reboot itself. You do it,
   coordinated:
   a. Confirm your **partner is healthy** (it's your rescuer while you're down) — Health signals below.
   b. Post a heads-up to #general: `agent-X: full-update done, rebooting for kernel/OS — back in ~3-5 min`.
   c. **Reboot — platform-specific:**
      - **Linux**: `sudo reboot`. The apt/kernel update is already installed; the reboot just
        activates the new kernel. Services auto-recover (systemd --user lingering units).
      - **macOS**: do NOT `sudo reboot` for an OS update — the update is only *staged*, and the
        actual install happens AT restart via a special boot that needs a **volume-owner
        credential** (Apple Silicon; plain `sudo` reaches "Prepared" then silently exits without
        rebooting). Pull vault `system_password` INLINE (never log it) and run:
        ```
        PW=$(node -e "import('file:///Users/claude/projects/relaygent/secrets/vault.mjs').then(v=>process.stdout.write(v.getSecret('system_password')))")
        printf '%s\n' "$PW" | sudo -n /usr/sbin/softwareupdate -i -r -R --user claude --stdinpass --agree-to-license
        ```
        `-r` installs recommended only (a major macOS jump stays held); `-R` restarts when done.
        Services auto-recover via LaunchAgents — **but only because auto-login is enabled.**
      - **macOS PREREQUISITE — auto-login MUST be enabled** (no FileVault): macOS GUI LaunchAgents
        (relay/hub/Tailscale) only start once a user logs into the desktop, so a reboot with no
        auto-login STRANDS the Mac at the login window — relay/hub/Tailscale never start (only sshd
        + mDNS, which are system daemons, come up). This bit agent-two on 2026-06-02. The
        `full-update` summary asserts auto-login before flagging the reboot; if it warns it's OFF,
        fix it first. Recovery + the auto-login setup (write `/etc/kcpassword` by hand —
        `sysadminctl`'s pw step errors:22) is in MEMORY "Rescuing agent-two's Mac".
   d. **After reboot, verify GPUs**: `nvidia-smi`. If "No devices found" but `lspci` shows them, the
      kernel out-paced the NVIDIA module — `sudo apt install linux-modules-nvidia-<DRV>-open-$(uname -r)`
      then `sudo modprobe nvidia` (see MEMORY "NVIDIA driver / kernel mismatch").
   e. Post the all-clear line to #general once services are confirmed healthy.
5. **Report + land on new code**: one #general line with the summary gist; if HEAD/CLI advanced, write
   HANDOFF.md and `retire` so the successor starts on the new code (same as Mode A step 5).

If a **major release** is available (held by design), don't apply it — surface it to Preston with the
version and the ~downtime, and let him make the call.

## Health signals (READ THIS — the hub curl lies cross-machine)

Verified 2026-05-30 (both directions): the partner's hub `/api/health` over Tailscale returns
**HTTP 000 / timeout even when the partner is fully healthy** — the hub binds localhost and is not
exposed on the tailnet interface. **SSH to the partner can also time out** from the other box for
the same reason. So neither the hub curl nor SSH is a reliable liveness check between the two
machines. Do NOT treat a failed curl/SSH as "partner down."

Use these signals instead, in order:

1. **Tailscale node presence** (authoritative for "the box is up"): `tailscale status` — the
   partner line should read `active` (e.g. `100.69.252.122 supervised ... active; direct ...`).
   `active` = node online. Only a node shown **offline / no line** is a real down signal.
2. **The partner's #general self-report**: each agent posts `agent-X: daily update ✅ …` on
   success. A posted success line = healthy. A posted failure, or **silence well past their slot**
   (≥~20 min) with no success line, is the real "investigate" trigger.
3. **(best-effort) loopback health via SSH** — only if SSH happens to be reachable from your box:
   `ssh claude@<partner-ip> 'curl -sk https://127.0.0.1:8080/api/health'` (loopback bypasses the
   localhost-bind problem). Treat an SSH *timeout* as inconclusive, not as down (see above).

Bottom line: **Tailscale `active` + a healthy #general line = partner healthy.** Escalate to
Rescue only when Tailscale shows the node offline OR the partner reported a failed update / went
silent past its slot.

## Rescue (partner appears broken after their update)

The likely cause is a bad update that left the partner's **relay** crash-looping (so the partner
agent can't act for itself).

1. **Alert Preston immediately** — it's off-hours and this is the case worth waking him judgement on:
   iMessage `+18014731900` (preferred) AND Slack DM `D0AF8JYQ5U5`. Be specific: which machine, what's
   down (hub? relay? notifications?), since when, what you've checked.
2. **Safe autonomous fixes** (do these): if the partner's **hub or notifications** is down but the
   machine is reachable, SSH in (`ssh claude@<partner-ip>`) and restart THOSE services
   (`relaygent doctor` / service restart). Post what you did to #general. **If SSH itself times
   out** (it can, even when the box is up — see Health signals), that is NOT proof the machine is
   down; confirm via Tailscale presence first, and if the node is `active` but you genuinely can't
   reach it, surface that to Preston (step 1) rather than assuming the worst.
3. **DO NOT restart the partner's RELAY** (`com.claude.relay` / `relay.py`) without Preston's
   go-ahead — standing rule. If the relay is the thing that's down, that's Preston's call; your job
   is to surface it loudly (step 1) and stand by. If he replies authorizing it, then act.
4. Once the partner is back, post the all-clear to #general.

## Notes
- Cron in `tasks.md` is **local time**. Both machines should target ~04:00–05:00 Pacific. If a
  machine's clock is UTC, offset the cron accordingly (agent-one: confirm your TZ).
- `relaygent update` switches the tree to `main` and stashes/pops local changes — safe, but if you
  were mid-PR on a branch it restores it afterward.
- This is intentionally low-noise: a healthy update is ONE #general line. Only escalate to Preston on
  failure.
