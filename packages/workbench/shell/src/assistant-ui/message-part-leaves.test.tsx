import assert from "node:assert/strict";
import test from "node:test";

import type { EnrichedPartState } from "@assistant-ui/react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  MessagePartLeaf,
  safeExternalMessageUrl,
  serializeMessagePartValue,
} from "./message-part-leaves";

const completeStatus = { type: "complete" } as const;

test("accepts only absolute HTTP message source URLs", () => {
  assert.equal(
    safeExternalMessageUrl("https://example.com/reference"),
    "https://example.com/reference",
  );
  assert.equal(
    safeExternalMessageUrl("http://localhost:3000/reference"),
    "http://localhost:3000/reference",
  );
  assert.equal(safeExternalMessageUrl("javascript:alert(1)"), undefined);
  assert.equal(safeExternalMessageUrl("data:text/html;base64,PHNjcmlwdD4="), undefined);
  assert.equal(safeExternalMessageUrl("/relative/reference"), undefined);
  assert.equal(safeExternalMessageUrl("not a URL"), undefined);
});

test("serializes message payloads without throwing on non-JSON values", () => {
  assert.equal(serializeMessagePartValue("plain"), "plain");
  assert.equal(serializeMessagePartValue({ answer: 42 }), '{\n  "answer": 42\n}');
  assert.equal(serializeMessagePartValue(undefined), "undefined");
  assert.equal(serializeMessagePartValue(BigInt(42)), "42");

  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  assert.equal(serializeMessagePartValue(cyclic), "[object Object]");
});

test("renders unsafe message sources as text instead of links", () => {
  const part = {
    type: "source",
    sourceType: "url",
    id: "source-1",
    title: "Unsafe source",
    url: "javascript:alert(1)",
    status: completeStatus,
  } satisfies EnrichedPartState;

  const markup = renderToStaticMarkup(
    <MessagePartLeaf part={part} sourceFallbackLabel="Source" sourceVariant="chip" />,
  );

  assert.match(markup, /Unsafe source/);
  assert.doesNotMatch(markup, /href=/);
});

test("renders safe message sources with isolated external-link semantics", () => {
  const part = {
    type: "source",
    sourceType: "url",
    id: "source-1",
    title: "Reference",
    url: "https://example.com/reference",
    status: completeStatus,
  } satisfies EnrichedPartState;

  const markup = renderToStaticMarkup(<MessagePartLeaf part={part} sourceFallbackLabel="Source" />);

  assert.match(markup, /href="https:\/\/example\.com\/reference"/);
  assert.match(markup, /target="_blank"/);
  assert.match(markup, /rel="noopener noreferrer"/);
});
