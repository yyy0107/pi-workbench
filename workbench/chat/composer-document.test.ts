import assert from "node:assert/strict";
import test from "node:test";

import type { ComposerCommandDefinition, ComposerCommandRegistry } from "@/platform/extensions";
import {
  COMPOSER_CONVERSATION_MENTION_TYPE,
  COMPOSER_WORKSPACE_FILE_MENTION_TYPE,
} from "@/contracts/composer";

import {
  applyComposerCommandArguments,
  AGENT_COMMAND_DIRECTIVE_TYPE,
  AGENT_PROJECT_SKILL_DIRECTIVE_TYPE,
  AGENT_USER_SKILL_DIRECTIVE_TYPE,
  compileComposerDocument,
  composerCommandArgumentKey,
  composerDocumentSourceText,
  composerDocumentText,
  composerWorkspaceFileMentionId,
  parseComposerDocument,
  WORKBENCH_COMMAND_DIRECTIVE_TYPE,
  workbenchComposerDirectiveFormatter,
} from "./composer-document";
import {
  compiledComposerTextFromRunConfig,
  composerDocumentMatchesCommands,
  parseWorkbenchComposerSubmission,
  WORKBENCH_COMPOSER_RUN_CONFIG_KEY,
} from "@/runtime/shared/composer/request";

function registry(
  definitions: readonly ComposerCommandDefinition[],
): Pick<ComposerCommandRegistry, "get"> {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  return { get: (id) => byId.get(id) };
}

function definition(
  id: string,
  behavior: ComposerCommandDefinition["composer"]["behavior"],
  apply: ComposerCommandDefinition["composer"]["apply"],
  group?: string,
): ComposerCommandDefinition {
  return {
    id,
    label: id,
    composer: { behavior, ...(group ? { group } : {}), apply },
  };
}

