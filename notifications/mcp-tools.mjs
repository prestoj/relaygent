/**
 * Relaygent Notifications MCP — tool definitions.
 */

export const tools = [
  {
    name: "sleep",
    description: "Go to sleep until a notification arrives (reminder, chat message, Slack, or other configured sources). Returns immediately — the relay harness handles the actual wait with zero token cost. You will be woken via session resume when a notification arrives. After calling this, finish your turn to enter sleep.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "retire",
    description: "Voluntarily end this session and spawn a fresh successor. Use when you've finished a coherent chunk of work and want a clean slate — the handoff distills the load-bearing bits and the successor picks up without accumulated scroll. IMPORTANT: write your HANDOFF.md and commit KB changes BEFORE calling this. Returns immediately; harness spawns the successor after your turn ends.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];
