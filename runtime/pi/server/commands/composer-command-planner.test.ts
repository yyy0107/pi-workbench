import assert from "node:assert/strict";
import test from "node:test";

import type { WorkbenchComposerCommandSubmission } from "../../../composer-request";
import { preflightPlanWorkbenchComposerCommands } from "./composer-command-planner";

const session = {
  extensionRunner: { getRegisteredCommands: () => [{ invocationName: "review" }] },
  promptTemplates: [
    {
      name: "explain",
      description: "Explain",
      content: "Explain $ARGUMENTS",
      sourceInfo: {},
      filePath: "/prompts/explain.md",
    },
  ],
  resourceLoader: {
    getSkills: () => ({
      skills: [
        {
          name: "react",
          description: "React",
          filePath: "/skills/react/SKILL.md",
          baseDir: "/skills/react",
          sourceInfo: {},
          disableModelInvocation: false,
        },
      ],
    }),
  },
} as unknown as Parameters<typeof preflightPlanWorkbenchComposerCommands>[0];

function command(commandId: string, args?: WorkbenchComposerCommandSubmission["args"]) {
  return {
    id: commandId,
    commandId,
    label: commandId,
    scope: "message" as const,
    source: "pi" as const,
    ...(args === undefined ? {} : { args }),
  };
}

function submission(commands: ReturnType<typeof command>[], text = "request") {
  return {
    version: 1 as const,
    sourceText: "tokens",
    text,
    context: [],
    metadata: {},
    commands,
  };
}

test("classifies deterministic prompt and Skill commands", () => {
  const plans = preflightPlanWorkbenchComposerCommands(
    session,
    submission([command("explain"), command("skill:react")]),
  );
  assert.deepEqual(
    plans.map(({ kind, effect, exclusive }) => ({ kind, effect, exclusive })),
    [
      { kind: "prompt", effect: "prompt-transform", exclusive: false },
      { kind: "skill", effect: "instruction", exclusive: false },
    ],
  );
});

test("accepts canonical and legacy compact arguments while rejecting invalid object shapes", () => {
  const canonical = preflightPlanWorkbenchComposerCommands(
    session,
    submission([command("compact", { customInstructions: "Focus on concurrency changes" })], ""),
  );
  assert.deepEqual(canonical[0]?.command.args, {
    customInstructions: "Focus on concurrency changes",
  });

  assert.doesNotThrow(() =>
    preflightPlanWorkbenchComposerCommands(
      session,
      submission([command("compact", "Focus on errors")], "legacy body"),
    ),
  );
  assert.throws(
    () =>
      preflightPlanWorkbenchComposerCommands(
        session,
        submission([command("compact", { prompt: "ambiguous" })], ""),
      ),
    { code: "pi_composer_command_args_invalid" },
  );
  assert.doesNotThrow(() =>
    preflightPlanWorkbenchComposerCommands(
      session,
      submission([command("compact", { customInstructions: "keep decisions" })], "continue"),
    ),
  );
  assert.throws(
    () =>
      preflightPlanWorkbenchComposerCommands(
        session,
        submission([command("compact", { customInstructions: "x".repeat(32_769) })], ""),
      ),
    { code: "pi_composer_command_args_invalid" },
  );
});

test("rejects lifecycle and extension agent-turn commands mixed with other tokens", () => {
  assert.throws(
    () =>
      preflightPlanWorkbenchComposerCommands(
        session,
        submission([command("reload"), command("skill:react")]),
      ),
    { code: "pi_composer_command_conflict" },
  );
  assert.throws(
    () =>
      preflightPlanWorkbenchComposerCommands(
        session,
        submission([command("review"), command("skill:react")]),
      ),
    { code: "pi_composer_command_conflict" },
  );
});
