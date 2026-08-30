import assert from "node:assert/strict";
import test from "node:test";

import { PiApiError } from "../../src/transport/api";

import {
  createPiSessionCatalogState,
  isPiSessionUnavailable,
  readPiSessionCatalog,
  transitionPiSessionCatalog,
} from "../../src/runtime/session-catalog";

test("classifies only the stable missing-session API error", () => {
  assert.equal(isPiSessionUnavailable(new PiApiError("session-not-found", 404)), true);
  assert.equal(isPiSessionUnavailable(new PiApiError("session-closed", 409)), false);
  assert.equal(isPiSessionUnavailable(new Error("session-not-found")), false);
  assert.equal(isPiSessionUnavailable({ code: "session-not-found" }), false);
});

test("never exposes one session catalog under another session id", () => {
  const empty: readonly string[] = [];
  let state = createPiSessionCatalogState(empty);
  state = transitionPiSessionCatalog(
    state,
    { type: "begin", requestId: 1, sessionId: "session-a" },
    empty,
  );
  state = transitionPiSessionCatalog(
    state,
    { type: "succeed", requestId: 1, sessionId: "session-a", value: ["skill-a"] },
    empty,
  );

  assert.deepEqual(readPiSessionCatalog(state, "session-a", empty), {
    sessionId: "session-a",
    value: ["skill-a"],
    loadState: "ready",
    sessionUnavailable: false,
  });
  assert.deepEqual(readPiSessionCatalog(state, "session-b", empty), {
    sessionId: "session-b",
    value: empty,
    loadState: "loading",
    sessionUnavailable: false,
  });
  assert.deepEqual(readPiSessionCatalog(state, undefined, empty), {
    sessionId: undefined,
    value: empty,
    loadState: "idle",
    sessionUnavailable: false,
  });
});

test("ignores late results and superseded refreshes", () => {
  const empty: readonly string[] = [];
  let state = transitionPiSessionCatalog(
    createPiSessionCatalogState(empty),
    { type: "begin", requestId: 1, sessionId: "session-a" },
    empty,
  );
  state = transitionPiSessionCatalog(
    state,
    { type: "begin", requestId: 2, sessionId: "session-b" },
    empty,
  );
  const loadingB = state;

  state = transitionPiSessionCatalog(
    state,
    { type: "succeed", requestId: 1, sessionId: "session-a", value: ["late-a"] },
    empty,
  );
  assert.equal(state, loadingB);

  state = transitionPiSessionCatalog(
    state,
    { type: "begin", requestId: 3, sessionId: "session-b" },
    empty,
  );
  const refreshedB = state;
  state = transitionPiSessionCatalog(
    state,
    { type: "succeed", requestId: 2, sessionId: "session-b", value: ["stale-b"] },
    empty,
  );
  assert.equal(state, refreshedB);

  state = transitionPiSessionCatalog(
    state,
    { type: "succeed", requestId: 3, sessionId: "session-b", value: ["fresh-b"] },
    empty,
  );
  assert.deepEqual(state.value, ["fresh-b"]);
  assert.equal(state.loadState, "ready");
});
