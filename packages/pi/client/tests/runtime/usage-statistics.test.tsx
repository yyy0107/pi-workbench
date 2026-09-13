import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { UsageStatisticsValue } from "@workbench/agent-runtime-pi-protocol/rpc";
import { usePiUsageStatisticsClient } from "../../src/public/usage-statistics";
import { PiSessionManagerProvider } from "../../src/runtime/context";
import { PiSessionManager } from "../../src/runtime/manager";

function mountedClient(manager: PiSessionManager) {
  let client!: ReturnType<typeof usePiUsageStatisticsClient>;
  function Probe() {
    client = usePiUsageStatisticsClient();
    return null;
  }
  renderToStaticMarkup(
    <PiSessionManagerProvider manager={manager}>
      <Probe />
    </PiSessionManagerProvider>,
  );
  return client;
}

test("reopening statistics immediately reuses its runtime snapshot while refresh stays authoritative", async (t) => {
  let reads = 0;
  let fail = false;
  let totalTokens = 100;
  const manager = new PiSessionManager({
    transport: {
      http: async (_path, init) => {
        reads++;
        if (fail) throw new Error("offline");
        const request = JSON.parse(String(init?.body));
        assert.equal(request.method, "usage.statistics");
        return Response.json({
          type: "server-response",
          rpcId: request.rpcId,
          result: {
            ok: true,
            value: {
              generatedAt: "2026-09-06T12:00:00Z",
              today: "2026-09-06",
              timeZone: request.payload.timeZone,
              totalTokens,
              peakDailyTokens: totalTokens,
              longestChatMs: 0,
              currentStreak: 0,
              longestStreak: 0,
              days: [],
            } satisfies UsageStatisticsValue,
          },
        });
      },
    },
  });
  const otherManager = new PiSessionManager();
  t.after(() => {
    manager.dispose();
    otherManager.dispose();
  });
  const initial = mountedClient(manager);
  assert.equal(initial.getSnapshot("UTC"), undefined);
  const value = await initial.read("UTC", new AbortController().signal);
  const reopened = mountedClient(manager);
  assert.equal(reopened.getSnapshot("UTC"), value);
  assert.equal(reads, 1, "reading the cached snapshot must not wait for another request");
  assert.equal(mountedClient(otherManager).getSnapshot("UTC"), undefined);
  assert.equal(reopened.getSnapshot("America/Los_Angeles"), undefined);
  totalTokens = 200;
  await reopened.read("UTC", new AbortController().signal);
  assert.equal(mountedClient(manager).getSnapshot("UTC")!.totalTokens, 200);
  fail = true;
  await assert.rejects(reopened.read("UTC", new AbortController().signal));
  assert.equal(
    reopened.getSnapshot("UTC")!.totalTokens,
    200,
    "failed refresh keeps the last snapshot",
  );
});

test("publishes the persisted snapshot before reconciliation finishes and keeps it on refresh failure", async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requests: unknown[] = [];
  const manager = new PiSessionManager({
    transport: {
      http: async (_path, init) => {
        const request = JSON.parse(String(init?.body));
        requests.push(request.payload);
        if (!request.payload.preferCached) {
          await gate;
          throw new Error("offline");
        }
        return Response.json({
          type: "server-response",
          rpcId: request.rpcId,
          result: {
            ok: true,
            value: {
              generatedAt: "2026-09-06T12:00:00Z",
              today: "2026-09-06",
              timeZone: "UTC",
              totalTokens: 100,
              peakDailyTokens: 100,
              longestChatMs: 0,
              currentStreak: 1,
              longestStreak: 1,
              days: [],
            } satisfies UsageStatisticsValue,
          },
        });
      },
    },
  });
  t.after(() => manager.dispose());
  const client = mountedClient(manager);
  let publish!: (value: UsageStatisticsValue) => void;
  const published = new Promise<UsageStatisticsValue>((resolve) => {
    publish = resolve;
  });
  const pending = client.read("UTC", new AbortController().signal, publish);
  assert.equal((await published).totalTokens, 100);
  assert.equal(client.getSnapshot("UTC")!.totalTokens, 100);
  release();
  await assert.rejects(pending, /offline/);
  assert.deepEqual(requests, [{ timeZone: "UTC", preferCached: true }, { timeZone: "UTC" }]);
  assert.equal(client.getSnapshot("UTC")!.totalTokens, 100);
});
