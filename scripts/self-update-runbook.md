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
   agent-two's 04:00 run precedes agent-one's, so there's nothing to check then). Partner hub
   `/api/health` over Tailscale (it's a PUBLIC path — no auth cookie needed; use `curl -sk`):
   - If you are **agent-two**, partner = agent-one (supervised): `curl -sk https://100.69.252.122:8080/api/health`
   - If you are **agent-one**, partner = agent-two (unsupervised): `curl -sk https://unsupervised:8080/api/health`
   - If the partner is **down/unreachable** and it's past their update slot → go to **Rescue** below
     BEFORE updating yourself (don't compound an outage).

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

1. Curl the partner's hub `/api/health` over Tailscale (see addresses above). Give it a couple of
   retries over ~2 min (they may still be restarting).
2. **Healthy** → post one line to #general (`agent-X: partner agent-Y healthy post-update ✅`) and finish.
3. **Down/unreachable** → go to **Rescue**.

---

## Rescue (partner appears broken after their update)

The likely cause is a bad update that left the partner's **relay** crash-looping (so the partner
agent can't act for itself).

1. **Alert Preston immediately** — it's off-hours and this is the case worth waking him judgement on:
   iMessage `+18014731900` (preferred) AND Slack DM `D0AF8JYQ5U5`. Be specific: which machine, what's
   down (hub? relay? notifications?), since when, what you've checked.
2. **Safe autonomous fixes** (do these): if the partner's **hub or notifications** is down but the
   machine is reachable, SSH in (`ssh claude@<partner-ip>`) and restart THOSE services
   (`relaygent doctor` / service restart). Post what you did to #general.
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
