import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";

import { ExtensionService } from "../../src/extensions/extension-service";
import {
  isWorkbenchBuiltinPackage,
  registerWorkbenchBuiltinPackages,
  WORKBENCH_BROWSER_PACKAGE_SOURCE,
} from "../../src/packages/builtin-packages";
import { InstalledPackageService } from "../../src/packages/installed-package-service";
import { readPackageResourceDetails } from "../../src/packages/package-resource-details";
import { ScopedResourceContextService } from "../../src/resources/scoped-resource-context";
import { SkillService } from "../../src/skills/skill-service";

test("the built-in browser loads once as a Pi package across reloads and native resource filters", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-builtin-browser-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agentDir = path.join(root, "agent");
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });
  const service = new ScopedResourceContextService({
    agentDir: () => agentDir,
    applicationCwd: () => root,
  });
  const context = await service.get({ scope: "user" });
  const { settingsManager, resourceLoader } = context;
  const packageManager = new DefaultPackageManager({ cwd: root, agentDir, settingsManager });
  const browserExtensions = () =>
    resourceLoader
      .getExtensions()
      .extensions.filter((extension) => extension.tools.has("workbench_browser"));
  const browserSkills = () =>
    resourceLoader.getSkills().skills.filter((skill) => skill.name === "browser");
  for (let reload = 0; reload < 2; reload++) {
    await registerWorkbenchBuiltinPackages(agentDir);
    await context.reload();
    assert.deepEqual(resourceLoader.getExtensions().errors, []);
    const [extension] = browserExtensions();
    assert.equal(browserExtensions().length, 1);
    assert.ok(extension);
    assert.equal(extension.handlers.get("session_shutdown")?.length, 2);
    assert.equal(extension.handlers.get("agent_settled")?.length, 1);
    assert.equal(extension.sourceInfo.source, WORKBENCH_BROWSER_PACKAGE_SOURCE);
    assert.equal(extension.sourceInfo.origin, "package");
    assert.equal(extension.sourceInfo.scope, "user");
    assert.equal(browserSkills().length, 1);
    assert.equal(browserSkills()[0]?.sourceInfo.origin, "package");
    assert.equal(browserSkills()[0]?.sourceInfo.source, WORKBENCH_BROWSER_PACKAGE_SOURCE);
    assert.equal(
      packageManager
        .listConfiguredPackages()
        .filter((pkg) => isWorkbenchBuiltinPackage(pkg.source, pkg.scope)).length,
      1,
    );
  }
  const extension = browserExtensions()[0]!;
  const details = await readPackageResourceDetails(
    await packageManager.resolve(async () => "skip"),
    packageManager.getInstalledPath(WORKBENCH_BROWSER_PACKAGE_SOURCE, "user")!,
    WORKBENCH_BROWSER_PACKAGE_SOURCE,
    "user",
    resourceLoader.getExtensions().extensions,
  );
  assert.equal(details.find((resource) => resource.type === "skill")?.name, "browser");
  assert.deepEqual(details.find((resource) => resource.type === "extension")?.toolNames, [
    "workbench_browser",
  ]);
  assert.deepEqual(details.find((resource) => resource.type === "extension")?.eventNames, [
    "agent_settled",
    "session_shutdown",
  ]);
  const dependencies = {
    getScopedResourceHost: async () => ({
      session: { resourceLoader, settingsManager, sessionManager: { getCwd: () => context.cwd } },
    }),
  };
  const request = { target: { scope: "user" as const } };
  const skills = new SkillService({ ...dependencies, agentDir: () => agentDir });
  const extensions = new ExtensionService(dependencies);
  const packageCatalog = await new InstalledPackageService(dependencies).list(request);
  assert.equal(packageCatalog.packages[0]?.builtin, true);
  assert.equal(packageCatalog.packages[0]?.name, "@workbench/pi-browser");
  const skillCatalog = await skills.list(request);
  const browserSkill = skillCatalog.skills.find((skill) => skill.name === "browser");
  assert.equal(browserSkill?.origin, "package");
  assert.equal(browserSkill?.packageBuiltin, true);
  const extensionCatalog = await extensions.list(request);
  const browserExtension = extensionCatalog.extensions.find(
    (entry) => entry.source === WORKBENCH_BROWSER_PACKAGE_SOURCE,
  );
  assert.equal(browserExtension?.origin, "package");
  assert.equal(browserExtension?.packageBuiltin, true);
  assert.equal(
    extensionCatalog.builtins?.some((entry) => entry.name === "workbench.browser"),
    false,
  );
  const extensionPath = path.relative(extension.sourceInfo.baseDir!, extension.resolvedPath);
  const disabled = {
    source: WORKBENCH_BROWSER_PACKAGE_SOURCE,
    extensions: [],
    skills: [],
  };
  settingsManager.setPackages([disabled]);
  await settingsManager.flush();
  await registerWorkbenchBuiltinPackages(agentDir);
  await context.reload();
  assert.deepEqual(settingsManager.getGlobalSettings().packages, [disabled]);
  assert.deepEqual(browserExtensions(), []);
  assert.deepEqual(browserSkills(), []);
  const resolved = await packageManager.resolve(async () => "skip");
  for (const resources of [resolved.extensions, resolved.skills]) {
    const browser = resources.filter((resource) =>
      isWorkbenchBuiltinPackage(resource.metadata.source, resource.metadata.scope),
    );
    assert.equal(browser.length, 1, "disabled package resources remain available to the catalog");
    assert.equal(browser[0]?.enabled, false);
  }
  assert.equal(
    (await skills.list(request)).skills.find((skill) => skill.name === "browser")?.enabled,
    false,
  );
  assert.equal(
    (await extensions.list(request)).extensions.find(
      (entry) => entry.source === WORKBENCH_BROWSER_PACKAGE_SOURCE,
    )?.enabled,
    false,
  );
  settingsManager.setPackages([
    {
      source: WORKBENCH_BROWSER_PACKAGE_SOURCE,
      extensions: [`+${extensionPath.split(path.sep).join("/")}`],
      skills: ["+skills/browser/SKILL.md"],
    },
  ]);
  await settingsManager.flush();
  await context.reload();
  assert.equal(browserExtensions().length, 1);
  assert.equal(browserSkills().length, 1);
});

