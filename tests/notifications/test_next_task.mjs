/**
 * Tests for notifications/next-task.mjs pickNextTask().
 * Run: node --test tests/notifications/test_next_task.mjs
 *
 * Key behavior under test: recurring (`type: recurring`) tasks are skipped (they self-fire
 * via the cron wake path), so the picker doesn't return a not-due cron task as idle work —
 * it falls through to a real actionable source.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { pickNextTask } from "../../notifications/next-task.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "next-task-test-"));
const write = (name, body) => fs.writeFileSync(path.join(tmp, name), body);
const clear = () => fs.readdirSync(tmp).forEach((f) => fs.rmSync(path.join(tmp, f)));

const RECURRING_TASKS = `## Recurring
- [ ] Review trading book | type: recurring | cron: "30 6,12 * * 1-5" | last: 2026-05-29 12:30
- [ ] Self-update | type: recurring | cron: "0 4 * * *" | last: 2026-05-30 04:00

## One-off
`;

const HANDOFF = `## Open Threads
- Phone agent: await Preston's VoIP decision
- Some other thread
`;

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("pickNextTask", () => {
  before(() => clear());

  it("skips recurring cron tasks and falls through to HANDOFF open threads", async () => {
    clear();
    write("tasks.md", RECURRING_TASKS);
    write("HANDOFF.md", HANDOFF);
    const t = await pickNextTask(tmp);
    assert.equal(t.source, "HANDOFF.md open threads");
    assert.match(t.description, /Phone agent/);
  });

  it("returns a one-off task ahead of HANDOFF, but still skips recurring", async () => {
    clear();
    write(
      "tasks.md",
      RECURRING_TASKS + "- [ ] Ship the thing | type: one-off\n",
    );
    write("HANDOFF.md", HANDOFF);
    const t = await pickNextTask(tmp);
    assert.equal(t.source, "tasks.md");
    assert.equal(t.description, "Ship the thing | type: one-off");
  });

  it("treats a `- [ ]` item with no type as a one-off (surfaced)", async () => {
    clear();
    write("tasks.md", "## One-off\n- [ ] Bare task with no type field\n");
    const t = await pickNextTask(tmp);
    assert.equal(t.source, "tasks.md");
    assert.equal(t.description, "Bare task with no type field");
  });

  it("falls through to projects.md active when tasks + handoff are empty", async () => {
    clear();
    write("tasks.md", RECURRING_TASKS); // recurring only -> skipped
    write("projects.md", "## Active\n- **Relaygent** — make it better\n");
    const t = await pickNextTask(tmp);
    assert.equal(t.source, "projects.md active");
    assert.match(t.description, /Relaygent/);
  });

  it("falls through to curiosities.md when nothing earlier matches", async () => {
    clear();
    write("tasks.md", RECURRING_TASKS);
    write("curiosities.md", "## Active Questions\n- **Deep dive on a paper** — always welcome\n");
    const t = await pickNextTask(tmp);
    assert.equal(t.source, "curiosities.md");
  });

  it("returns null when all sources are empty / recurring-only", async () => {
    clear();
    write("tasks.md", RECURRING_TASKS);
    const t = await pickNextTask(tmp);
    assert.equal(t, null);
  });
});
