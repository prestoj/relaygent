/**
 * Backlog task picker for get_next_task — extracted from mcp-server.mjs so it can
 * be unit-tested without starting the stdio MCP server (which auto-connects on import).
 *
 * Priority: one-off tasks.md items → HANDOFF open threads → active projects → curiosities.
 *
 * NOTE: recurring (`type: recurring`) tasks are intentionally NOT surfaced here. They have
 * their own wake path — the tasks_collector fires them via cron when they're actually due.
 * Surfacing them as idle-backlog meant a not-due cron task (e.g. a weekday-only "review
 * trading book" on a Saturday) would be returned as "work to do now" even though it can't
 * meaningfully be done — a dead end. Skipping them lets the picker fall through to a real
 * actionable thread (HANDOFF/projects/curiosities) instead.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_TOPICS = path.join(os.homedir(), "knowledge/topics");

async function readSafe(p) {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return "";
  }
}

export async function pickNextTask(topicsDir = DEFAULT_TOPICS) {
  // 1. tasks.md — first unchecked one-off `- [ ]` item (recurring cron tasks self-fire).
  const tasks = await readSafe(path.join(topicsDir, "tasks.md"));
  const taskMatch = tasks
    .split("\n")
    .find((l) => /^-\s*\[\s\]/.test(l) && !/type:\s*recurring/i.test(l));
  if (taskMatch) {
    return { source: "tasks.md", description: taskMatch.replace(/^-\s*\[\s\]\s*/, "").trim() };
  }

  // 2. HANDOFF.md — first line under "Open Threads" starting with "-"
  const handoff = await readSafe(path.join(topicsDir, "HANDOFF.md"));
  const openSection = handoff.split(/^##+\s*Open Threads/im)[1] || "";
  const openItem = openSection.split("\n").find((l) => /^-\s+\S/.test(l));
  if (openItem) {
    return { source: "HANDOFF.md open threads", description: openItem.replace(/^-\s+/, "").trim() };
  }

  // 3. projects.md — first active project bullet
  const projects = await readSafe(path.join(topicsDir, "projects.md"));
  const projActive = projects.split(/^##+\s*Active/im)[1] || "";
  const projItem = projActive.split("\n").find((l) => /^-\s+\*\*/.test(l));
  if (projItem) {
    return { source: "projects.md active", description: projItem.replace(/^-\s+/, "").trim() };
  }

  // 4. curiosities.md — first active question
  const curios = await readSafe(path.join(topicsDir, "curiosities.md"));
  const curActive = curios.split(/^##+\s*Active Questions/im)[1] || "";
  const curItem = curActive.split("\n").find((l) => /^-\s+\*\*/.test(l));
  if (curItem) {
    return { source: "curiosities.md", description: curItem.replace(/^-\s+/, "").trim() };
  }

  return null;
}
