import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const toolboxDirectory = new URL("./", import.meta.url);

test("toolbox presentation leaves do not read Pi clients or Workbench state", async () => {
  const source = await readFile(
    new URL("toolbox-capability-presentation.tsx", toolboxDirectory),
    "utf8",
  );

  assert.doesNotMatch(source, /@workbench\/agent-runtime-pi-client/u);
  assert.doesNotMatch(source, /@workbench\/shell\/right-workspace/u);
  assert.doesNotMatch(source, /installation-services/u);
  assert.doesNotMatch(source, /toolbox-scope-store/u);
  assert.doesNotMatch(source, /usePi(?:Host|Resource|Workspace)/u);
});

test("toolbox runtime container delegates typed detail sections to presentation leaves", async () => {
  const source = await readFile(
    new URL("toolbox-capability-surface.tsx", toolboxDirectory),
    "utf8",
  );

  assert.match(source, /from "\.\/toolbox-capability-presentation"/u);
  assert.match(source, /<PackageOverviewPanel\b/u);
  assert.match(source, /<ExtensionControls\b/u);
  assert.match(source, /<ExtensionCapabilityDetailsPanel\b/u);
  assert.match(source, /<SkillDocumentPanel\b/u);
});
