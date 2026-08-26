import assert from "node:assert/strict";
import test from "node:test";

import { formatPiCommandLabel, parsePiCommandText, removePiCommandBuffer } from "./pi-command";

const commands = [
  {
    name: "create-subagent",
    invocationName: "create-subagent:2",
  },
] as const;

test("formats Pi command names as readable labels", () => {
  assert.equal(formatPiCommandLabel("create-subagent"), "Create Subagent");
  assert.equal(formatPiCommandLabel("openMCPServer"), "Open MCP Server");
  assert.equal(formatPiCommandLabel("mcp-scripting"), "MCP Scripting");
  assert.equal(formatPiCommandLabel("json-api"), "JSON API");
});

test("parses collision-safe Pi command invocations and preserves arguments", () => {
  const match = parsePiCommandText("/create-subagent:2 review this change", commands);

  assert.equal(match?.command.name, "create-subagent");
  assert.equal(match?.argumentsText, "review this change");
  assert.equal(match?.hasSeparator, true);
});

test("preserves a deletable buffer space after a selected command", () => {
  const match = parsePiCommandText("/create-subagent:2  ", commands);

  assert.equal(match?.argumentsText, " ");
  assert.equal(removePiCommandBuffer(match?.argumentsText ?? ""), "");
});

test("removes only the command buffer from rendered arguments", () => {
  assert.equal(removePiCommandBuffer("  review this change"), " review this change");
  assert.equal(removePiCommandBuffer("review this change"), "review this change");
});

test("does not treat unregistered slash text as a Pi command", () => {
  assert.equal(parsePiCommandText("/tmp/project", commands), undefined);
});
