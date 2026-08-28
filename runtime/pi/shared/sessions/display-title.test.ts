import assert from "node:assert/strict";
import test from "node:test";

import { deriveSessionDisplayTitle } from "./display-title";

test("derives a title from the explicit user request without exposing internal envelopes", () => {
  const title = deriveSessionDisplayTitle(
    [
      "<workbench-request-config>",
      '{"model":"example"}',
      "</workbench-request-config>",
      "<workbench-untrusted-context>",
      '[{"source":"workbench.attachment-references"}]',
      "</workbench-untrusted-context>",
      "<user-request>",
      "请检查这个项目为什么构建失败",
      "</user-request>",
    ].join("\n"),
  );

  assert.equal(title, "请检查这个项目为什么构建失败");
});

test("uses the fallback when a prompt contains only internal context", () => {
  assert.equal(
    deriveSessionDisplayTitle(
      "<workbench-untrusted-context>private attachment text</workbench-untrusted-context>",
      { fallback: "Attachment analysis" },
    ),
    "Attachment analysis",
  );
});

test("keeps user-authored closing tags inside the outer user request", () => {
  assert.equal(
    deriveSessionDisplayTitle(
      "<user-request>Explain </user-request> as literal text</user-request>",
    ),
    "Explain </user-request> as literal text",
  );
});

test("uses the first meaningful code line and compacts standalone paths", () => {
  assert.equal(
    deriveSessionDisplayTitle("```ts\nimport { value } from './module';\nconsole.log(value);\n```"),
    "import { value } from './module';",
  );
  assert.equal(
    deriveSessionDisplayTitle("/home/example/projects/workbench/src/manager.ts"),
    "…/src/manager.ts",
  );
});

test("truncates by Unicode characters rather than UTF-16 code units", () => {
  const title = deriveSessionDisplayTitle("😀".repeat(70));
  assert.equal(Array.from(title).length, 60);
  assert.equal(title.endsWith("…"), true);
});

test("renders canonical Skill links as readable conversation chrome", () => {
  assert.equal(
    deriveSessionDisplayTitle("[$Apple Design](skill://project/apple-design) 这是什么"),
    "Apple Design 这是什么",
  );
});

test("renders canonical command links as readable conversation chrome", () => {
  assert.equal(
    deriveSessionDisplayTitle(
      "[$Compact](command://agent/compact?args=%7B%22customInstructions%22%3A%22Keep%20decisions%22%7D) 继续检查",
    ),
    "Compact 继续检查",
  );
});

test("keeps legacy Composer directives out of conversation chrome", () => {
  assert.equal(
    deriveSessionDisplayTitle(":pi-command[skill%3Aapple-design|Apple%20Design] 这是什么"),
    "Apple Design 这是什么",
  );
});
