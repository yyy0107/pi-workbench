import assert from "node:assert/strict";
import test from "node:test";

import { composerCommandParameterFields } from "./composer-command-parameter-panel";

test("parameter fields put the bound free-text field first and preserve required metadata", () => {
  const fields = composerCommandParameterFields(
    {
      type: "object",
      required: ["format"],
      properties: {
        format: { type: "string", enum: ["brief", "detailed"] },
        customInstructions: { type: "string", maxLength: 32_768 },
      },
    },
    { kind: "message-text", field: "customInstructions", consumeText: true },
  );

  assert.deepEqual(
    fields.map(({ id, required }) => ({ id, required })),
    [
      { id: "customInstructions", required: false },
      { id: "format", required: true },
    ],
  );
});

test("a binding without a properties entry still receives a string editor", () => {
  const [field] = composerCommandParameterFields(
    { type: "object" },
    { kind: "message-text", field: "instructions", consumeText: true },
  );

  assert.equal(field?.id, "instructions");
  assert.deepEqual(field?.schema, { type: "string" });
});
