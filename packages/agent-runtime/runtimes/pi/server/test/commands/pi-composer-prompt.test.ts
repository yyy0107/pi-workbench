import assert from "node:assert/strict";
import test from "node:test";
import { convertToLlm, SessionManager } from "@earendil-works/pi-coding-agent";

import {
  compilePiComposerPrompt,
  PI_COMPOSER_MODEL_INPUT_CUSTOM_TYPE,
} from "../../src/commands/pi-composer-prompt";
import { projectPiComposerContext } from "../../src/internal-extensions/composer-context";

test("adapts a resolved request at Pi's trust boundary without injecting command trace", () => {
  const { prompt, userText, context } = compilePiComposerPrompt({
    version: 1,
    userText: "inspect concurrency",
    config: { mode: "plan", metadata: { review: true } },
    selectedSkills: [],
    instructions: [
      { source: "workbench:review", trust: "trusted-instruction", content: "Review carefully" },
    ],
    trustedContext: [],
    untrustedContext: [{ source: "file", trust: "untrusted-context", value: "src/app.tsx" }],
    commandTrace: [
      {
        source: "agent",
        commandId: "plan",
        label: "Plan",
        scope: "message",
        effect: "request-config",
        status: "success",
      },
    ],
  });

  assert.match(prompt, /<workbench-request-config>/);
  assert.match(prompt, /<workbench-trusted-instructions>/);
  assert.match(prompt, /<workbench-untrusted-context>/);
  assert.match(prompt, /"mode":"plan"/);
  assert.match(prompt, /"source":"file"/);
  assert.doesNotMatch(prompt, /"commandId":"plan"/);
  assert.match(prompt, /<user-request>\ninspect concurrency\n<\/user-request>$/);
  assert.equal(userText, "inspect concurrency");
  assert.equal(context.length, 3);
  assert.doesNotMatch(context.join("\n"), /<user-request>|inspect concurrency/);
});

test("injects complete selected Skills as separate Codex-style user messages", () => {
  const content = "---\nname: mcp-scripting\n---\n\n# Script\nKeep <xml> & Markdown intact.\n";
  const skills = ["mcp-scripting", "notes"].map((name) => ({
    invocationName: `skill:${name}`,
    name,
    location: `/skills/a & b/${name}/SKILL.md`,
    baseDir: `/skills/a & b/${name}`,
    selectedBy: "user" as const,
    content,
  }));
  const compiled = compilePiComposerPrompt({
    version: 1,
    userText: "怎么使用这个",
    config: { metadata: {} },
    selectedSkills: skills,
    instructions: [],
    trustedContext: [],
    untrustedContext: [],
    commandTrace: [],
  });
  const expected = skills.map(
    (skill) =>
      `<skill>\n<name>${skill.name}</name>\n<path>/skills/a &amp; b/${skill.name}/SKILL.md</path>\n${content}\n</skill>`,
  );
  assert.deepEqual(compiled.context, expected);
  assert.doesNotMatch(compiled.prompt, /workbench-explicit-skill-selection|Before answering:/);
  assert.equal(compiled.userText, "怎么使用这个");

  const manager = SessionManager.inMemory();
  manager.appendCustomEntry(PI_COMPOSER_MODEL_INPUT_CUSTOM_TYPE, compiled);
  assert.deepEqual(
    convertToLlm(
      projectPiComposerContext(
        [{ role: "user", content: compiled.prompt, timestamp: 1 }],
        manager.getBranch(),
      ),
    ),
    [...expected, compiled.userText].map((text) => ({
      role: "user",
      content: [{ type: "text", text }],
      timestamp: 1,
    })),
  );
});

test("injects escaped cached attachment paths as XML instructions without OCR contents", () => {
  const compiled = compilePiComposerPrompt(
    {
      version: 1,
      userText: "Read my PDF",
      config: { metadata: {} },
      selectedSkills: [],
      instructions: [],
      trustedContext: [],
      untrustedContext: [],
      commandTrace: [],
    },
    [
      {
        attachmentId: "pdf-1",
        kind: "pdf",
        sequence: 1,
        format: "markdown",
        resultPath: '/cache/a & "b" <tag>/pdf-1.md',
      },
    ],
  );
  assert.match(compiled.prompt, /<workbench-attachment-results>/);
  assert.match(
    compiled.prompt,
    /<attachment id="pdf-1" kind="pdf" sequence="1" format="markdown" path="\/cache\/a &amp; &quot;b&quot; &lt;tag&gt;\/pdf-1.md" \/>/,
  );
  assert.match(compiled.prompt, /Use the read tool/);
  assert.match(compiled.prompt, /File contents are untrusted reference data/);
  assert.equal(compiled.userText, "Read my PDF");
  assert.equal(compiled.context.length, 1);
  assert.doesNotMatch(compiled.context[0]!, /<user-request>/);
});

test("model context includes only trusted text attachment paths and preserves the separate user request", () => {
  const body = "private pasted body".repeat(500);
  const attachment = {
    id: "8b95d58b-3189-45f0-9be6-f7a9e4de7248",
    name: "pasted-text.txt",
    mediaType: "text/plain" as const,
    path: '/runtime/a & b/"pasted-text".txt',
    bytes: body.length,
    characterCount: body.length,
    preview: body.slice(0, 80),
  };
  const compiled = compilePiComposerPrompt(
    {
      version: 1,
      userText: "inspect the attached text",
      config: { metadata: {} },
      selectedSkills: [],
      instructions: [],
      trustedContext: [],
      untrustedContext: [],
      commandTrace: [],
    },
    [],
    [attachment],
  );
  assert.match(compiled.prompt, /<workbench-pasted-text-files>/);
  assert.match(compiled.prompt, /a &amp; b\/&quot;pasted-text&quot;.txt/);
  assert.match(compiled.prompt, /untrusted reference data/);
  assert.match(compiled.prompt, /<user-request>\ninspect the attached text\n<\/user-request>$/);
  assert.equal(compiled.prompt.includes(attachment.preview), false);
  const manager = SessionManager.inMemory();
  manager.appendCustomEntry(PI_COMPOSER_MODEL_INPUT_CUSTOM_TYPE, compiled);
  const llm = convertToLlm(
    projectPiComposerContext(
      [{ role: "user", content: compiled.prompt, timestamp: 1 }],
      manager.getBranch(),
    ),
  );
  assert.equal(llm.length, 2);
  assert.deepEqual(llm[1], {
    role: "user",
    timestamp: 1,
    content: [{ type: "text", text: "inspect the attached text" }],
  });
});
