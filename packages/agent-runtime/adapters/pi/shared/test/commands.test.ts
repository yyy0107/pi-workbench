import assert from "node:assert/strict";
import test from "node:test";

import { projectPiAgentCommand, projectPiAgentCommands } from "../src/commands";

test("projects builtin commands without leaking Pi source metadata", () => {
  assert.deepEqual(
    projectPiAgentCommand({
      kind: "builtin",
      name: "compact",
      invocationName: "compact",
      effect: "session-action",
      exclusive: true,
      description: "Compact context",
    }),
    {
      kind: "builtin",
      name: "compact",
      invocationName: "compact",
      effect: "session-action",
      exclusive: true,
      description: "Compact context",
    },
  );
});

test("projects package command sources to generic display metadata", () => {
  const projected = projectPiAgentCommands([
    {
      kind: "extension",
      name: "review",
      invocationName: "package:review",
      effect: "agent-turn",
      exclusive: true,
      scope: "project",
      origin: "package",
      source: "npm:@example/review",
    },
    {
      kind: "skill",
      name: "planning",
      invocationName: "planning",
      effect: "instruction",
      exclusive: false,
      scope: "user",
      origin: "top-level",
      source: "auto",
      modelInvocable: false,
    },
  ]);

  assert.deepEqual(projected, [
    {
      kind: "extension",
      name: "review",
      invocationName: "package:review",
      effect: "agent-turn",
      exclusive: true,
      source: { scope: "project", label: "@example/review" },
    },
    {
      kind: "skill",
      name: "planning",
      invocationName: "planning",
      effect: "instruction",
      exclusive: false,
      source: { scope: "user" },
      modelInvocable: false,
    },
  ]);
  assert.equal(Object.isFrozen(projected), true);
});
