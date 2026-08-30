import assert from "node:assert/strict";
import test from "node:test";

import type { CommandView } from "@workbench/agent-runtime-pi-protocol/rpc";
import {
  projectPiAgentCommand,
  projectPiAgentCommands,
  resolvePiCommandListPayload,
} from "../../src/assistant-ui/command-catalog";

test("resolves Composer commands from the active session when one exists", () => {
  assert.deepEqual(resolvePiCommandListPayload("session-1", "workspace-1"), {
    sessionId: "session-1",
  });
});

test("resolves draft Composer commands from the selected resource scope", () => {
  assert.deepEqual(resolvePiCommandListPayload(undefined, "workspace-1"), {
    target: { scope: "project", workspaceId: "workspace-1" },
  });
  assert.deepEqual(resolvePiCommandListPayload(undefined, undefined), {
    target: { scope: "user" },
  });
});

test("projects Pi built-ins without leaking Pi source metadata", () => {
  const command: CommandView = {
    kind: "builtin",
    name: "compact",
    invocationName: "compact",
    effect: "session-action",
    exclusive: true,
    description: "Compact the context",
  };

  assert.deepEqual(projectPiAgentCommand(command), command);
});

test("projects Pi resource metadata into the generic nested source", () => {
  const command: CommandView = {
    kind: "skill",
    name: "review",
    invocationName: "skill:review",
    effect: "instruction",
    exclusive: false,
    source: "npm:@example/review-tools",
    scope: "project",
    origin: "package",
    modelInvocable: false,
    argsBinding: { kind: "message-text", field: "request", consumeText: true },
  };

  assert.deepEqual(projectPiAgentCommand(command), {
    kind: "skill",
    name: "review",
    invocationName: "skill:review",
    effect: "instruction",
    exclusive: false,
    source: {
      scope: "project",
      label: "@example/review-tools",
    },
    modelInvocable: false,
    argsBinding: { kind: "message-text", field: "request", consumeText: true },
  });
});

test("freezes the projected catalog and command records", () => {
  const commands = projectPiAgentCommands([
    {
      kind: "prompt",
      name: "plan",
      invocationName: "prompt:plan",
      effect: "prompt-transform",
      exclusive: false,
      source: "auto",
      scope: "user",
      origin: "top-level",
    },
  ]);

  const command = commands[0];
  assert.ok(command && command.kind === "prompt");
  assert.equal(Object.isFrozen(commands), true);
  assert.equal(Object.isFrozen(command), true);
  assert.equal(Object.isFrozen(command.source), true);
});
