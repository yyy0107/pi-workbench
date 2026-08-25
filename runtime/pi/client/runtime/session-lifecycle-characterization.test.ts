import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { before } from "node:test";

let PiSessionManager: typeof import("./manager").PiSessionManager;

before(async () => {
  const moduleHooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith("@/")) {
        return nextResolve(
          new URL(`../../../../${specifier.slice(2)}.ts`, import.meta.url).href,
          context,
        );
      }
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
  ({ PiSessionManager } = (await import(
    new URL("./manager.ts", import.meta.url).href
  )) as typeof import("./manager"));
  moduleHooks.deregister();
});

test("characterizes deleted sessions remaining addressable through the client cache", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { rpcId: string; method: string };
    assert.equal(request.method, "session.delete");
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: { ok: true, value: { deleted: true } },
    });
  };

  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const cached = manager.getSession("local-session", "remote-session");

  await manager.createThreadListAdapter().delete("remote-session");

  // Known current behavior: metadata deletion does not evict either cache key.
  assert.strictEqual(manager.getSession("local-session", "remote-session"), cached);
  const internals = manager as unknown as { sessions: Map<string, unknown> };
  assert.equal(internals.sessions.get("local-session"), cached);
  assert.equal(internals.sessions.get("remote-session"), cached);
});

test("characterizes manager disposal leaving cached session objects retained", () => {
  const manager = new PiSessionManager();
  manager.getSession("local-session", "remote-session");
  const internals = manager as unknown as { sessions: Map<string, unknown> };

  manager.dispose();

  // Known current behavior: dispose closes transport state but does not clear session instances.
  assert.equal(internals.sessions.size, 2);
});
