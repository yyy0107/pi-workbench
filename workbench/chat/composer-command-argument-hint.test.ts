import assert from "node:assert/strict";
import test from "node:test";

import { composerCommandArgumentHint } from "./composer-command-argument-hint";

test("preserves an explicit localized argument hint", () => {
  assert.equal(composerCommandArgumentHint({ explicitHint: " [可选压缩指令] " }), "[可选压缩指令]");
});

test("renders optional schema fields in square brackets", () => {
  assert.equal(
    composerCommandArgumentHint({
      argsSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
      },
    }),
    "[query] [limit]",
  );
});

test("distinguishes required and optional schema fields", () => {
  assert.equal(
    composerCommandArgumentHint({
      argsSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
        required: ["query"],
      },
    }),
    "<query> [limit]",
  );
});

test("uses the bound field when a schema omits properties", () => {
  assert.equal(
    composerCommandArgumentHint({
      argsSchema: { type: "object" },
      argsBinding: { kind: "message-text", field: "customInstructions", consumeText: true },
    }),
    "[customInstructions]",
  );
});
