import assert from "node:assert/strict";
import test from "node:test";

import { languageForFilename, normalizeShikiLanguage } from "./shiki-catalog";
import { highlightWorkbenchCode } from "./shiki-highlighter";

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
