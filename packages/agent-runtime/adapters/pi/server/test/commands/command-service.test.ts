import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

import { AgentCommandCatalogError } from "@workbench/agent-runtime-server/commands";

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
const { CommandService, CommandServiceError } = (await import(
  new URL("../../src/commands/command-service.ts", import.meta.url).href
)) as typeof import("../../src/commands/command-service");
moduleHooks.deregister();

test("lists supported built-ins, extensions, prompt templates, and skills", async () => {
  const requestedSessionIds: string[] = [];
  const service = new CommandService({
    getSession: async (sessionId) => {
      requestedSessionIds.push(sessionId);
      return {
        session: {
          extensionRunner: {
            getRegisteredCommands: () => [
              {
                name: "review",
                invocationName: "review:1",
                description: "Review the current changes.",
                sourceInfo: {
                  path: "/private/review.ts",
                  source: "auto",
                  scope: "user" as const,
                  origin: "top-level" as const,
                },
                handler: async () => undefined,
              },
              {
                name: "review",
                invocationName: "review:2",
                sourceInfo: {
                  path: "/private/package/review.ts",
                  source: "npm:@acme/review",
                  scope: "project" as const,
                  origin: "package" as const,
                },
                handler: async () => undefined,
              },
              {
                name: "compact",
                invocationName: "compact",
                description: "Extension collision that the Pi TUI also hides.",
                sourceInfo: {
                  path: "/private/compact.ts",
                  source: "auto",
                  scope: "user" as const,
                  origin: "top-level" as const,
                },
              },
            ],
          },
          promptTemplates: [
            {
              name: "explain",
              description: "Explain a topic.",
              argumentHint: "<topic>",
              sourceInfo: {
                path: "/private/package/prompts/explain.md",
                source: "npm:@acme/prompts",
                scope: "project" as const,
                origin: "package" as const,
              },
            },
            {
              name: "review:1",
              description: "Shadowed by an extension command.",
              sourceInfo: {
                path: "/private/review.md",
                source: "auto",
                scope: "user" as const,
                origin: "top-level" as const,
              },
            },
          ],
          resourceLoader: {
            getSkills: () => ({
              skills: [
                {
                  name: "create-skill",
                  description: "Create or update a skill.",
                  disableModelInvocation: true,
                  sourceInfo: {
                    path: "/private/create-skill/SKILL.md",
                    source: "auto",
                    scope: "user" as const,
                    origin: "top-level" as const,
                  },
                },
              ],
            }),
          },
        },
      };
    },
  });

  assert.deepEqual(await service.list({ sessionId: "session-1" }), {
    commands: [
      {
        kind: "builtin",
        name: "compact",
        invocationName: "compact",
        effect: "session-action",
        exclusive: true,
        description: "Manually compact the session context",
        argumentHint: "[custom instructions]",
        argsSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            customInstructions: { type: "string", maxLength: 32768 },
          },
        },
        argsBinding: {
          kind: "message-text",
          field: "customInstructions",
          consumeText: true,
        },
      },
      {
        kind: "builtin",
        name: "reload",
        invocationName: "reload",
        effect: "session-action",
        exclusive: true,
        description: "Reload extensions, skills, prompts, and context files",
      },
      {
        kind: "extension",
        name: "review",
        invocationName: "review:1",
        effect: "agent-turn",
        exclusive: true,
        description: "Review the current changes.",
        source: "auto",
        scope: "user",
        origin: "top-level",
      },
      {
        kind: "extension",
        name: "review",
        invocationName: "review:2",
        effect: "agent-turn",
        exclusive: true,
        source: "npm:@acme/review",
        scope: "project",
        origin: "package",
      },
      {
        kind: "prompt",
        name: "explain",
        invocationName: "explain",
        effect: "prompt-transform",
        exclusive: false,
        description: "Explain a topic.",
        argumentHint: "<topic>",
        source: "npm:@acme/prompts",
        scope: "project",
        origin: "package",
      },
      {
        kind: "skill",
        name: "create-skill",
        invocationName: "skill:create-skill",
        effect: "instruction",
        exclusive: false,
        description: "Create or update a skill.",
        modelInvocable: false,
        source: "auto",
        scope: "user",
        origin: "top-level",
      },
    ],
  });
  assert.deepEqual(requestedSessionIds, ["session-1"]);
});

