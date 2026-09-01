import assert from "node:assert/strict";
import test from "node:test";

import {
  formatAgentCommandLabel,
  parseAgentCommandText,
  removeAgentCommandBuffer,
} from "./agent-command";

const commands = [
  {
    name: "create-subagent",
    invocationName: "create-subagent:2",
  },
] as const;

test("formats Agent command names as readable labels", () => {
  assert.equal(formatAgentCommandLabel("create-subagent"), "Create Subagent");
  assert.equal(formatAgentCommandLabel("openMCPServer"), "Open MCP Server");
  assert.equal(formatAgentCommandLabel("mcp-scripting"), "MCP Scripting");
  assert.equal(formatAgentCommandLabel("json-api"), "JSON API");
});

test("parses collision-safe Agent command invocations and preserves arguments", () => {
  const match = parseAgentCommandText("/create-subagent:2 review this change", commands);

  assert.equal(match?.command.name, "create-subagent");
  assert.equal(match?.argumentsText, "review this change");
  assert.equal(match?.hasSeparator, true);
});

test("preserves a deletable buffer space after a selected command", () => {
  const match = parseAgentCommandText("/create-subagent:2  ", commands);

  assert.equal(match?.argumentsText, " ");
  assert.equal(removeAgentCommandBuffer(match?.argumentsText ?? ""), "");
});

test("removes only the command buffer from rendered arguments", () => {
  assert.equal(removeAgentCommandBuffer("  review this change"), " review this change");
  assert.equal(removeAgentCommandBuffer("review this change"), "review this change");
});

test("does not treat unregistered slash text as an Agent command", () => {
  assert.equal(parseAgentCommandText("/tmp/project", commands), undefined);
});
