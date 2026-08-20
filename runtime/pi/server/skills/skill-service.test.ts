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
const { SkillService, SkillServiceError } = (await import(
  new URL("./skill-service.ts", import.meta.url).href
)) as typeof import("./skill-service");
moduleHooks.deregister();

function host(
  skills: Array<{ name: string; description: string; disableModelInvocation: boolean }>,
) {
  return {
    session: {
      resourceLoader: {
        getSkills: () => ({ skills }),
      },
    },
  };
}

test("lists the skills loaded by the target Pi session", async () => {
  const requestedSessionIds: string[] = [];
  const service = new SkillService({
    getSession: async (sessionId) => {
      requestedSessionIds.push(sessionId);
      return host([
        {
          name: "review",
          description: "Review the current changes.",
          disableModelInvocation: false,
        },
        {
          name: "release",
          description: "Prepare a release when explicitly requested.",
          disableModelInvocation: true,
        },
      ]);
    },
  });

  assert.deepEqual(await service.list({ sessionId: "session-1" }), {
    skills: [
      {
        name: "review",
        description: "Review the current changes.",
        modelInvocable: true,
      },
      {
        name: "release",
        description: "Prepare a release when explicitly requested.",
        modelInvocable: false,
      },
    ],
  });
  assert.deepEqual(requestedSessionIds, ["session-1"]);
});

test("translates missing sessions without exposing Pi internals", async () => {
  const service = new SkillService({
    getSession: async () => {
      throw Object.assign(new Error("private storage path"), { code: "pi_session_not_found" });
    },
  });

  await assert.rejects(service.list({ sessionId: "missing" }), (error: unknown) => {
    assert.ok(error instanceof SkillServiceError);
    assert.equal(error.code, "session-not-found");
    assert.deepEqual(error.details, { sessionId: "missing" });
    assert.equal(error.message.includes("private storage path"), false);
    return true;
  });
});

test("maps resource loader failures to a stable internal error", async () => {
  const service = new SkillService({
    getSession: async () => ({
      session: {
        resourceLoader: {
          getSkills() {
            throw new Error("broken skill document");
          },
        },
      },
    }),
  });

  await assert.rejects(service.list({ sessionId: "session-1" }), (error: unknown) => {
    assert.ok(error instanceof SkillServiceError);
    assert.equal(error.code, "internal");
    assert.deepEqual(error.details, {});
    return true;
  });
});
