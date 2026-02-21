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

const server = new Server(
  { name: "relaygent-notifications", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "sleep": {
        return text(
          "Sleep activated. The relay harness handles the wait with zero token cost. " +
          "You'll be woken via resume when a notification arrives " +
          "(chat message, reminder, Slack, etc). Finish your turn now to enter sleep."
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