function encodeResourceLinkComponent(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

test("formatter round-trips Workbench and Agent directives without parsing ordinary text", () => {
  const workbench = workbenchComposerDirectiveFormatter.serialize({
    id: "review:1",
    type: WORKBENCH_COMMAND_DIRECTIVE_TYPE,
    label: "Review ] safely",
  });
  const agent = workbenchComposerDirectiveFormatter.serialize({
    id: "create-skill",
    type: AGENT_COMMAND_DIRECTIVE_TYPE,
    label: "Create Skill",
  });
  const text = `before ${workbench} middle ${agent} after :other[value]`;

  assert.equal(workbench, "[$Review \\] safely](command://workbench/review%3A1)");
  assert.equal(agent, "[$Create Skill](command://agent/create-skill)");

  assert.deepEqual(workbenchComposerDirectiveFormatter.parse(text), [
    { kind: "text", text: "before " },
    {
      kind: "mention",
      type: WORKBENCH_COMMAND_DIRECTIVE_TYPE,
      id: "review:1",
      label: "Review ] safely",
    },
    { kind: "text", text: " middle " },
    {
      kind: "mention",
      type: AGENT_COMMAND_DIRECTIVE_TYPE,
      id: "create-skill",
      label: "Create Skill",
    },
    { kind: "text", text: " after :other[value]" },
  ]);
});

test("conversation mentions round-trip as durable links and compile into reference context", () => {
  const conversation = workbenchComposerDirectiveFormatter.serialize({
    id: "session/roadmap",
    type: COMPOSER_CONVERSATION_MENTION_TYPE,
    label: "Roadmap ] review",
  });
  const sourceText = `${conversation} compare the decisions`;
  const document = parseComposerDocument(sourceText);

  assert.equal(conversation, "[@Roadmap \\] review](conversation://session%2Froadmap)");
  assert.deepEqual(document, [
    {
      type: "mention",
      id: "mention:conversation:session/roadmap:0",
      mentionType: COMPOSER_CONVERSATION_MENTION_TYPE,
      value: "session/roadmap",
      label: "Roadmap ] review",
    },
    { type: "text", text: " compare the decisions" },
  ]);

  const result = compileComposerDocument(document, registry([]));
  assert.equal(result.sourceText, sourceText);
  assert.equal(result.text, "@Roadmap ] review compare the decisions");
  assert.deepEqual(result.context, [
    {
      type: "workbench.conversation",
      value: {
        version: 1,
        conversationId: "session/roadmap",
        title: "Roadmap ] review",
      },
    },
  ]);
  assert.deepEqual(result.commands, []);
});

test("compiler de-duplicates repeated conversation reference context", () => {
  const conversation = workbenchComposerDirectiveFormatter.serialize({
    id: "session-1",
    type: COMPOSER_CONVERSATION_MENTION_TYPE,
    label: "Release review",
  });
  const result = compileComposerDocument(
    parseComposerDocument(`${conversation} compare ${conversation}`),
    registry([]),
  );

  assert.equal(result.context.length, 1);
});

test("workspace file mentions round-trip and compile into deduplicated reference context", () => {
  const id = composerWorkspaceFileMentionId({
    workspaceId: "workspace-1",
    relativePath: "src/app.ts",
  });
  const file = workbenchComposerDirectiveFormatter.serialize({
    id,
    type: COMPOSER_WORKSPACE_FILE_MENTION_TYPE,
    label: "src/app.ts",
  });
  const sourceText = `${file} review this file ${file}`;
  const document = parseComposerDocument(sourceText);

  assert.equal(
    file,
    "[@src/app.ts](workspace-file://%5B%22workspace-1%22%2C%22src%2Fapp.ts%22%5D)",
  );
  assert.equal(document.filter((node) => node.type === "mention").length, 2);
  assert.equal(composerDocumentSourceText(document), sourceText);

  const result = compileComposerDocument(document, registry([]));
  assert.equal(result.text, "@src/app.ts review this file @src/app.ts");
  assert.deepEqual(result.context, [
    {
      type: "workbench.workspace-file",
      value: {
        version: 1,
        workspaceId: "workspace-1",
        relativePath: "src/app.ts",
        name: "src/app.ts",
      },
    },
  ]);
});

test("parser decodes and normalizes a legacy persisted localized Pi command", () => {
  const document = parseComposerDocument(
    ":pi-command[compact|%E5%8E%8B%E7%BC%A9%E4%B8%8A%E4%B8%8B%E6%96%87]",
  );
  const [command] = document;

  assert.deepEqual(command, {
    type: "command",
    id: "command:agent:compact:0",
    commandId: "compact",
    label: "压缩上下文",
    scope: "message",
    source: "agent",
  });
  assert.equal(composerDocumentSourceText(document), "[$压缩上下文](command://agent/compact)");
});

test("canonical command links round-trip safe structured arguments", () => {
  const args = {
    customInstructions: "Keep decisions (including constraints)",
    retries: 2,
  };
  const encodedArgs = encodeResourceLinkComponent(JSON.stringify(args));
  const sourceText = `[$Compact](command://agent/compact?args=${encodedArgs}) continue`;

  const document = parseComposerDocument(sourceText);
  assert.deepEqual(document, [
    {
      type: "command",
      id: "command:agent:compact:0",
      commandId: "compact",
      label: "Compact",
      scope: "message",
      source: "agent",
      args,
    },
    { type: "text", text: " continue" },
  ]);
  assert.equal(composerDocumentSourceText(document), sourceText);
  assert.deepEqual(parseComposerDocument("[$Compact](command://agent/compact?args=%7Bbad)"), [
    { type: "text", text: "[$Compact](command://agent/compact?args=%7Bbad)" },
  ]);
});

test("formatter persists explicitly selected Skills as canonical skill links", () => {
  const projectSkill = workbenchComposerDirectiveFormatter.serialize({
    id: "skill:mcp-scripting",
    type: AGENT_PROJECT_SKILL_DIRECTIVE_TYPE,
    label: "Mcp Scripting",
  });
  const userSkill = workbenchComposerDirectiveFormatter.serialize({
    id: "skill:personal-notes",
    type: AGENT_USER_SKILL_DIRECTIVE_TYPE,
    label: "Personal Notes",
  });

  assert.equal(projectSkill, "[$Mcp Scripting](skill://project/mcp-scripting)");
  assert.equal(userSkill, "[$Personal Notes](skill://user/personal-notes)");
  assert.deepEqual(workbenchComposerDirectiveFormatter.parse(`${projectSkill} ${userSkill}`), [
    {
      kind: "mention",
      type: AGENT_PROJECT_SKILL_DIRECTIVE_TYPE,
      id: "skill:mcp-scripting",
      label: "Mcp Scripting",
    },
    { kind: "text", text: " " },
    {
      kind: "mention",
      type: AGENT_USER_SKILL_DIRECTIVE_TYPE,
      id: "skill:personal-notes",
      label: "Personal Notes",
    },
  ]);
});

test("compiler upgrades legacy Skill directives to canonical skill links", () => {
  const emptyRegistry = registry([]);
  const document = parseComposerDocument(
    ":pi-command[skill%3Amcp-scripting|Mcp%20Scripting] 怎么使用",
    emptyRegistry,
  );
  const result = compileComposerDocument(document, emptyRegistry, [
    {
      invocationName: "skill:mcp-scripting",
      kind: "skill",
      source: { scope: "project" },
      exclusive: false,
    },
  ]);

  assert.equal(result.sourceText, "[$Mcp Scripting](skill://project/mcp-scripting) 怎么使用");
  assert.equal(result.text, "怎么使用");
  assert.deepEqual(
    result.commands.map((command) => command.commandId),
    ["skill:mcp-scripting"],
  );
});

test("parser creates structural nodes and strips one token buffer from request text", () => {
  const token = workbenchComposerDirectiveFormatter.serialize({
    id: "plan",
    type: WORKBENCH_COMMAND_DIRECTIVE_TYPE,
    label: "Plan",
  });
  const document = parseComposerDocument(`${token} analyze ${token} again`);

  assert.equal(document.filter((node) => node.type === "command").length, 2);
  assert.equal(composerDocumentText(document), "analyze again");
});

test("compiler applies grouped modifiers once with the last command winning", () => {
  const commands = [
    definition(
      "plan",
      "modifier",
      (draft) => {
        draft.mode = "plan";
      },
      "agent-mode",
    ),
    definition(
      "execute",
      "modifier",
      (draft) => {
        draft.mode = "execute";
      },
      "agent-mode",
    ),
  ];
  const plan = workbenchComposerDirectiveFormatter.serialize({
    id: "plan",
    type: WORKBENCH_COMMAND_DIRECTIVE_TYPE,
    label: "Plan",
  });
  const execute = workbenchComposerDirectiveFormatter.serialize({
    id: "execute",
    type: WORKBENCH_COMMAND_DIRECTIVE_TYPE,
    label: "Execute",
  });

  const result = compileComposerDocument(
    parseComposerDocument(`${plan} inspect ${execute} now`, registry(commands)),
    registry(commands),
  );

  assert.equal(result.text, "inspect now");
  assert.equal(result.mode, "execute");
  assert.deepEqual(
    result.commands.map((command) => command.commandId),
    ["execute"],
  );
  assert.deepEqual(
    result.document
      .filter((node) => node.type === "command")
      .map((node) => ({ commandId: node.commandId, inactive: node.inactive })),
    [
      { commandId: "plan", inactive: true },
      { commandId: "execute", inactive: undefined },
    ],
  );
  assert.equal(composerDocumentMatchesCommands(result), true);
  assert.deepEqual(parseWorkbenchComposerSubmission(result), result);
});

test("compiler keeps repeated modifier chips while projecting only the last command", () => {
  const planDefinition = definition("plan", "modifier", (draft) => {
    draft.mode = "plan";
  });
  const plan = workbenchComposerDirectiveFormatter.serialize({
    id: "plan",
    type: WORKBENCH_COMMAND_DIRECTIVE_TYPE,
    label: "Plan",
  });
  const planRegistry = registry([planDefinition]);

  const result = compileComposerDocument(
    parseComposerDocument(`${plan} inspect ${plan} carefully`, planRegistry),
    planRegistry,
  );

  assert.equal(result.document.filter((node) => node.type === "command").length, 2);
  assert.deepEqual(
    result.document.filter((node) => node.type === "command").map((node) => node.inactive),
    [true, undefined],
  );
  assert.deepEqual(
    result.commands.map((command) => command.commandId),
    ["plan"],
  );
  assert.equal(composerDocumentMatchesCommands(result), true);
  assert.deepEqual(parseWorkbenchComposerSubmission(result), result);
});

test("compiler accumulates context commands and preserves transform order", () => {
  const commands = [
    definition("file", "context", (draft, { command }) => {
      draft.context.push({ type: "file", value: command.label });
    }),
    definition("uppercase", "transform", (draft) => {
      draft.text = draft.text.toUpperCase();
    }),
  ];
  const file = workbenchComposerDirectiveFormatter.serialize({
    id: "file",
    type: WORKBENCH_COMMAND_DIRECTIVE_TYPE,
    label: "src/app.tsx",
  });
  const upper = workbenchComposerDirectiveFormatter.serialize({
    id: "uppercase",
    type: WORKBENCH_COMMAND_DIRECTIVE_TYPE,
    label: "Uppercase",
  });

  const result = compileComposerDocument(
    parseComposerDocument(`${file} check ${file} then ${upper}`, registry(commands)),
    registry(commands),
  );

  assert.equal(result.text, "CHECK THEN ");
  assert.deepEqual(result.context, [
    { type: "file", value: "src/app.tsx" },
    { type: "file", value: "src/app.tsx" },
  ]);
});

test("Agent commands remain structured and do not rewrite the user request text", () => {
  const agent = workbenchComposerDirectiveFormatter.serialize({
    id: "create-skill",
    type: AGENT_COMMAND_DIRECTIVE_TYPE,
    label: "Create Skill",
  });
  const emptyRegistry = registry([]);

  const result = compileComposerDocument(
    parseComposerDocument(`${agent} describe the skill`, emptyRegistry),
    emptyRegistry,
  );

  assert.equal(result.text, "describe the skill");
  assert.equal(result.sourceText, `${agent} describe the skill`);
  assert.deepEqual(
    result.commands.map((command) => command.commandId),
    ["create-skill"],
  );
});

test("compiled requests round-trip through the runtime parser without contract translation", () => {
  const command = workbenchComposerDirectiveFormatter.serialize({
    id: "create-skill",
    type: AGENT_COMMAND_DIRECTIVE_TYPE,
    label: "Create Skill",
  });
  const emptyRegistry = registry([]);
  const compiled = compileComposerDocument(
    parseComposerDocument(`${command} describe the skill`, emptyRegistry),
    emptyRegistry,
  );

  assert.deepEqual(parseWorkbenchComposerSubmission(compiled), compiled);
});

test("parameter-panel arguments stay structured while following text remains the prompt", () => {
  const compact = workbenchComposerDirectiveFormatter.serialize({
    id: "compact",
    type: AGENT_COMMAND_DIRECTIVE_TYPE,
    label: "压缩上下文",
  });
  const emptyRegistry = registry([]);

  const commandCatalog = [
    {
      invocationName: "compact",
      exclusive: true,
      argsBinding: {
        kind: "message-text" as const,
        field: "customInstructions",
        consumeText: true,
      },
    },
  ];
  const parsed = parseComposerDocument(`${compact} 继续检查测试`, emptyRegistry, commandCatalog);
  const document = applyComposerCommandArguments(parsed, {
    [composerCommandArgumentKey("agent", "compact")]: {
      customInstructions: "帮我压缩这段文本",
    },
  });
  const result = compileComposerDocument(document, emptyRegistry, commandCatalog);

  assert.deepEqual(
    parsed.map((node) => node.type),
    ["command", "text"],
  );
  assert.equal(result.text, "继续检查测试");
  assert.equal(
    result.sourceText,
    `[$压缩上下文](command://agent/compact?args=${encodeResourceLinkComponent(
      JSON.stringify({ customInstructions: "帮我压缩这段文本" }),
    )}) 继续检查测试`,
  );
  assert.deepEqual(result.commands[0]?.args, {
    customInstructions: "帮我压缩这段文本",
  });
  assert.deepEqual(
    result.document.find((node) => node.type === "command")?.args,
    result.commands[0]?.args,
  );
  assert.equal(
    result.document.some((node) => node.type === "command-argument"),
    false,
  );
});

test("an explicit empty parameter object keeps all following text as the prompt", () => {
  const compact = workbenchComposerDirectiveFormatter.serialize({
    id: "compact",
    type: AGENT_COMMAND_DIRECTIVE_TYPE,
    label: "Compact",
  });
  const emptyRegistry = registry([]);
  const commandCatalog = [
    {
      invocationName: "compact",
      exclusive: true,
      argsBinding: {
        kind: "message-text" as const,
        field: "customInstructions",
        consumeText: true,
      },
    },
  ];

  const document = applyComposerCommandArguments(
    parseComposerDocument(`${compact} continue reviewing tests`, emptyRegistry, commandCatalog),
    { [composerCommandArgumentKey("agent", "compact")]: {} },
  );
  const result = compileComposerDocument(document, emptyRegistry, commandCatalog);

  assert.equal(result.text, "continue reviewing tests");
  assert.equal(
    result.sourceText,
    "[$Compact](command://agent/compact?args=%7B%7D) continue reviewing tests",
  );
  assert.deepEqual(result.commands[0]?.args, {});
});

test("legacy submissions without explicit args still bind message text for compatibility", () => {
  const compact = workbenchComposerDirectiveFormatter.serialize({
    id: "compact",
    type: AGENT_COMMAND_DIRECTIVE_TYPE,
    label: "Compact",
  });
  const emptyRegistry = registry([]);
  const commandCatalog = [
    {
      invocationName: "compact",
      exclusive: true,
      argsBinding: {
        kind: "message-text" as const,
        field: "customInstructions",
        consumeText: true,
      },
    },
  ];

  const result = compileComposerDocument(
    parseComposerDocument(`${compact} legacy instructions`, emptyRegistry, commandCatalog),
    emptyRegistry,
    commandCatalog,
  );

  assert.deepEqual(result.commands[0]?.args, { customInstructions: "legacy instructions" });
  assert.equal(result.text, "");
});

test("compiler rejects ambiguous message-text argument ownership", () => {
  const compact = workbenchComposerDirectiveFormatter.serialize({
    id: "compact",
    type: AGENT_COMMAND_DIRECTIVE_TYPE,
    label: "Compact",
  });
  const emptyRegistry = registry([]);

  assert.throws(
    () =>
      compileComposerDocument(
        parseComposerDocument(`${compact} instructions`, emptyRegistry),
        emptyRegistry,
        [
          {
            invocationName: "compact",
            exclusive: false,
            argsBinding: {
              kind: "message-text",
              field: "customInstructions",
              consumeText: true,
            },
          },
        ],
      ),
    /require an exclusive message-level command/,
  );
});

test("compiler preserves multiple Agent commands in document order", () => {
  const first = workbenchComposerDirectiveFormatter.serialize({
    id: "plan",
    type: AGENT_COMMAND_DIRECTIVE_TYPE,
    label: "Plan",
  });
  const second = workbenchComposerDirectiveFormatter.serialize({
    id: "review",
    type: AGENT_COMMAND_DIRECTIVE_TYPE,
    label: "Review",
  });
  const emptyRegistry = registry([]);

  const result = compileComposerDocument(
    parseComposerDocument(`${first} inspect ${second} concurrency`, emptyRegistry),
    emptyRegistry,
  );

  assert.equal(result.text, "inspect concurrency");
  assert.deepEqual(
    result.commands.map((command) => command.commandId),
    ["plan", "review"],
  );
});

test("Agent command companion semantics apply without changing the command source", () => {
  const agent = workbenchComposerDirectiveFormatter.serialize({
    id: "plan",
    type: AGENT_COMMAND_DIRECTIVE_TYPE,
    label: "Plan",
  });
  const commands = [
    definition("plan", "modifier", (draft) => {
      draft.mode = "plan";
    }),
  ];

  const result = compileComposerDocument(
    parseComposerDocument(`${agent} inspect`, registry(commands)),
    registry(commands),
  );

  assert.equal(result.mode, "plan");
  assert.equal(result.commands[0]?.source, "agent");
  assert.equal(result.commands[0]?.commandId, "plan");
});

test("compiled request text is read only from the versioned run config entry", () => {
  assert.equal(
    compiledComposerTextFromRunConfig({
      custom: {
        [WORKBENCH_COMPOSER_RUN_CONFIG_KEY]: { version: 1, text: "compiled" },
      },
    }),
    undefined,
  );
  const sourceText = "plain :pi-command[plan|Plan]";
  assert.equal(
    compiledComposerTextFromRunConfig({
      custom: {
        [WORKBENCH_COMPOSER_RUN_CONFIG_KEY]: {
          version: 1,
          sourceText,
          text: "compiled",
          context: [],
          metadata: {},
          commands: [],
        },
      },
    }),
    "compiled",
  );
  assert.equal(
    compiledComposerTextFromRunConfig({
      custom: {
        [WORKBENCH_COMPOSER_RUN_CONFIG_KEY]: { version: 2, text: "ignored" },
      },
    }),
    undefined,
  );
});
