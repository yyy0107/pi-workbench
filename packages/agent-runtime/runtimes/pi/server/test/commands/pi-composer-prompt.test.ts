import assert from "node:assert/strict";
import test from "node:test";

import { compilePiComposerPrompt } from "../../src/commands/pi-composer-prompt";

test("adapts a resolved request at Pi's trust boundary without injecting command trace", () => {
  const prompt = compilePiComposerPrompt({
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
});

test("binds a deictic request to the Skill explicitly selected in Composer", () => {
  const prompt = compilePiComposerPrompt({
    version: 1,
    userText: "怎么使用这个",
    config: { metadata: {} },
    selectedSkills: [
      {
        invocationName: "skill:mcp-scripting",
        name: "mcp-scripting",
        location: "/skills/mcp-scripting/SKILL.md",
        baseDir: "/skills/mcp-scripting",
        selectedBy: "user",
      },
    ],
    instructions: [],
    trustedContext: [],
    untrustedContext: [],
    commandTrace: [],
  });

  assert.match(prompt, /<workbench-explicit-skill-selection>/);
  assert.match(
    prompt,
    /explicitly selected the following Skills through the Workbench Skill picker/,
  );
  assert.match(prompt, /"location":"\/skills\/mcp-scripting\/SKILL.md"/);
  assert.match(prompt, /Use the read tool to read every selected Skill file completely/);
  assert.match(prompt, /Do not answer from a Skill name or description alone/);
  assert.match(prompt, /"这个"/);
  assert.doesNotMatch(prompt, /<workbench-trusted-instructions>/);
  assert.match(prompt, /<user-request>\n怎么使用这个\n<\/user-request>$/);
});
