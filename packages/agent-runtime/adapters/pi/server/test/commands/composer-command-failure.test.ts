import assert from "node:assert/strict";
import test from "node:test";

import { composerCommandFailureReason } from "../../src/commands/composer-command-failure";

const compact = { commandId: "compact" };

test("classifies actionable compact failures without exposing raw provider errors", () => {
  const cases = [
    [new Error("Nothing to compact (session too small)"), "context-too-small"],
    [new Error("Already compacted"), "already-compacted"],
    [new DOMException("aborted", "AbortError"), "cancelled"],
    [new Error("No model selected."), "model-unavailable"],
    [new Error("No API key found for openai."), "authentication-failed"],
    [new Error("insufficient_quota: billing limit reached"), "quota-exhausted"],
    [Object.assign(new Error("provider rejected request"), { status: 429 }), "rate-limited"],
    [new Error("fetch failed: ENOTFOUND api.example.test"), "network-error"],
    [new Error("request timed out"), "timeout"],
    [Object.assign(new Error("provider error"), { statusCode: 503 }), "provider-unavailable"],
    [
      new Error("First kept entry has no UUID - session may need migration"),
      "session-data-invalid",
    ],
    [new Error("Summarization failed: content filter"), "summary-generation-failed"],
    [new Error("secret provider detail that must not cross the wire"), "unknown"],
  ] as const;

  for (const [error, expected] of cases) {
    assert.equal(composerCommandFailureReason(compact, error), expected);
  }
});

test("uses a resource-specific fallback for reload failures", () => {
  assert.equal(
    composerCommandFailureReason({ commandId: "reload" }, new Error("extension hook failed")),
    "reload-failed",
  );
});