test("registration migrates the retired browser skill switch and preserves existing package filters", async (t) => {
  const agentDir = await mkdtemp(path.join(tmpdir(), "pi-builtin-package-settings-"));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  const settingsFile = path.join(agentDir, "settings.json");
  const customPackage = { source: "./custom-package", extensions: ["+custom.js"] };
  await writeFile(
    settingsFile,
    JSON.stringify({
      packages: [customPackage],
      skills: ["+skills/.builtin/browser", "-skills/.builtin/browser/SKILL.md", "-skills/custom"],
      defaultModel: "preserved-model",
    }),
  );
  await registerWorkbenchBuiltinPackages(agentDir);
  await registerWorkbenchBuiltinPackages(agentDir);
  const settings = SettingsManager.create(agentDir, agentDir, { projectTrusted: false });
  assert.deepEqual(settings.getGlobalSettings().packages, [
    customPackage,
    { source: WORKBENCH_BROWSER_PACKAGE_SOURCE, skills: ["-skills/browser/SKILL.md"] },
  ]);
  assert.deepEqual(settings.getGlobalSettings().skills, ["-skills/custom"]);
  assert.equal(settings.getGlobalSettings().defaultModel, "preserved-model");
  const configured = {
    source: "packages/.builtin/browser",
    extensions: ["-index.js"],
    skills: ["+skills/browser/SKILL.md"],
  };
  settings.setPackages([customPackage, configured]);
  settings.setSkillPaths(["-skills/.builtin/browser"]);
  await settings.flush();
  await registerWorkbenchBuiltinPackages(agentDir);
  await settings.reload();
  assert.deepEqual(settings.getGlobalSettings().packages, [customPackage, configured]);
  assert.deepEqual(settings.getGlobalSettings().skills, []);
  assert.equal(isWorkbenchBuiltinPackage(configured.source, "project"), false);
  const invalid = "{invalid settings";
  await writeFile(settingsFile, invalid);
  await assert.rejects(registerWorkbenchBuiltinPackages(agentDir), SyntaxError);
  assert.equal(await readFile(settingsFile, "utf8"), invalid);
});
