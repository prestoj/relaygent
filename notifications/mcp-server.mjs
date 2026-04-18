#!/usr/bin/env node
/**
 * Relaygent Notifications MCP Server — thin entry point.
 *
 * Provides tools for the relay agent to set self-reminders and sleep.
 * Talks to the notifications Flask API.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { tools } from "./mcp-tools.mjs";

const API_PORT = process.env.RELAYGENT_NOTIFICATIONS_PORT || "8083";
const API_URL = `http://127.0.0.1:${API_PORT}`;

async function apiCall(path, method = "GET", body = null) {
  const options = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) options.body = JSON.stringify(body);
  const response = await fetch(`${API_URL}${path}`, options);
  return response.json();
}

function text(msg) {
  return { content: [{ type: "text", text: msg }] };
}

async function pickNextTask() {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const topics = path.join(os.homedir(), "knowledge/topics");
  const readSafe = async (p) => { try { return await fs.readFile(p, "utf8"); } catch { return ""; } };

  // 1. tasks.md — unchecked `- [ ]` items
  const tasks = await readSafe(path.join(topics, "tasks.md"));
  const taskMatch = tasks.split("\n").find(l => /^-\s*\[\s\]/.test(l));
  if (taskMatch) return { source: "tasks.md", description: taskMatch.replace(/^-\s*\[\s\]\s*/, "").trim() };

  // 2. HANDOFF.md — first line under "Open Threads" starting with "-"
  const handoff = await readSafe(path.join(topics, "HANDOFF.md"));
  const openSection = handoff.split(/^##+\s*Open Threads/im)[1] || "";
  const openItem = openSection.split("\n").find(l => /^-\s+\S/.test(l));
  if (openItem) return { source: "HANDOFF.md open threads", description: openItem.replace(/^-\s+/, "").trim() };

  // 3. projects.md — first active project bullet
  const projects = await readSafe(path.join(topics, "projects.md"));
  const projActive = projects.split(/^##+\s*Active/im)[1] || "";
  const projItem = projActive.split("\n").find(l => /^-\s+\*\*/.test(l));
  if (projItem) return { source: "projects.md active", description: projItem.replace(/^-\s+/, "").trim() };

  // 4. curiosities.md — first active question
  const curios = await readSafe(path.join(topics, "curiosities.md"));
  const curActive = curios.split(/^##+\s*Active Questions/im)[1] || "";
  const curItem = curActive.split("\n").find(l => /^-\s+\*\*/.test(l));
  if (curItem) return { source: "curiosities.md", description: curItem.replace(/^-\s+/, "").trim() };

  return null;
}

const server = new Server(
  { name: "relaygent-notifications", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "wait_for_user": {
        const mins = args?.max_minutes;
        if (!Number.isInteger(mins) || mins < 1 || mins > 480) {
          return text("Error: max_minutes must be an integer between 1 and 480.");
        }
        const fs = await import("node:fs");
        const os = await import("node:os");
        const path = await import("node:path");
        const waitPath = path.join(os.tmpdir(), "relaygent-wait-until.json");
        if (fs.existsSync(waitPath)) {
          return text(
            "Error: wait_for_user already active this turn — a second call would overwrite the earlier deadline. " +
            "Finish your turn now to enter the wait state, then call wait_for_user again on wake."
          );
        }
        try {
          const wake_at = Date.now() + mins * 60 * 1000;
          fs.writeFileSync(waitPath, JSON.stringify({ wake_at, max_minutes: mins }));
        } catch (e) { /* best effort */ }
        return text(
          `wait_for_user activated (up to ${mins} min). The relay harness waits zero-cost ` +
          `until a notification arrives OR until the timeout, whichever first. If you wake on ` +
          `timeout, call get_next_task() to pick up backlog work. Finish your turn now to enter the wait state.`
        );
      }
      case "sleep": {
        return text(
          "Sleep activated (DEPRECATED — use wait_for_user with a max_minutes timeout instead). " +
          "The harness will wake you via session resume when a notification arrives; no timeout, " +
          "so if nothing pings you this session will idle indefinitely. Finish your turn now."
        );
      }
      case "get_next_task": {
        try {
          const task = await pickNextTask();
          if (task) {
            return text(
              `Task from ${task.source}: ${task.description}\n` +
              (task.suggested_next_step ? `Suggested next step: ${task.suggested_next_step}\n` : "") +
              `(Backlog priority: tasks.md > HANDOFF open threads > projects.md > curiosities.md > groom)`
            );
          }
          return text("All backlog sources empty. Task: groom the backlog — add items to ~/knowledge/topics/{tasks,projects,curiosities}.md.");
        } catch (e) {
          return text(`get_next_task failed: ${e.message}`);
        }
      }
      case "retire": {
        return text(
          "Retire requested. After your turn ends, the harness will commit KB changes " +
          "and spawn a fresh successor session that reads your HANDOFF.md. Make sure " +
          "HANDOFF.md is already written before finishing your turn."
        );
      }
      default:
        return text(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
