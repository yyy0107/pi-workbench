import assert from "node:assert/strict";
import test from "node:test";

import {
  composerCommandParameterDefaults,
  composerCommandParameterFields,
  composerCommandParameterIssues,
  withComposerCommandParameterDefaults,
} from "./composer-command-parameters";

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

test("required fields omitted from properties still receive an editor", () => {
  const fields = composerCommandParameterFields({ type: "object", required: ["query"] });

  assert.deepEqual(
    fields.map(({ id, required, schema }) => ({ id, required, schema })),
    [{ id: "query", required: true, schema: { type: "string" } }],
  );
});

test("schema defaults initialize parameters without replacing draft values", () => {
  const schema = {
    type: "object",
    properties: {
      enabled: { type: "boolean", default: false },
      limit: { type: "integer", default: 10 },
    },
  } as const;

  assert.deepEqual(composerCommandParameterDefaults(schema), { enabled: false, limit: 10 });
  assert.deepEqual(withComposerCommandParameterDefaults(schema, undefined, { limit: 25 }), {
    enabled: false,
    limit: 25,
  });
});

test("parameter validation covers required, enum, integer, range, and length constraints", () => {
  const schema = {
    type: "object",
    required: ["query", "format"],
    properties: {
      query: { type: "string", minLength: 3, maxLength: 8 },
      format: { type: "string", enum: ["brief", "detailed"] },
      limit: { type: "integer", minimum: 1, maximum: 20 },
    },
  } as const;

  assert.deepEqual(composerCommandParameterIssues(schema, undefined, { limit: 2.5 }), {
    query: { code: "required" },
    format: { code: "required" },
    limit: { code: "integer" },
  });
  assert.deepEqual(
    composerCommandParameterIssues(schema, undefined, {
      query: "hi",
      format: "unknown",
      limit: 21,
    }),
    {
      query: { code: "minLength", limit: 3 },
      format: { code: "invalidChoice" },
      limit: { code: "maximum", limit: 20 },
    },
  );
  assert.deepEqual(
    composerCommandParameterIssues(schema, undefined, {
      query: "inspect",
      format: "brief",
      limit: 10,
    }),
    {},
  );
});

test("a matching primitive enum is valid even when the schema omits its type", () => {
  const schema = {
    type: "object",
    properties: { priority: { enum: [1, 2, 3] } },
  } as const;

  assert.deepEqual(composerCommandParameterIssues(schema, undefined, { priority: 2 }), {});
  assert.deepEqual(composerCommandParameterIssues(schema, undefined, { priority: 4 }), {
    priority: { code: "invalidChoice" },
  });
});
