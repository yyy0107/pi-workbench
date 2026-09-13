import assert from "node:assert/strict";
import test from "node:test";

import {
  composerDocumentMatchesCommands,
  parseWorkbenchComposerCommandResponseDetails,
  parseWorkbenchComposerResolutionDetails,
  parseWorkbenchComposerSubmission,
  workbenchComposerSubmissionFromRunConfig,
  WORKBENCH_COMPOSER_RUN_CONFIG_KEY,
  type WorkbenchComposerSubmission,
} from "@workbench/contracts/composer/request";

const submission: WorkbenchComposerSubmission = {
  version: 2,
  document: [
    {
      type: "command",
      id: "command:agent:plan:0",
      commandId: "plan",
      label: "Plan",
      scope: "message",
      source: "agent",
    },
    { type: "text", text: " inspect concurrency" },
  ],
  sourceText: ":agent-command[plan|Plan] inspect concurrency",
  text: "inspect concurrency",
  mode: "plan",
  context: [{ type: "file", value: "src/app.tsx" }],
  metadata: { review: true },
  commands: [
    {
      id: "command:agent:plan:0",
      commandId: "plan",
      label: "Plan",
      scope: "message",
      source: "agent",
    },
  ],
};

test("reads only a complete, JSON-safe versioned Composer submission", () => {
  assert.deepEqual(
    workbenchComposerSubmissionFromRunConfig({
      custom: { [WORKBENCH_COMPOSER_RUN_CONFIG_KEY]: submission },
    }),
    submission,
  );
  assert.equal(
    workbenchComposerSubmissionFromRunConfig({
      custom: {
        [WORKBENCH_COMPOSER_RUN_CONFIG_KEY]: { ...submission, metadata: { invalid: Number.NaN } },
      },
    }),
    undefined,
  );
});

test("normalizes a legacy Pi submission at the compatibility boundary", () => {
  const legacy = {
    version: 1,
    document: [
      {
        type: "command",
        id: "command:pi:plan:0",
        commandId: "plan",
        label: "Plan",
        scope: "message",
        source: "pi",
      },
    ],
    sourceText: ":pi-command[plan|Plan]",
    text: "",
    context: [],
    metadata: {},
    commands: [
      {
        id: "command:pi:plan:0",
        commandId: "plan",
        label: "Plan",
        scope: "message",
        source: "pi",
      },
    ],
  };

  assert.deepEqual(
    workbenchComposerSubmissionFromRunConfig({
      custom: { [WORKBENCH_COMPOSER_RUN_CONFIG_KEY]: legacy },
    }),
    {
      ...legacy,
      version: 2,
      document: [{ ...legacy.document[0], source: "agent" }],
      commands: [{ ...legacy.commands[0], source: "agent" }],
    },
  );

  assert.equal(
    parseWorkbenchComposerSubmission({
      ...legacy,
      version: 2,
    }),
    undefined,
    "a current request cannot retain a Pi source",
  );
  assert.equal(
    parseWorkbenchComposerSubmission({
      ...submission,
      version: 1,
    }),
    undefined,
    "a legacy request cannot claim the current Agent source",
  );
});

test("keeps structured command arguments identical in document and command projection", () => {
  const compact: WorkbenchComposerSubmission = {
    version: 2,
    document: [
      {
        type: "command",
        id: "command:agent:compact:0",
        commandId: "compact",
        label: "Compact",
        scope: "message",
        source: "agent",
        args: { customInstructions: "Focus on concurrency" },
      },
      {
        type: "command-argument",
        id: "argument:command:agent:compact:0:customInstructions",
        commandNodeId: "command:agent:compact:0",
        field: "customInstructions",
        text: " Focus on concurrency",
      },
    ],
    sourceText: ":agent-command[compact|Compact] Focus on concurrency",
    text: "",
    context: [],
    metadata: {},
    commands: [
      {
        id: "command:agent:compact:0",
        commandId: "compact",
        label: "Compact",
        scope: "message",
        source: "agent",
        args: { customInstructions: "Focus on concurrency" },
      },
    ],
  };

  assert.equal(composerDocumentMatchesCommands(compact), true);
  assert.equal(
    composerDocumentMatchesCommands({
      ...compact,
      commands: [{ ...compact.commands[0]!, args: { customInstructions: "different" } }],
    }),
    false,
  );
});

