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

test("permanently disposes and evicts a deleted client session", async (t) => {
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
  let disposalNotifications = 0;
  cached.subscribe(() => {
    disposalNotifications += 1;
  });

  const internals = manager as unknown as {
    sessions: Map<string, unknown>;
    aliases: Map<string, string>;
  };
  const connectionInternals = manager.connections as unknown as {
    sessions: Map<string, unknown>;
    sessionWatermarks: Map<string, number>;
    sessionMessageAccumulators: Map<string, unknown>;
    endedSessionMessageStreams: Map<string, string>;
  };
  connectionInternals.sessionWatermarks.set("remote-session", 42);
  connectionInternals.sessionMessageAccumulators.set("remote-session", {});
  connectionInternals.endedSessionMessageStreams.set("remote-session", "stream-1");

  await manager.createThreadListAdapter().delete("remote-session");

  assert.equal(internals.sessions.size, 0);
  assert.equal(internals.aliases.size, 0);
  assert.equal(connectionInternals.sessions.has("remote-session"), false);
  assert.equal(connectionInternals.sessionWatermarks.has("remote-session"), false);
  assert.equal(connectionInternals.sessionMessageAccumulators.has("remote-session"), false);
  assert.equal(connectionInternals.endedSessionMessageStreams.has("remote-session"), false);
  assert.equal(disposalNotifications, 1);
  assert.deepEqual(cached.getSnapshot().messages, []);
  assert.deepEqual(cached.queueAdapter.items, []);

  const recreated = manager.getSession("local-session", "remote-session");
  assert.notStrictEqual(recreated, cached);
});

test("manager disposal releases every cached session and alias", () => {
  const manager = new PiSessionManager();
  const session = manager.getSession("local-session", "remote-session");
  const internals = manager as unknown as {
    sessions: Map<string, unknown>;
    aliases: Map<string, string>;
    pendingQueues: Map<string, unknown>;
  };
  internals.aliases.set("local-session", "remote-session");

  manager.dispose();

  assert.equal(internals.sessions.size, 0);
  assert.equal(internals.aliases.size, 0);
  assert.equal(internals.pendingQueues.size, 0);
  assert.deepEqual(session.getSnapshot().messages, []);
  assert.throws(() => manager.getSession("another-local", "another-remote"), /disposed/);
});

test("projects current messages once for each published snapshot", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("local-session", "remote-session");
  const internals = session as unknown as {
    currentMessages(): ReturnType<typeof session.getSnapshot>["messages"];
    publishMessages(): void;
  };
  const project = internals.currentMessages.bind(session);
  let projectionCount = 0;
  internals.currentMessages = () => {
    projectionCount += 1;
    return project();
  };

  internals.publishMessages();

  assert.equal(projectionCount, 1);
});