test("lists built-ins and scoped skills for a draft conversation without creating a session", async () => {
  const requestedTargets: unknown[] = [];
  let requestedSession = false;
  const service = new CommandService({
    getSession: async () => {
      requestedSession = true;
      throw new Error("Draft command discovery must not create or load a session.");
    },
    getScopedResourceHost: async (target) => {
      requestedTargets.push(target);
      return {
        session: {
          resourceLoader: {
            getSkills: () => ({
              skills: [
                {
                  name: "user-skill",
                  description: "A user-level skill.",
                  disableModelInvocation: false,
                  sourceInfo: {
                    source: "auto",
                    scope: "user" as const,
                    origin: "top-level" as const,
                  },
                },
                {
                  name: "project-skill",
                  description: "A project-level skill.",
                  disableModelInvocation: true,
                  sourceInfo: {
                    source: "auto",
                    scope: "project" as const,
                    origin: "top-level" as const,
                  },
                },
              ],
            }),
          },
        },
      };
    },
  });

  const { commands } = await service.list({
    target: { scope: "project", workspaceId: "workspace-1" },
  });
  const { commands: userCommands } = await service.list({ target: { scope: "user" } });

  assert.equal(requestedSession, false);
  assert.deepEqual(requestedTargets, [
    { scope: "project", workspaceId: "workspace-1" },
    { scope: "user" },
  ]);
  assert.deepEqual(
    commands.map((command) => ({
      kind: command.kind,
      name: command.name,
      invocationName: command.invocationName,
      ...(command.kind === "skill"
        ? { scope: command.scope, modelInvocable: command.modelInvocable }
        : {}),
    })),
    [
      { kind: "builtin", name: "compact", invocationName: "compact" },
      { kind: "builtin", name: "reload", invocationName: "reload" },
      {
        kind: "skill",
        name: "user-skill",
        invocationName: "skill:user-skill",
        scope: "user",
        modelInvocable: true,
      },
      {
        kind: "skill",
        name: "project-skill",
        invocationName: "skill:project-skill",
        scope: "project",
        modelInvocable: false,
      },
    ],
  );
  assert.deepEqual(
    userCommands
      .filter((command) => command.kind === "skill")
      .map((command) => command.invocationName),
    ["skill:user-skill"],
  );
});

test("translates missing sessions without exposing Pi internals", async () => {
  const service = new CommandService({
    getSession: async () => {
      throw Object.assign(new Error("private storage path"), { code: "pi_session_not_found" });
    },
  });

  await assert.rejects(service.list({ sessionId: "missing" }), (error: unknown) => {
    assert.ok(error instanceof CommandServiceError);
    assert.equal(error.code, "session-not-found");
    assert.deepEqual(error.details, { sessionId: "missing" });
    assert.equal(error.message.includes("private storage path"), false);
    return true;
  });
  await assert.rejects(
    service.getCatalog({ kind: "thread", threadId: "missing" }),
    (error: unknown) => {
      assert.ok(error instanceof AgentCommandCatalogError);
      assert.equal(error.code, "thread-not-found");
      assert.equal(error.message.includes("private storage path"), false);
      return true;
    },
  );
});

test("projects the Pi wire catalog through the neutral Agent command capability", async () => {
  const service = new CommandService({
    getScopedResourceHost: async () => ({
      session: {
        resourceLoader: {
          getSkills: () => ({
            skills: [
              {
                name: "review-skill",
                description: "Review the active changes.",
                disableModelInvocation: false,
                sourceInfo: {
                  source: "npm:@acme/review",
                  scope: "project" as const,
                  origin: "package" as const,
                },
              },
            ],
          }),
        },
      },
    }),
  });

  const catalog = await service.getCatalog({ kind: "project", workspaceId: "workspace-1" });
  assert.deepEqual(catalog.at(-1), {
    kind: "skill",
    name: "review-skill",
    invocationName: "skill:review-skill",
    effect: "instruction",
    exclusive: false,
    description: "Review the active changes.",
    modelInvocable: true,
    source: { scope: "project", label: "@acme/review" },
  });
  assert.equal(Object.isFrozen(catalog), true);
  assert.equal(Object.isFrozen(catalog.at(-1)), true);
});

test("maps extension runner failures to a stable internal error", async () => {
  const service = new CommandService({
    getSession: async () => ({
      session: {
        extensionRunner: {
          getRegisteredCommands() {
            throw new Error("broken extension command registry");
          },
        },
        promptTemplates: [],
        resourceLoader: { getSkills: () => ({ skills: [] }) },
      },
    }),
  });

  await assert.rejects(service.list({ sessionId: "session-1" }), (error: unknown) => {
    assert.ok(error instanceof CommandServiceError);
    assert.equal(error.code, "internal");
    assert.deepEqual(error.details, {});
    return true;
  });
});
