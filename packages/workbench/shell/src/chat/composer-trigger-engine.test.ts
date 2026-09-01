import assert from "node:assert/strict";
import test from "node:test";

import { ComposerTriggerEngine, excludeSlashPathOrCode } from "./composer-trigger-engine";

const commands = ["create-subagent", "review", "reload-runtime"] as const;
const engine = new ComposerTriggerEngine<string>([
  {
    id: "slash",
    character: "/",
    search: (query) => commands.filter((command) => command.startsWith(query.toLowerCase())),
    isExcluded: excludeSlashPathOrCode,
  },
]);

test("detects slash tokens at the start and legal whitespace boundaries", () => {
  assert.deepEqual(engine.detect({ value: "/cre", cursorPosition: 4, isComposing: false }), {
    value: "/cre",
    cursorPosition: 4,
    tokenStart: 0,
    tokenEnd: 4,
    token: "/cre",
    query: "cre",
    triggerId: "slash",
    triggerCharacter: "/",
    suggestions: ["create-subagent"],
    key: "slash:0:4:cre",
  });

  assert.equal(
    engine.detect({ value: "please\n/re", cursorPosition: 10, isComposing: false })?.query,
    "re",
  );
});

test("uses the cursor position and closes after the token terminates", () => {
  const value = "/review later";
  assert.equal(engine.detect({ value, cursorPosition: 4, isComposing: false })?.query, "rev");
  assert.equal(
    engine.detect({ value, cursorPosition: value.length, isComposing: false }),
    undefined,
  );
});

test("does not trigger during IME composition or without a legal boundary", () => {
  assert.equal(engine.detect({ value: "/re", cursorPosition: 3, isComposing: true }), undefined);
  assert.equal(
    engine.detect({ value: "prefix/re", cursorPosition: 9, isComposing: false }),
    undefined,
  );
});

test("excludes URL, path, and code-shaped slash tokens", () => {
  for (const value of [
    "https://host/re",
    "./review",
    "/tmp/review",
    "`code /review",
    "```ts\n/review",
    "    /review",
    "~/review",
  ]) {
    assert.equal(
      engine.detect({ value, cursorPosition: value.length, isComposing: false }),
      undefined,
      value,
    );
  }
});
