import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { SettingsManager } from "@earendil-works/pi-coding-agent";

import { removeRetiredWorkbenchBrowserPackage } from "@workbench/pi-workbench-runtime/builtin-packages";

test("retires the built-in Browser package and its earlier standalone resource filters", async (t) => {
  const agentDir = await mkdtemp(path.join(tmpdir(), "pi-retired-browser-package-"));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  const settingsFile = path.join(agentDir, "settings.json");
  const customPackage = { source: "./custom-package", extensions: ["+custom.js"] };
  const similarlyNamedPackage = "./packages/.builtin/browser-copy";
  await writeFile(
    settingsFile,
    JSON.stringify({
      packages: [
        customPackage,
        "./packages/.builtin/browser",
        {
          source: ".\\packages\\.builtin\\browser",
          extensions: ["+./index.js"],
          skills: ["+skills/browser-use/SKILL.md"],
        },
        similarlyNamedPackage,
      ],
      extensions: [
        "+extensions/.builtin/browser",
        "-extensions/.builtin/browser/index.ts",
        "extensions/.builtin/custom/index.ts",
      ],
      skills: [
        "+skills/.builtin/browser",
        "-skills/.builtin/browser/SKILL.md",
        "skills/.builtin/custom/SKILL.md",
      ],
      defaultModel: "preserved-model",
    }),
  );

  await removeRetiredWorkbenchBrowserPackage(agentDir);
  await removeRetiredWorkbenchBrowserPackage(agentDir);

  const settings = SettingsManager.create(agentDir, agentDir, { projectTrusted: false });
  assert.deepEqual(settings.getGlobalSettings().packages, [customPackage, similarlyNamedPackage]);
  assert.deepEqual(settings.getGlobalSettings().extensions, [
    "extensions/.builtin/custom/index.ts",
  ]);
  assert.deepEqual(settings.getGlobalSettings().skills, ["skills/.builtin/custom/SKILL.md"]);
  assert.equal(settings.getGlobalSettings().defaultModel, "preserved-model");
});

test("does not replace invalid settings while retiring Browser resources", async (t) => {
  const agentDir = await mkdtemp(path.join(tmpdir(), "pi-retired-browser-invalid-settings-"));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  const settingsFile = path.join(agentDir, "settings.json");
  const invalid = "{invalid settings";
  await writeFile(settingsFile, invalid);

  await assert.rejects(removeRetiredWorkbenchBrowserPackage(agentDir), SyntaxError);
  assert.equal(await readFile(settingsFile, "utf8"), invalid);
});
