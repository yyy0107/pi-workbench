import assert from "node:assert/strict";
import test from "node:test";

import type { ComposerCommandDefinition, ComposerCommandRegistry } from "@/platform/extensions";

import {
  applyComposerCommandArguments,
  compileComposerDocument,
  composerCommandArgumentKey,
  composerDocumentText,
  parseComposerDocument,
  PI_COMMAND_DIRECTIVE_TYPE,
  WORKBENCH_COMMAND_DIRECTIVE_TYPE,
  workbenchComposerDirectiveFormatter,
} from "./composer-document";
import {
  compiledComposerTextFromRunConfig,
  WORKBENCH_COMPOSER_RUN_CONFIG_KEY,
} from "@/runtime/composer-request";

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

test("formatter round-trips Workbench and Pi directives without parsing ordinary text", () => {
  const workbench = workbenchComposerDirectiveFormatter.serialize({
    id: "review:1",
    type: WORKBENCH_COMMAND_DIRECTIVE_TYPE,
    label: "Review ] safely",
  });
  const pi = workbenchComposerDirectiveFormatter.serialize({
    id: "create-skill",
    type: PI_COMMAND_DIRECTIVE_TYPE,
    label: "Create Skill",
  });
  const text = `before ${workbench} middle ${pi} after :other[value]`;

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
      type: PI_COMMAND_DIRECTIVE_TYPE,
      id: "create-skill",
      label: "Create Skill",
    },
    { kind: "text", text: " after :other[value]" },
  ]);
});

test("parser decodes the persisted localized Pi command label used by user bubbles", () => {
  const [command] = parseComposerDocument(
    ":pi-command[compact|%E5%8E%8B%E7%BC%A9%E4%B8%8A%E4%B8%8B%E6%96%87]",
  );

  assert.deepEqual(command, {
    type: "command",
    id: "command:pi:compact:0",
    commandId: "compact",
    label: "压缩上下文",
    scope: "message",
    source: "pi",
  });
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

test("Pi commands remain structured and do not rewrite the user request text", () => {
  const pi = workbenchComposerDirectiveFormatter.serialize({
    id: "create-skill",
    type: PI_COMMAND_DIRECTIVE_TYPE,
    label: "Create Skill",
  });
  const emptyRegistry = registry([]);

  const result = compileComposerDocument(
    parseComposerDocument(`${pi} describe the skill`, emptyRegistry),
    emptyRegistry,
  );

  assert.equal(result.text, "describe the skill");
  assert.equal(result.sourceText, `${pi} describe the skill`);
  assert.deepEqual(
    result.commands.map((command) => command.commandId),
    ["create-skill"],
  );
});

test("parameter-panel arguments stay structured while following text remains the prompt", () => {
  const compact = workbenchComposerDirectiveFormatter.serialize({
    id: "compact",
    type: PI_COMMAND_DIRECTIVE_TYPE,
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
    [composerCommandArgumentKey("pi", "compact")]: {
      customInstructions: "帮我压缩这段文本",
    },
  });
  const result = compileComposerDocument(document, emptyRegistry, commandCatalog);

  assert.deepEqual(
    parsed.map((node) => node.type),
    ["command", "text"],
  );
  assert.equal(result.text, "继续检查测试");
  assert.equal(result.sourceText, `${compact} 继续检查测试`);
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
    type: PI_COMMAND_DIRECTIVE_TYPE,
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
    { [composerCommandArgumentKey("pi", "compact")]: {} },
  );
  const result = compileComposerDocument(document, emptyRegistry, commandCatalog);

  assert.equal(result.text, "continue reviewing tests");
  assert.equal(result.sourceText, `${compact} continue reviewing tests`);
  assert.deepEqual(result.commands[0]?.args, {});
});

test("legacy submissions without explicit args still bind message text for compatibility", () => {
  const compact = workbenchComposerDirectiveFormatter.serialize({
    id: "compact",
    type: PI_COMMAND_DIRECTIVE_TYPE,
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
    type: PI_COMMAND_DIRECTIVE_TYPE,
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

test("compiler preserves multiple Pi commands in document order", () => {
  const first = workbenchComposerDirectiveFormatter.serialize({
    id: "plan",
    type: PI_COMMAND_DIRECTIVE_TYPE,
    label: "Plan",
  });
  const second = workbenchComposerDirectiveFormatter.serialize({
    id: "review",
    type: PI_COMMAND_DIRECTIVE_TYPE,
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

test("Pi command companion semantics apply without changing the command source", () => {
  const pi = workbenchComposerDirectiveFormatter.serialize({
    id: "plan",
    type: PI_COMMAND_DIRECTIVE_TYPE,
    label: "Plan",
  });
  const commands = [
    definition("plan", "modifier", (draft) => {
      draft.mode = "plan";
    }),
  ];

  const result = compileComposerDocument(
    parseComposerDocument(`${pi} inspect`, registry(commands)),
    registry(commands),
  );

  assert.equal(result.mode, "plan");
  assert.equal(result.commands[0]?.source, "pi");
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
