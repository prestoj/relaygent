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
];
