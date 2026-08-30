import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const moduleHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.startsWith(".") &&
      !/\.[^/]+$/.test(specifier) &&
      context.parentURL?.includes("/runtime/pi/")
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { ASK_USER_TOOL_NAME, createAskUserExtension } =
  await import("../../src/internal-extensions/ask-user");

test.after(() => moduleHooks.deregister());

type Handler = (...args: never[]) => unknown;

function createHarness(initialEnabled: boolean) {
  let enabled = initialEnabled;
  let activeTools = ["read", ASK_USER_TOOL_NAME];
  const preferenceListeners = new Set<(nextEnabled: boolean) => void>();
  const handlers = new Map<string, Handler>();
  let tool:
    | {
        execute(
          toolCallId: string,
          params: { questions: Array<Record<string, unknown>> },
          signal: AbortSignal,
          onUpdate: (result: unknown) => void,
          context: unknown,
        ): Promise<unknown>;
      }
    | undefined;

  createAskUserExtension({
    async readEnabled() {
      return enabled;
    },
    subscribe(listener) {
      preferenceListeners.add(listener);
      return () => preferenceListeners.delete(listener);
    },
  })({
    registerTool(definition: typeof tool) {
      tool = definition;
    },
    on(event: string, handler: Handler) {
      handlers.set(event, handler);
    },
    getActiveTools() {
      return [...activeTools];
    },
    setActiveTools(toolNames: string[]) {
      activeTools = [...toolNames];
    },
  } as never);

  return {
    get activeTools() {
      return activeTools;
    },
    handlers,
    preferenceListeners,
    get tool() {
      assert.ok(tool);
      return tool;
    },
    setEnabled(nextEnabled: boolean) {
      enabled = nextEnabled;
      for (const listener of preferenceListeners) listener(nextEnabled);
    },
  };
}

test("keeps the hidden Ask User tool aligned with the Workbench capability preference", async () => {
  const harness = createHarness(false);

  await harness.handlers.get("session_start")?.();
  assert.deepEqual(harness.activeTools, ["read"]);
  assert.equal(harness.preferenceListeners.size, 1);

  harness.setEnabled(true);
  assert.deepEqual(harness.activeTools, ["read", ASK_USER_TOOL_NAME]);

  harness.setEnabled(false);
  assert.deepEqual(harness.activeTools, ["read"]);

  await harness.handlers.get("session_shutdown")?.();
  assert.equal(harness.preferenceListeners.size, 0);
});

test("routes grouped questions through the Workbench UI and returns normalized answers", async () => {
  const harness = createHarness(true);
  const receivedQuestions: unknown[] = [];

  const result = await harness.tool.execute(
    "tool-call-1",
    {
      questions: [
        {
          id: "scope",
          header: "Scope",
          question: "Which area should change?",
          options: [{ label: "Composer", description: "The message composer", recommended: true }],
          allowCustom: true,
        },
        {
          id: "name",
          question: "What should it be called?",
          required: false,
        },
      ],
    },
    new AbortController().signal,
    () => undefined,
    {
      hasUI: true,
      ui: {
        async workbenchAskUser(questions: unknown[]) {
          receivedQuestions.push(...questions);
          return [
            { id: "scope", selected: ["Composer"], custom: "Keep the change local" },
            { id: "name", selected: [], custom: "Ask User" },
          ];
        },
      },
    },
  );

  assert.deepEqual(receivedQuestions, [
    {
      id: "scope",
      header: "Scope",
      question: "Which area should change?",
      options: [{ label: "Composer", description: "The message composer", recommended: true }],
      allowCustom: true,
      multiSelect: false,
      required: true,
    },
    {
      id: "name",
      question: "What should it be called?",
      multiSelect: false,
      required: false,
    },
  ]);
  assert.deepEqual(result, {
    content: [
      {
        type: "text",
        text: 'The user submitted these answers:\n[\n  {\n    "id": "scope",\n    "selected": [\n      "Composer"\n    ],\n    "custom": "Keep the change local"\n  },\n  {\n    "id": "name",\n    "selected": [],\n    "custom": "Ask User"\n  }\n]',
      },
    ],
    details: {
      questions: receivedQuestions,
      answers: [
        { id: "scope", selected: ["Composer"], custom: "Keep the change local" },
        { id: "name", selected: [], custom: "Ask User" },
      ],
      cancelled: false,
    },
  });
});

test("rejects more than one recommended option in a question", async () => {
  const harness = createHarness(true);

  await assert.rejects(
    harness.tool.execute(
      "tool-call-recommendations",
      {
        questions: [
          {
            id: "scope",
            question: "Which scope?",
            options: [
              { label: "Current task", recommended: true },
              { label: "Whole project", recommended: true },
            ],
          },
        ],
      },
      new AbortController().signal,
      () => undefined,
      { hasUI: true, ui: {} },
    ),
    /cannot recommend more than one option/,
  );
});

test("rejects a single choice unless the user can provide a custom answer", async () => {
  const harness = createHarness(true);

  await assert.rejects(
    harness.tool.execute(
      "tool-call-single-choice",
      {
        questions: [
          {
            id: "concept",
            question: "Which concept should be explained?",
            options: [{ label: "Agent Harness" }],
          },
        ],
      },
      new AbortController().signal,
      () => undefined,
      { hasUI: true, ui: {} },
    ),
    /must provide at least two options or allow a custom answer/,
  );
});

test("declines a stale tool call when the capability was disabled concurrently", async () => {
  const harness = createHarness(false);
  let requested = false;

  const result = (await harness.tool.execute(
    "tool-call-2",
    { questions: [{ id: "confirm", question: "Continue?" }] },
    new AbortController().signal,
    () => undefined,
    {
      hasUI: true,
      ui: {
        async workbenchAskUser() {
          requested = true;
          return [];
        },
      },
    },
  )) as { details: unknown };

  assert.equal(requested, false);
  assert.deepEqual(result.details, {
    questions: [
      {
        id: "confirm",
        question: "Continue?",
        multiSelect: false,
        required: true,
      },
    ],
    answers: [],
    cancelled: true,
    disabled: true,
  });
});
