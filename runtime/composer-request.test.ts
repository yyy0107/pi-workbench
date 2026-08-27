import assert from "node:assert/strict";
import test from "node:test";

import {
  compileWorkbenchComposerPrompt,
  composerDocumentMatchesCommands,
  parseWorkbenchComposerCommandResponseDetails,
  workbenchComposerSubmissionFromRunConfig,
  WORKBENCH_COMPOSER_RUN_CONFIG_KEY,
  type WorkbenchComposerSubmission,
} from "./composer-request";

const submission: WorkbenchComposerSubmission = {
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
    { type: "text", text: " inspect concurrency" },
  ],
  sourceText: ":pi-command[plan|Plan] inspect concurrency",
  text: "inspect concurrency",
  mode: "plan",
  context: [{ type: "file", value: "src/app.tsx" }],
  metadata: { review: true },
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

test("keeps structured command arguments identical in document and command projection", () => {
  const compact: WorkbenchComposerSubmission = {
    version: 1,
    document: [
      {
        type: "command",
        id: "command:pi:compact:0",
        commandId: "compact",
        label: "Compact",
        scope: "message",
        source: "pi",
        args: { customInstructions: "Focus on concurrency" },
      },
      {
        type: "command-argument",
        id: "argument:command:pi:compact:0:customInstructions",
        commandNodeId: "command:pi:compact:0",
        field: "customInstructions",
        text: " Focus on concurrency",
      },
    ],
    sourceText: ":pi-command[compact|Compact] Focus on concurrency",
    text: "",
    context: [],
    metadata: {},
    commands: [
      {
        id: "command:pi:compact:0",
        commandId: "compact",
        label: "Compact",
        scope: "message",
        source: "pi",
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
    id: "command:pi:review:1",
    commandId: "review",
    label: "Review",
    scope: "message" as const,
    source: "pi" as const,
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
  } as const;

  assert.deepEqual(parseWorkbenchComposerCommandResponseDetails(response), response);
  assert.deepEqual(
    parseWorkbenchComposerCommandResponseDetails({ ...response, status: "running" }),
    {
      ...response,
      status: "running",
    },
  );
  assert.equal(
    parseWorkbenchComposerCommandResponseDetails({
      ...response,
      status: "failed",
      error: "Nothing to compact",
    }),
    undefined,
  );
});

test("adapts the resolved request by trust boundary without injecting command trace", () => {
  const prompt = compileWorkbenchComposerPrompt({
    version: 1,
    userText: "inspect concurrency",
    config: { mode: "plan", metadata: { review: true } },
    selectedSkills: [],
    instructions: [
      { source: "workbench:review", trust: "trusted-instruction", content: "Review carefully" },
    ],
    trustedContext: [],
    untrustedContext: [{ source: "file", trust: "untrusted-context", value: "src/app.tsx" }],
    commandTrace: [
      {
        source: "pi",
        commandId: "plan",
        label: "Plan",
        scope: "message",
        effect: "request-config",
        status: "success",
      },
    ],
  });

  assert.match(prompt, /<workbench-request-config>/);
  assert.match(prompt, /<workbench-trusted-instructions>/);
  assert.match(prompt, /<workbench-untrusted-context>/);
  assert.match(prompt, /"mode":"plan"/);
  assert.match(prompt, /"source":"file"/);
  assert.doesNotMatch(prompt, /"commandId":"plan"/);
  assert.match(prompt, /<user-request>\ninspect concurrency\n<\/user-request>$/);
});

test("binds a deictic request to the Skill explicitly selected in Composer", () => {
  const prompt = compileWorkbenchComposerPrompt({
    version: 1,
    userText: "怎么使用这个",
    config: { metadata: {} },
    selectedSkills: [
      {
        invocationName: "skill:mcp-scripting",
        name: "mcp-scripting",
        location: "/skills/mcp-scripting/SKILL.md",
        baseDir: "/skills/mcp-scripting",
        selectedBy: "user",
      },
    ],
    instructions: [],
    trustedContext: [],
    untrustedContext: [],
    commandTrace: [],
  });

  assert.match(prompt, /<workbench-explicit-skill-selection>/);
  assert.match(
    prompt,
    /explicitly selected the following Skills through the Workbench Skill picker/,
  );
  assert.match(prompt, /"location":"\/skills\/mcp-scripting\/SKILL.md"/);
  assert.match(prompt, /Use the read tool to read every selected Skill file completely/);
  assert.match(prompt, /Do not answer from a Skill name or description alone/);
  assert.match(prompt, /"这个"/);
  assert.doesNotMatch(prompt, /<workbench-trusted-instructions>/);
  assert.match(prompt, /<user-request>\n怎么使用这个\n<\/user-request>$/);
});
