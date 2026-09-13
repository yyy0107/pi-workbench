import assert from "node:assert/strict";
import test from "node:test";

import {
  type InferRpcValidator,
  rpcArray,
  rpcEnum,
  rpcInteger,
  rpcLiteral,
  rpcNullable,
  rpcObject,
  rpcOptional,
  rpcRecord,
  rpcRefine,
  rpcString,
  rpcUnion,
} from "../src/validation";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Expect<Value extends true> = Value;

test("payload primitives compose and report nested paths", () => {
  const schema = rpcRefine(
    rpcObject({
      mode: rpcEnum(["fast", "safe"]),
      values: rpcArray(rpcInteger({ minimum: 0 }), { minLength: 1, maxLength: 2 }),
      label: rpcOptional(rpcNullable(rpcString({ minLength: 1, trim: true }))),
      metadata: rpcRecord(rpcString()),
      selection: rpcUnion([rpcLiteral("auto"), rpcInteger({ minimum: 1 })]),
    }),
    (value) => value.mode !== "safe" || value.values.length === 1,
    { message: "Safe mode accepts one value", path: ["values"] },
  );

  const valid = schema({
    mode: "fast",
    values: [1, 2],
    label: "  example  ",
    metadata: { source: "test" },
    selection: "auto",
    ignored: true,
  });
  assert.deepEqual(valid, {
    ok: true,
    value: {
      mode: "fast",
      values: [1, 2],
      label: "example",
      metadata: { source: "test" },
      selection: "auto",
    },
  });

  const nestedFailure = schema({
    mode: "fast",
    values: [1, -1],
    metadata: { source: "test" },
    selection: "auto",
  });
  assert.equal(nestedFailure.ok, false);
  if (!nestedFailure.ok) assert.deepEqual(nestedFailure.issues[0]?.path, ["values", 1]);

  const refinementFailure = schema({
    mode: "safe",
    values: [1, 2],
    metadata: {},
    selection: 1,
  });
  assert.equal(refinementFailure.ok, false);
  if (!refinementFailure.ok) assert.deepEqual(refinementFailure.issues[0]?.path, ["values"]);
});

test("required, optional, and nullable fields keep distinct semantics", () => {
  const schema = rpcObject({
    required: rpcString(),
    optional: rpcOptional(rpcString()),
    nullable: rpcNullable(rpcString()),
  });

  assert.deepEqual(schema({ required: "yes", nullable: null }), {
    ok: true,
    value: { required: "yes", nullable: null },
  });

  const missing = schema({});
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.deepEqual(
      missing.issues.map(({ code, path }) => ({ code, path })),
      [
        { code: "invalid_type", path: ["required"] },
        { code: "invalid_type", path: ["nullable"] },
      ],
    );
  }

  const nullOptional = schema({ required: "yes", optional: null, nullable: "value" });
  assert.equal(nullOptional.ok, false);
  if (!nullOptional.ok) assert.deepEqual(nullOptional.issues[0]?.path, ["optional"]);
});

test("issues preserve shape and array traversal order", () => {
  const schema = rpcObject({
    first: rpcString(),
    rows: rpcArray(rpcObject({ name: rpcString(), count: rpcInteger() })),
    last: rpcString(),
  });

  const result = schema({
    first: 1,
    rows: [
      { name: 2, count: 1.5 },
      { name: 3, count: 2.5 },
    ],
    last: 4,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.deepEqual(
      result.issues.map((entry) => entry.path),
      [
        ["first"],
        ["rows", 0, "name"],
        ["rows", 0, "count"],
        ["rows", 1, "name"],
        ["rows", 1, "count"],
        ["last"],
      ],
    );
  }
});

test("object inference keeps required, optional, nullable, and literal output types", () => {
  const schema = rpcObject({
    id: rpcInteger(),
    mode: rpcLiteral("safe"),
    note: rpcOptional(rpcNullable(rpcString())),
  });

  type Output = InferRpcValidator<typeof schema>;
  type Expected = { id: number; mode: "safe" } & { note?: string | null };
  const inferenceHolds: Expect<Equal<Output, Expected>> = true;
  assert.equal(inferenceHolds, true);
});
