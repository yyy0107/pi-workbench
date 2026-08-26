import assert from "node:assert/strict";
import test from "node:test";

import { PiApiError } from "../transport/api";

import { piRequestErrorKind } from "./request-error";

test("classifies current session RPC errors", () => {
  assert.equal(piRequestErrorKind(new PiApiError("agent-busy", 200)), "session-busy");
  assert.equal(piRequestErrorKind(new PiApiError("session-not-found", 200)), "session-not-found");
  assert.equal(
    piRequestErrorKind(new PiApiError("workspace-invalid-path", 200)),
    "invalid-workspace",
  );
  assert.equal(piRequestErrorKind(new PiApiError("model-unavailable", 200)), "model-not-available");
});

test("keeps legacy Pi error codes compatible", () => {
  assert.equal(piRequestErrorKind(new PiApiError("pi_session_busy", 409)), "session-busy");
  assert.equal(piRequestErrorKind(new PiApiError("pi_empty_prompt", 400)), "empty-prompt");
  assert.equal(
    piRequestErrorKind(new PiApiError("pi_workspace_not_found", 404)),
    "invalid-workspace",
  );
});

test("leaves unknown and non-Pi errors unclassified", () => {
  assert.equal(piRequestErrorKind(new PiApiError("internal", 200)), undefined);
  assert.equal(piRequestErrorKind(new Error("agent-busy")), undefined);
});
