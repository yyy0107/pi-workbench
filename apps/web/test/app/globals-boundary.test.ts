import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Web styles explicitly compose Shell and scan installed contribution sources", async () => {
  const styles = await readFile(new URL("../../src/app/globals.css", import.meta.url), "utf8");

  assert.equal(styles.includes('@import "@workbench/shell/styles.css";'), true);
  assert.equal(
    styles.includes('@source "../../../../packages/workbench/shell/src/**/*.{ts,tsx}";'),
    true,
  );
  assert.equal(
    styles.includes(
      '@source "../../../../packages/agent-runtime/adapters/pi/contributions/src/**/*.{ts,tsx}";',
    ),
    true,
  );
});
