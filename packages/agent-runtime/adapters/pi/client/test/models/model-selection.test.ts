import assert from "node:assert/strict";
import test from "node:test";
import type { AppendMessage } from "@assistant-ui/react";

const { draftSessionModelSelection } = (await import(
  new URL("../../src/models/model-selection.ts", import.meta.url).href
)) as typeof import("../../src/models/model-selection");

function message(piModel: Record<string, unknown>): AppendMessage {
  return {
    role: "user",
    createdAt: new Date(0),
    parentId: null,
    sourceId: null,
    runConfig: undefined,
    content: [{ type: "text", text: "hello" }],
    metadata: { custom: { piModel } },
  };
}

test("converts a draft composer model into the session.selectModel payload", () => {
  assert.deepEqual(
    draftSessionModelSelection(
      undefined,
      message({ provider: "openai", modelId: "gpt", thinkingLevel: "xhigh" }),
    ),
    { provider: "openai", model: "gpt", reasoningEffort: "xhigh" },
  );
});

test("never applies composer model metadata to an existing remote session", () => {
  assert.equal(
    draftSessionModelSelection(
      "session-1",
      message({ provider: "openai", modelId: "gpt", thinkingLevel: "high" }),
    ),
    undefined,
  );
});

test("omits unknown draft reasoning efforts and rejects malformed selections", () => {
  assert.deepEqual(
    draftSessionModelSelection(
      undefined,
      message({ provider: "openai", modelId: "gpt", thinkingLevel: "ultra" }),
    ),
    { provider: "openai", model: "gpt" },
  );
  assert.equal(draftSessionModelSelection(undefined, message({ provider: "openai" })), undefined);
});
