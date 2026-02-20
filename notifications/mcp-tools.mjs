/**
 * Relaygent Notifications MCP — tool definitions.
 */

export const tools = [
  {
    name: "sleep",
    description: "Go to sleep until a notification arrives (reminder, chat message, or other configured sources). Returns immediately — the relay harness handles the actual wait with zero token cost. You will be woken via session resume when a notification arrives. After calling this, finish your turn to enter sleep.",
    inputSchema: {
      type: "object",
      properties: {
        max_minutes: {
          type: "number",
          description: "Optional max sleep duration in minutes. Sets a wake reminder so the harness wakes you after this time even if no notification arrives. Omit to sleep indefinitely.",
        },
      },
    },
  },
];
