import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  RUNTIME_HOST_CONTROL_MAX_FRAME_BYTES,
  RUNTIME_HOST_CONTROL_VERSION,
  RUNTIME_HOST_PROTOCOL_VERSION,
  RuntimeHostControlDecodeError,
  RuntimeHostControlNdjsonDecoder,
  encodeRuntimeHostControlInputFrame,
  encodeRuntimeHostControlOutputFrame,
  parseRuntimeHostControlInputFrame,
  parseRuntimeHostControlOutputFrame,
  runtimeHostControlInputErrorCode,
} from "../src/runtime-host-control";

type FixtureDirection = "container-to-host" | "host-to-container" | "framing-only";
type Chunking = "whole" | "one-byte" | { readonly cuts: readonly number[] };

type ByteRecipe =
  | { readonly kind: "utf8"; readonly value: string }
  | { readonly kind: "hex"; readonly value: string }
  | {
      readonly kind: "segments";
      readonly value: readonly (
        | { readonly kind: "hex"; readonly value: string }
        | { readonly kind: "repeat-hex"; readonly value: string; readonly count: number }
      )[];
    };

interface FixtureCase {
  readonly id: string;
  readonly direction: FixtureDirection;
  readonly bytes: ByteRecipe;
  readonly byteLength: number;
  readonly canonicalSerialization?: boolean;
  readonly chunkings: readonly Chunking[];
  readonly expect: {
    readonly ndjson:
      | { readonly kind: "frames"; readonly count: number }
      | {
          readonly kind: "error";
          readonly code: string;
          readonly when: "push" | "finish";
        };
    readonly dto?: { readonly kind: "accept"; readonly type: string } | { readonly kind: "reject" };
    readonly inputErrorCode?: string;
  };
}

interface FixtureDocument {
  readonly fixtureSchemaVersion: number;
  readonly controlVersion: number;
  readonly hostProtocolVersion: number;
  readonly maximumFrameBytes: number;
  readonly cases: readonly FixtureCase[];
  readonly compatibilityExceptions: readonly {
    readonly id: string;
    readonly parityGate: boolean;
    readonly bytes: ByteRecipe;
    readonly typescriptCurrentBehavior: string;
    readonly rustRequirement: string;
  }[];
}

const FIXTURES = JSON.parse(
  readFileSync(new URL("../fixtures/runtime-host-control/v1/cases.json", import.meta.url), "utf8"),
) as FixtureDocument;

function bytesFromRecipe(recipe: ByteRecipe): Buffer {
  switch (recipe.kind) {
    case "utf8":
      return Buffer.from(recipe.value, "utf8");
    case "hex":
      return Buffer.from(recipe.value, "hex");
    case "segments":
      return Buffer.concat(
        recipe.value.map((segment) => {
          const bytes = Buffer.from(segment.value, "hex");
          if (segment.kind === "hex") return bytes;
          assert.equal(bytes.length, 1, "repeat-hex fixtures repeat exactly one byte");
          assert.ok(Number.isSafeInteger(segment.count) && segment.count >= 0);
          return Buffer.alloc(segment.count, bytes[0]);
        }),
      );
  }
}

function chunksFor(bytes: Buffer, chunking: Chunking): readonly Buffer[] {
  if (chunking === "whole") return [bytes];
  if (chunking === "one-byte") {
    return Array.from(bytes, (_byte, index) => bytes.subarray(index, index + 1));
  }
  const cuts = [0, ...chunking.cuts, bytes.length];
  assert.deepEqual(
    [...cuts].sort((left, right) => left - right),
    cuts,
  );
  assert.equal(new Set(cuts).size, cuts.length);
  assert.ok(cuts.every((cut) => Number.isSafeInteger(cut) && cut >= 0 && cut <= bytes.length));
  return cuts.slice(0, -1).map((cut, index) => bytes.subarray(cut, cuts[index + 1]));
}

function decodeAccepted(bytes: Buffer, chunking: Chunking): readonly unknown[] {
  const decoder = new RuntimeHostControlNdjsonDecoder();
  const records: unknown[] = [];
  for (const chunk of chunksFor(bytes, chunking)) records.push(...decoder.push(chunk));
  decoder.finish();
  return records;
}

