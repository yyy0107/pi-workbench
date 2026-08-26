import assert from "node:assert/strict";
import test from "node:test";

import type { SessionContextTraceEvent } from "@/runtime/pi/rpc-contracts";

import {
  cacheContextTraceDetail,
  CONTEXT_TRACE_DETAIL_CACHE_LIMIT,
} from "./context-trace-detail-cache";

const readyEvent = {
  schemaVersion: 1,
  traceId: "trace-1",
  sessionId: "session-1",
  activationId: "activation-1",
  seq: 1,
  time: 1,
  kind: "run-start",
  detailBytes: 0,
  truncated: false,
  redacted: false,
  detail: { type: "run-start" },
} satisfies SessionContextTraceEvent;

test("replaces a loading detail with the completed result without duplicating the cache key", () => {
  const loading = cacheContextTraceDetail(new Map(), "trace-1", { status: "loading" });
  const ready = cacheContextTraceDetail(loading, "trace-1", {
    status: "ready",
    event: readyEvent,
  });

  assert.equal(ready.size, 1);
  assert.deepEqual(ready.get("trace-1"), { status: "ready", event: readyEvent });
});

test("keeps the detail cache bounded and treats an updated key as most recent", () => {
  let cache = new Map();
  for (let index = 0; index < CONTEXT_TRACE_DETAIL_CACHE_LIMIT; index += 1) {
    cache = new Map(cacheContextTraceDetail(cache, `trace-${index}`, { status: "loading" }));
  }
  cache = new Map(cacheContextTraceDetail(cache, "trace-0", { status: "evicted" }));
  cache = new Map(cacheContextTraceDetail(cache, "trace-new", { status: "loading" }));

  assert.equal(cache.size, CONTEXT_TRACE_DETAIL_CACHE_LIMIT);
  assert.equal(cache.has("trace-0"), true);
  assert.equal(cache.has("trace-1"), false);
  assert.equal(cache.has("trace-new"), true);
});
