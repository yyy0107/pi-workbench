import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import {
  DefaultResourceLoader,
  SettingsManager,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { BrowserHost } from "../index";

test("the packed Pi package loads its extension and skill without private workspace dependencies", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-browser-package-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const packageRoot = fileURLToPath(new URL("../", import.meta.url));
  const packed = spawnSync("pnpm", ["pack", "--pack-destination", directory], {
    cwd: packageRoot,
    encoding: "utf8",
  });
  assert.equal(packed.status, 0, packed.stderr || packed.stdout);
  const archive = path.join(directory, "workbench-pi-browser-0.1.0.tgz");
  const extracted = spawnSync("tar", ["-xzf", archive, "-C", directory], { encoding: "utf8" });
  assert.equal(extracted.status, 0, extracted.stderr);
  const root = path.join(directory, "package");
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.deepEqual(manifest.pi, { extensions: ["./dist/index.js"], skills: ["./skills"] });
  assert.equal(manifest.exports["."], "./dist/index.js");
  assert.equal(manifest.dependencies, undefined);
  assert.deepEqual(Object.keys(manifest.peerDependencies).sort(), [
    "@earendil-works/pi-ai",
    "@earendil-works/pi-coding-agent",
    "typebox",
  ]);
  const code = await readFile(path.join(root, "dist/index.js"), "utf8");
  assert.doesNotMatch(code, /(?:from\s+|import\s*\()["']@workbench\//);
  const resource = (await import(pathToFileURL(path.join(root, "dist/resources.js")).href)) as {
    browserSkillDirectory: URL;
  };
  assert.equal(fileURLToPath(resource.browserSkillDirectory), path.join(root, "skills/browser/"));
  await mkdir(path.join(directory, "agent"));
  const loader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: path.join(directory, "agent"),
    settingsManager: SettingsManager.inMemory({ packages: [root] }, { projectTrusted: false }),
    noThemes: true,
    noPromptTemplates: true,
    noContextFiles: true,
  });
  await loader.reload();
  const loaded = loader.getExtensions();
  assert.deepEqual(loaded.errors, []);
  const tool = loaded.extensions
    .flatMap((extension) => [...extension.tools.values()])
    .find((entry) => entry.definition.name === "workbench_browser")?.definition;
  assert.ok(tool);
  assert.equal(tool.executionMode, "sequential");
  const skills = loader.getSkills();
  assert.deepEqual(skills.diagnostics, []);
  assert.equal(
    skills.skills.find((skill) => skill.name === "browser")?.filePath,
    path.join(root, "skills/browser/SKILL.md"),
  );
  const global = globalThis as typeof globalThis & {
    __workbenchPiAgentHostBindings?: { browser?: BrowserHost };
  };
  const previous = global.__workbenchPiAgentHostBindings;
  t.after(() => {
    if (previous === undefined) delete global.__workbenchPiAgentHostBindings;
    else global.__workbenchPiAgentHostBindings = previous;
  });
  global.__workbenchPiAgentHostBindings = {
    browser: {
      async command(command) {
        assert.equal(command.type, "screenshot");
        return { name: "page.png", mimeType: "image/png", data: "cGljdHVyZQ==" };
      },
    },
  };
  const result = await tool.execute("image", { action: "screenshot" }, undefined, undefined, {
    cwd: directory,
    sessionManager: { getSessionId: () => "package-test" },
  } as ExtensionContext);
  assert.deepEqual(result.content, [
    { type: "text", text: "{}" },
    { type: "image", mimeType: "image/png", data: "cGljdHVyZQ==" },
  ]);
});