function decodeError(
  bytes: Buffer,
  chunking: Chunking,
): { readonly when: "push" | "finish"; readonly error: RuntimeHostControlDecodeError } {
  const decoder = new RuntimeHostControlNdjsonDecoder();
  try {
    for (const chunk of chunksFor(bytes, chunking)) decoder.push(chunk);
  } catch (error) {
    assert.ok(error instanceof RuntimeHostControlDecodeError);
    return { when: "push", error };
  }
  try {
    decoder.finish();
  } catch (error) {
    assert.ok(error instanceof RuntimeHostControlDecodeError);
    return { when: "finish", error };
  }
  throw new Error("Fixture expected a Runtime Host control decode error.");
}

test("pins the shared Runtime Host control fixture protocol envelope", () => {
  assert.equal(FIXTURES.fixtureSchemaVersion, 1);
  assert.equal(FIXTURES.controlVersion, RUNTIME_HOST_CONTROL_VERSION);
  assert.equal(FIXTURES.hostProtocolVersion, RUNTIME_HOST_PROTOCOL_VERSION);
  assert.equal(FIXTURES.maximumFrameBytes, RUNTIME_HOST_CONTROL_MAX_FRAME_BYTES);
  assert.equal(new Set(FIXTURES.cases.map(({ id }) => id)).size, FIXTURES.cases.length);
  assert.ok(FIXTURES.compatibilityExceptions.length > 0);
  assert.ok(FIXTURES.compatibilityExceptions.every(({ parityGate }) => parityGate === false));
  assert.equal(
    new Set(FIXTURES.compatibilityExceptions.map(({ id }) => id)).size,
    FIXTURES.compatibilityExceptions.length,
  );
  for (const exception of FIXTURES.compatibilityExceptions) {
    assert.ok(bytesFromRecipe(exception.bytes).length > 0);
    assert.ok(exception.typescriptCurrentBehavior.length > 0);
    assert.ok(exception.rustRequirement.length > 0);
  }
});

for (const fixture of FIXTURES.cases) {
  test(`matches shared Runtime Host control bytes: ${fixture.id}`, () => {
    const bytes = bytesFromRecipe(fixture.bytes);
    assert.equal(bytes.length, fixture.byteLength);

    for (const chunking of fixture.chunkings) {
      if (fixture.expect.ndjson.kind === "error") {
        const result = decodeError(bytes, chunking);
        assert.equal(result.when, fixture.expect.ndjson.when);
        assert.equal(result.error.code, fixture.expect.ndjson.code);
        continue;
      }

      const records = decodeAccepted(bytes, chunking);
      assert.equal(records.length, fixture.expect.ndjson.count);
      const dtoExpectation = fixture.expect.dto;
      if (!dtoExpectation) continue;
      assert.equal(records.length, 1);
      const record = records[0];
      const parsed =
        fixture.direction === "container-to-host"
          ? parseRuntimeHostControlInputFrame(record)
          : parseRuntimeHostControlOutputFrame(record);

      if (dtoExpectation.kind === "reject") {
        assert.equal(parsed, undefined);
        if (fixture.expect.inputErrorCode) {
          assert.equal(runtimeHostControlInputErrorCode(record), fixture.expect.inputErrorCode);
        }
        continue;
      }

      assert.equal(parsed?.type, dtoExpectation.type);
      if (!fixture.canonicalSerialization) continue;
      const encoded =
        fixture.direction === "container-to-host"
          ? encodeRuntimeHostControlInputFrame(parsed)
          : encodeRuntimeHostControlOutputFrame(parsed);
      assert.deepEqual(Buffer.from(encoded), bytes);
    }
  });
}

test("decodes coalesced golden frames independently of UTF-8 and frame chunk boundaries", () => {
  const fixturesById = new Map(FIXTURES.cases.map((fixture) => [fixture.id, fixture]));
  const selected = [
    "host.ready.utf8-splits",
    "host.shutdown-ack",
    "container.start.tauri-origin",
    "container.shutdown.requested",
  ].map((id) => {
    const fixture = fixturesById.get(id);
    assert.ok(fixture);
    return bytesFromRecipe(fixture.bytes);
  });
  const bytes = Buffer.concat(selected);
  const decoder = new RuntimeHostControlNdjsonDecoder();
  const records: unknown[] = [];
  for (const chunk of chunksFor(bytes, { cuts: [1, 74, 77, 80, 84, 137, 180, 181] })) {
    records.push(...decoder.push(chunk));
  }
  decoder.finish();
  assert.deepEqual(
    records.map((record, index) =>
      index < 2
        ? parseRuntimeHostControlOutputFrame(record)?.type
        : parseRuntimeHostControlInputFrame(record)?.type,
    ),
    ["ready", "shutdown-ack", "start", "shutdown"],
  );
});
