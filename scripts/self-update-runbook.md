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

## Two modes — read the task line that woke you

The `tasks.md` entry says either **update** or **partner-check** in its description. Do that mode.

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
