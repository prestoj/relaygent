/**
 * Relaygent Notifications MCP — tool definitions.
 */

export const tools = [
  {
    name: "wait_for_user",
    description: "Block the session until the user pings OR until max_minutes elapses, whichever comes first. Returns immediately — the relay harness handles the actual wait with zero token cost. When max_minutes elapses without a notification, the harness wakes you with a timeout signal so you can pick up a task from the backlog via get_next_task. Use short max_minutes (5-30) during active conversations; longer (60-480) when the user has signaled they're gone for a while. Finish your turn after calling this to enter the wait state.",
    inputSchema: {
      type: "object",
      properties: {
        max_minutes: {
          type: "integer",
          description: "Max minutes to wait before waking for idle work. 1-480 (8h max).",
          minimum: 1,
          maximum: 480,
        },
      },
      required: ["max_minutes"],
    },
  },
  {
    name: "sleep",
    description: "DEPRECATED — use wait_for_user instead. Kept for backward compatibility.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_next_task",
    description: "Pull the next task from the backlog. Priority order: overdue recurring tasks → in-progress arcs from HANDOFF → active projects → curiosities → groom-the-backlog fallback. Use when wait_for_user times out (or proactively when no user interaction is pending) to work on something useful instead of idling. Returns {id, source, description, suggested_next_step}.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "retire",
    description: "Voluntarily end this session and spawn a fresh successor. Use when you've finished a coherent chunk of work and want a clean slate — the handoff distills the load-bearing bits and the successor picks up without accumulated scroll. IMPORTANT: (1) write your HANDOFF.md and commit KB changes BEFORE calling this; (2) do NOT send any additional text or tool calls after this — the harness checks only your LAST assistant message for the retire tool, so trailing text silently cancels the retire.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];
