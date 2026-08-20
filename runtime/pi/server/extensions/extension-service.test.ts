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
const { ExtensionService, ExtensionServiceError } = (await import(
  new URL("./extension-service.ts", import.meta.url).href
)) as typeof import("./extension-service");
moduleHooks.deregister();

function extension(
  path: string,
  options: {
    hidden?: boolean;
    events?: string[];
    tools?: string[];
    commands?: string[];
    source?: string;
    scope?: "user" | "project" | "temporary";
    origin?: "package" | "top-level";
  } = {},
) {
  return {
    path,
    ...(options.hidden === undefined ? {} : { hidden: options.hidden }),
    sourceInfo: {
      source: options.source ?? "auto",
      scope: options.scope ?? "user",
      origin: options.origin ?? "top-level",
    },
    handlers: new Map((options.events ?? []).map((name) => [name, []])),
    tools: new Map((options.tools ?? []).map((name) => [name, {}])),
    commands: new Map((options.commands ?? []).map((name) => [name, {}])),
  };
}

test("lists visible extensions loaded by the target Pi session", async () => {
  const requestedSessionIds: string[] = [];
  const service = new ExtensionService({
    getSession: async (sessionId) => {
      requestedSessionIds.push(sessionId);
      return {
        session: {
          resourceLoader: {
            getExtensions: () => ({
              extensions: [
                extension("/home/user/.pi/agent/extensions/review.ts", {
                  events: ["tool_call", "session_start"],
                  tools: ["review_changes"],
                  commands: ["review"],
                }),
                extension("/workspace/.pi/extensions/git-tools/index.ts", {
                  source: "npm:@acme/git-tools",
                  scope: "project",
                  origin: "package",
                  tools: ["git_status"],
                }),
                extension("<inline:internal>", { hidden: true }),
              ],
              errors: [{ path: "/private/broken.ts", error: "private details" }],
            }),
          },
        },
      };
    },
  });

  assert.deepEqual(await service.list({ sessionId: "session-1" }), {
    extensions: [
      {
        name: "review",
        source: "auto",
        scope: "user",
        origin: "top-level",
        eventNames: ["session_start", "tool_call"],
        toolNames: ["review_changes"],
        commandNames: ["review"],
      },
      {
        name: "git-tools",
        source: "npm:@acme/git-tools",
        scope: "project",
        origin: "package",
        eventNames: [],
        toolNames: ["git_status"],
        commandNames: [],
      },
    ],
    loadErrorCount: 1,
  });
  assert.deepEqual(requestedSessionIds, ["session-1"]);
});

test("translates missing sessions without exposing Pi internals", async () => {
  const service = new ExtensionService({
    getSession: async () => {
      throw Object.assign(new Error("private storage path"), { code: "pi_session_not_found" });
    },
  });

  await assert.rejects(service.list({ sessionId: "missing" }), (error: unknown) => {
    assert.ok(error instanceof ExtensionServiceError);
    assert.equal(error.code, "session-not-found");
    assert.deepEqual(error.details, { sessionId: "missing" });
    assert.equal(error.message.includes("private storage path"), false);
    return true;
  });
});

test("maps resource loader failures to a stable internal error", async () => {
  const service = new ExtensionService({
    getSession: async () => ({
      session: {
        resourceLoader: {
          getExtensions() {
            throw new Error("broken extension module");
          },
        },
      },
    }),
  });

  await assert.rejects(service.list({ sessionId: "session-1" }), (error: unknown) => {
    assert.ok(error instanceof ExtensionServiceError);
    assert.equal(error.code, "internal");
    assert.deepEqual(error.details, {});
    return true;
  });
});
