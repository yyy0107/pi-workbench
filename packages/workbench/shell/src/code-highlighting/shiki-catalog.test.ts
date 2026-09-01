import assert from "node:assert/strict";
import test from "node:test";

import { languageForFilename, normalizeShikiLanguage } from "./shiki-catalog";
import { highlightWorkbenchCode, highlightWorkbenchCodeTokens } from "./shiki-highlighter";

test("normalizes supported Markdown fence language aliases", () => {
  assert.equal(normalizeShikiLanguage("js"), "javascript");
  assert.equal(normalizeShikiLanguage(" bash "), "shellscript");
  assert.equal(normalizeShikiLanguage("unknown-language"), "plaintext");
});

test("resolves registered languages from workspace filenames", () => {
  assert.equal(languageForFilename("src/example.tsx"), "tsx");
  assert.equal(languageForFilename("Dockerfile"), "dockerfile");
  assert.equal(languageForFilename("changes.patch"), "diff");
  assert.equal(languageForFilename("README"), "plaintext");
});

test("renders a registered language with color-scheme-aware themes", async () => {
  const tree = await highlightWorkbenchCode(
    "const answer: number = 42;",
    "typescript",
    "light-plus",
    "dark-plus",
  );
  const pre = tree.children[0];
  assert.equal(pre.type, "element");
  assert.match(String(pre.properties.style), /background-color:light-dark\(/);
});

test("tokenizes a visible code window with color-scheme-aware token styles", async () => {
  const lines = await highlightWorkbenchCodeTokens(
    "const answer: number = 42;",
    "typescript",
    "light-plus",
    "dark-plus",
  );

  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.map((token) => token.content).join(""), "const answer: number = 42;");
  assert.equal(
    lines[0]?.some((token) => String(token.htmlStyle?.color).includes("light-dark(")),
    true,
  );
});
