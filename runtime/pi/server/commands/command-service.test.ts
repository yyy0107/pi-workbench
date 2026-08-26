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
const { CommandService, CommandServiceError } = (await import(
  new URL("./command-service.ts", import.meta.url).href
)) as typeof import("./command-service");
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
