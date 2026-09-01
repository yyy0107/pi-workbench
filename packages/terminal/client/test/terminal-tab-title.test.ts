import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTerminalTabTitle, terminalTabTitleFromPrompt } from "../src/terminal-tab-title";

test("extracts the visible prefix from common shell prompts", () => {
  assert.equal(
    terminalTabTitleFromPrompt("wy@wy-ubuntu:~/projects/workbench-aui/workbench-ui$  "),
    "wy@wy-ubuntu:~/projects/workbench-aui/workbench-ui",
  );
  assert.equal(
    terminalTabTitleFromPrompt("root@container:/workspace# pnpm dev"),
    "root@container:/workspace",
  );
  assert.equal(terminalTabTitleFromPrompt("bash-5.2$"), "bash-5.2");
});

test("ignores ordinary output and sanitizes terminal-provided titles", () => {
  assert.equal(terminalTabTitleFromPrompt("build completed successfully"), undefined);
  assert.equal(terminalTabTitleFromPrompt("progress 100% complete"), undefined);
  assert.equal(normalizeTerminalTabTitle("\u0000  wy@host: workspace\u0007"), "wy@host: workspace");
});
