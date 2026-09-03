import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageRoot = new URL("../", import.meta.url);

test("composer presentation leaves do not read runtime or workbench state", async () => {
  const source = await readFile(
    new URL("src/chat/workbench-composer-view.tsx", packageRoot),
    "utf8",
  );

  assert.doesNotMatch(source, /useAui(?:State|Event)?\b/);
  assert.doesNotMatch(source, /useWorkspaceSelection\b/);
  assert.doesNotMatch(source, /useWorkbenchAgent\w*\b/);
  assert.doesNotMatch(source, /useComposerCommandRegistry\b|useExtensionErrorReporter\b/);
  assert.doesNotMatch(source, /readAgent(?:ComposerExtras|RejectedQueueDraft)\b/);
  assert.doesNotMatch(source, /useI18n\b/);
});

test("composer container owns runtime integration and supplies typed views", async () => {
  const source = await readFile(new URL("src/chat/workbench-composer.tsx", packageRoot), "utf8");

  assert.doesNotMatch(source, /@assistant-ui\/|\bComposerPrimitive\b|\buseAui(?:State|Event)?\b/);
  assert.match(source, /useConversationSession\(\)/);
  assert.match(source, /useSessionState\(/);
  assert.match(source, /useWorkspaceSelection\(\)/);
  assert.match(source, /from "\.\/workbench-composer-view"/);
  assert.match(source, /<WorkbenchComposerSurfaceView\b/);
  assert.match(source, /<ComposerErrorAlertView\b/);
});
