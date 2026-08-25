import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import type { SettingsManager } from "@earendil-works/pi-coding-agent";

import { ExtensionService } from "../extensions/extension-service";
import { InstalledPackageService } from "../packages/installed-package-service";
import { SkillService } from "../skills/skill-service";

interface MutableResourceSettings {
  extensions?: string[];
  skills?: string[];
}

function resourceSettingsManager(): SettingsManager {
  const globalSettings: MutableResourceSettings = {};
  const projectSettings: MutableResourceSettings = {};

  return {
    getGlobalSettings: () => globalSettings,
    getProjectSettings: () => projectSettings,
    setExtensionPaths: (extensions: string[]) => {
      globalSettings.extensions = extensions;
    },
    setProjectExtensionPaths: (extensions: string[]) => {
      projectSettings.extensions = extensions;
    },
    setSkillPaths: (skills: string[]) => {
      globalSettings.skills = skills;
    },
    setProjectSkillPaths: (skills: string[]) => {
      projectSettings.skills = skills;
    },
    flush: async () => undefined,
    drainErrors: () => [],
  } as unknown as SettingsManager;
}

function extension(filePath: string, baseDir: string) {
  return {
    path: filePath,
    sourceInfo: {
      source: "auto",
      scope: "user" as const,
      origin: "top-level" as const,
      baseDir,
    },
    handlers: new Map(),
    tools: new Map(),
    commands: new Map(),
  };
}

function skill(filePath: string, baseDir: string) {
  return {
    name: "review-skill",
    description: "Review the current changes.",
    disableModelInvocation: false,
    filePath,
    sourceInfo: {
      source: "auto",
      scope: "user" as const,
      origin: "top-level" as const,
      baseDir,
    },
  };
}

function targetSession(options: {
  settingsManager: SettingsManager;
  extensionFile: string;
  skillFile: string;
  baseDir: string;
  reload: () => Promise<void>;
}) {
  return {
    isRunning: false,
    session: {
      resourceLoader: {
        getExtensions: () => ({
          extensions: [extension(options.extensionFile, options.baseDir)],
          errors: [],
        }),
        getSkills: () => ({ skills: [skill(options.skillFile, options.baseDir)] }),
      },
      settingsManager: options.settingsManager,
      reload: options.reload,
    },
  };
}

function extensionToggle(extensionFile: string) {
  return {
    sessionId: "session-target",
    name: "review",
    filePath: extensionFile,
    source: "auto",
    scope: "user" as const,
    origin: "top-level" as const,
    enabled: false,
  };
}

const skillToggle = {
  sessionId: "session-target",
  name: "review-skill",
  enabled: false,
} as const;

const packageInstall = {
  name: "review-package",
  target: { scope: "user" as const, sessionId: "session-target" },
};

test("characterizes known limitation: Extension, Skill, and Package mutations can overlap reloads for one session", async () => {
  const baseDir = path.join("/virtual", "pi-agent");
  const extensionFile = path.join(baseDir, "extensions", "review.ts");
  const skillFile = path.join(baseDir, "skills", "review-skill", "SKILL.md");
  const settingsManager = resourceSettingsManager();
  let activeReloads = 0;
  let maximumActiveReloads = 0;
  let reloadStarts = 0;
  let resolveThreeStarted!: () => void;
  let releaseReloads!: () => void;
  const threeStarted = new Promise<void>((resolve) => {
    resolveThreeStarted = resolve;
  });
  const reloadGate = new Promise<void>((resolve) => {
    releaseReloads = resolve;
  });
  const reload = async () => {
    activeReloads += 1;
    reloadStarts += 1;
    maximumActiveReloads = Math.max(maximumActiveReloads, activeReloads);
    if (reloadStarts === 3) resolveThreeStarted();
    await reloadGate;
    activeReloads -= 1;
  };
  const host = targetSession({ settingsManager, extensionFile, skillFile, baseDir, reload });
  const extensionService = new ExtensionService({ getSession: async () => host });
  const skillService = new SkillService({ getSession: async () => host });
  const packageService = new InstalledPackageService({
    getLoadedSessions: () => [
      {
        id: "session-target",
        isRunning: false,
        session: {
          sessionManager: { getCwd: () => "/workspace" },
          reload,
        },
      },
    ],
    installUserPackage: async () => undefined,
  });

  const operations = [
    extensionService.setEnabled(extensionToggle(extensionFile)),
    skillService.setEnabled(skillToggle),
    packageService.install(packageInstall),
  ];
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const overlapped = await Promise.race([
    threeStarted.then(() => true),
    new Promise<boolean>((resolve) => {
      timeout = setTimeout(() => resolve(false), 2_000);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
  releaseReloads();
  const results = await Promise.allSettled(operations);

  assert.equal(
    overlapped,
    true,
    "the current service-local mutation queues allow all three reloads to start together",
  );
  assert.equal(reloadStarts, 3);
  assert.equal(maximumActiveReloads, 3);
  assert.deepEqual(
    results.map((result) => result.status),
    ["fulfilled", "fulfilled", "fulfilled"],
  );
});

test("characterizes known limitation: user Extension and Skill changes reload only the addressed session while Package changes reload every loaded session", async () => {
  const baseDir = path.join("/virtual", "pi-agent");
  const extensionFile = path.join(baseDir, "extensions", "review.ts");
  const skillFile = path.join(baseDir, "skills", "review-skill", "SKILL.md");
  const settingsManager = resourceSettingsManager();
  const reloaded: string[] = [];
  const host = targetSession({
    settingsManager,
    extensionFile,
    skillFile,
    baseDir,
    reload: async () => {
      reloaded.push("session-target");
    },
  });
  const extensionService = new ExtensionService({ getSession: async () => host });
  const skillService = new SkillService({ getSession: async () => host });
  const packageService = new InstalledPackageService({
    getLoadedSessions: () => [
      {
        id: "session-target",
        isRunning: false,
        session: {
          sessionManager: { getCwd: () => "/workspace/target" },
          reload: async () => {
            reloaded.push("session-target");
          },
        },
      },
      {
        id: "session-other",
        isRunning: false,
        session: {
          sessionManager: { getCwd: () => "/workspace/other" },
          reload: async () => {
            reloaded.push("session-other");
          },
        },
      },
    ],
    installUserPackage: async () => undefined,
  });

  await extensionService.setEnabled(extensionToggle(extensionFile));
  await skillService.setEnabled(skillToggle);
  await packageService.install(packageInstall);

  assert.deepEqual(reloaded, [
    "session-target",
    "session-target",
    "session-target",
    "session-other",
  ]);
});