test("does not allow an ordinary document command to disappear from its executable projection", () => {
  assert.equal(composerDocumentMatchesCommands({ ...submission, commands: [] }), false);
  const reviewCommand = {
    id: "command:agent:review:1",
    commandId: "review",
    label: "Review",
    scope: "message" as const,
    source: "agent" as const,
  };
  assert.equal(
    composerDocumentMatchesCommands({
      ...submission,
      document: [
        ...submission.document!,
        {
          type: "command",
          ...reviewCommand,
        },
      ],
    }),
    false,
  );
  assert.equal(
    composerDocumentMatchesCommands({
      ...submission,
      document: [
        { type: "command", ...submission.commands[0]!, inactive: true },
        { type: "command", ...reviewCommand },
      ],
      commands: [reviewCommand],
    }),
    true,
  );
});

test("parses a safe built-in command response without accepting raw error fields", () => {
  const response = {
    version: 1,
    submissionId: "submission-1",
    source: "pi",
    commandId: "compact",
    label: "Compact",
    status: "execution-failed",
    args: { customInstructions: "Keep the command arguments" },
  } as const;

  assert.deepEqual(parseWorkbenchComposerCommandResponseDetails(response), {
    ...response,
    version: 2,
    source: "agent",
  });
  assert.deepEqual(
    parseWorkbenchComposerCommandResponseDetails({ ...response, status: "running" }),
    { ...response, version: 2, source: "agent", status: "running" },
  );
  assert.deepEqual(
    parseWorkbenchComposerCommandResponseDetails({
      ...response,
      version: 2,
      source: "agent",
      failureReason: "context-too-small",
    }),
    {
      ...response,
      version: 2,
      source: "agent",
      failureReason: "context-too-small",
    },
  );
  assert.deepEqual(
    parseWorkbenchComposerCommandResponseDetails({
      ...response,
      failureReason: "nothing-to-compact",
    }),
    {
      ...response,
      version: 2,
      source: "agent",
      failureReason: "context-too-small",
    },
  );
  assert.equal(
    parseWorkbenchComposerCommandResponseDetails({
      ...response,
      status: "running",
      failureReason: "context-too-small",
    }),
    undefined,
  );
  assert.equal(
    parseWorkbenchComposerCommandResponseDetails({
      ...response,
      failureReason: "raw-provider-message",
    }),
    undefined,
  );
  assert.equal(
    parseWorkbenchComposerCommandResponseDetails({
      ...response,
      status: "failed",
      error: "Nothing to compact",
    }),
    undefined,
  );
  assert.equal(
    parseWorkbenchComposerCommandResponseDetails({
      ...response,
      args: { customInstructions: Number.NaN },
    }),
    undefined,
  );

  const reloadConfiguration = {
    extensions: ["/project/.pi/extensions/review.ts"],
    skills: ["react"],
    prompts: ["review"],
    contextFiles: ["/project/AGENTS.md"],
  };
  assert.deepEqual(
    parseWorkbenchComposerCommandResponseDetails({
      ...response,
      version: 2,
      source: "agent",
      commandId: "reload",
      status: "success",
      reloadConfiguration,
    }),
    {
      ...response,
      version: 2,
      source: "agent",
      commandId: "reload",
      status: "success",
      reloadConfiguration,
    },
  );
  assert.equal(
    parseWorkbenchComposerCommandResponseDetails({
      ...response,
      version: 2,
      source: "agent",
      commandId: "reload",
      status: "success",
      reloadConfiguration: { ...reloadConfiguration, skills: ["react", 42] },
    }),
    undefined,
  );
});

test("retains only stable failure reasons in durable command traces", () => {
  const details = {
    version: 2,
    submissionId: "submission-1",
    status: "command_error",
    commandTrace: [
      {
        source: "agent",
        commandId: "compact",
        label: "Compact",
        scope: "message",
        effect: "session-action",
        status: "execution-failed",
        failureReason: "context-too-small",
      },
    ],
  } as const;

  assert.deepEqual(parseWorkbenchComposerResolutionDetails(details), details);
  assert.deepEqual(
    parseWorkbenchComposerResolutionDetails({
      ...details,
      commandTrace: [{ ...details.commandTrace[0], failureReason: "nothing-to-compact" }],
    }),
    details,
  );
  assert.equal(
    parseWorkbenchComposerResolutionDetails({
      ...details,
      commandTrace: [{ ...details.commandTrace[0], failureReason: "raw-provider-message" }],
    }),
    undefined,
  );
  assert.equal(
    parseWorkbenchComposerResolutionDetails({
      ...details,
      commandTrace: [
        { ...details.commandTrace[0], status: "success", failureReason: "context-too-small" },
      ],
    }),
    undefined,
  );
});
