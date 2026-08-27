import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { SettingsManager } from "@earendil-works/pi-coding-agent";

import { ExtensionService } from "../extensions/extension-service";
import {
  InstalledPackageService,
  InstalledPackageServiceError,
} from "../packages/installed-package-service";
import { SkillService, SkillServiceError } from "../skills/skill-service";
import {
  PiResourceMutationBusyError,
  PiResourceMutationCoordinator,
} from "./pi-resource-mutation-coordinator";

function resourceSettingsManager(): SettingsManager {
  return SettingsManager.inMemory({}, { projectTrusted: true });
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
  id?: string;
  cwd?: string;
  isRunning?: () => boolean;
}) {
  return {
    id: options.id ?? "session-target",
    get isRunning() {
      return options.isRunning?.() ?? false;
    },
    session: {
      resourceLoader: {
        getExtensions: () => ({
          extensions: [extension(options.extensionFile, options.baseDir)],
          errors: [],
        }),
        getSkills: () => ({ skills: [skill(options.skillFile, options.baseDir)] }),
      },
      settingsManager: options.settingsManager,
      sessionManager: { getCwd: () => options.cwd ?? "/workspace/target" },
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

test("serializes Extension, Skill, and Package mutations through one shared coordinator", async () => {
  const baseDir = path.join("/virtual", "pi-agent");
  const extensionFile = path.join(baseDir, "extensions", "review.ts");
  const skillFile = path.join(baseDir, "skills", "review-skill", "SKILL.md");
  const settingsManager = resourceSettingsManager();
  let activeReloads = 0;
  let maximumActiveReloads = 0;
  let reloadStarts = 0;
  const reload = async () => {
    activeReloads += 1;
    reloadStarts += 1;
    maximumActiveReloads = Math.max(maximumActiveReloads, activeReloads);
    await new Promise<void>((resolve) => setImmediate(resolve));
    activeReloads -= 1;
  };
  const host = targetSession({ settingsManager, extensionFile, skillFile, baseDir, reload });
  const mutationCoordinator = new PiResourceMutationCoordinator({
    getLoadedSessions: () => [host],
  });
  const extensionService = new ExtensionService({
    getSession: async () => host,
    mutationCoordinator,
  });
  const skillService = new SkillService({ getSession: async () => host, mutationCoordinator });
  const packageService = new InstalledPackageService({
    mutationCoordinator,
    installUserPackage: async () => undefined,
  });

  const results = await Promise.allSettled([
    extensionService.setEnabled(extensionToggle(extensionFile)),
    skillService.setEnabled(skillToggle),
    packageService.install(packageInstall),
  ]);

  assert.equal(reloadStarts, 3);
  assert.equal(maximumActiveReloads, 1);
  assert.deepEqual(
    results.map((result) => result.status),
    ["fulfilled", "fulfilled", "fulfilled"],
  );
  const globalSettings = settingsManager.getGlobalSettings();
  assert.deepEqual(globalSettings.extensions, ["-extensions/review.ts"]);
  assert.deepEqual(globalSettings.skills, ["-skills/review-skill/SKILL.md"]);
});

test("user Extension, Skill, and Package mutations reload every loaded session", async () => {
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
  const otherHost = {
    id: "session-other",
    isRunning: false,
    session: {
      sessionManager: { getCwd: () => "/workspace/other" },
      reload: async () => {
        reloaded.push("session-other");
      },
    },
  };
  const mutationCoordinator = new PiResourceMutationCoordinator({
    getLoadedSessions: () => [host, otherHost],
  });
  const extensionService = new ExtensionService({
    getSession: async () => host,
    mutationCoordinator,
  });
  const skillService = new SkillService({ getSession: async () => host, mutationCoordinator });
  const packageService = new InstalledPackageService({
    mutationCoordinator,
    getLoadedSessions: () => [host, otherHost],
    installUserPackage: async () => undefined,
  });

  await extensionService.setEnabled(extensionToggle(extensionFile));
  await skillService.setEnabled(skillToggle);
  await packageService.install(packageInstall);

  assert.equal(reloaded.filter((id) => id === "session-target").length, 3);
  assert.equal(reloaded.filter((id) => id === "session-other").length, 3);
});

test("project mutations reload only sessions from the canonical project", async () => {
  const reloaded: string[] = [];
  const loadedSession = (id: string, cwd: string) => ({
    id,
    isRunning: false,
    session: {
      sessionManager: { getCwd: () => cwd },
      reload: async () => {
        reloaded.push(id);
      },
    },
  });
  const mutationCoordinator = new PiResourceMutationCoordinator({
    getLoadedSessions: () => [
      loadedSession("project-main", "/workspace/project"),
      loadedSession("project-alias", "/workspace/project/../project"),
      loadedSession("project-other", "/workspace/other"),
    ],
  });

  await mutationCoordinator.mutate({ scope: "project", cwd: "/workspace/project/." }, async () => ({
    value: undefined,
    reload: true,
  }));

  assert.deepEqual(reloaded.sort(), ["project-alias", "project-main"]);
});

test("canonical project aliases share a lock while unrelated projects remain independent", async () => {
  const mutationCoordinator = new PiResourceMutationCoordinator({
    getLoadedSessions: () => [],
  });
  const calls: string[] = [];
  let releaseFirst!: () => void;
  let markFirstStarted!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const first = mutationCoordinator.mutate(
    { scope: "project", cwd: "/workspace/project" },
    async () => {
      calls.push("first:start");
      markFirstStarted();
      await firstGate;
      calls.push("first:end");
      return { value: undefined, reload: false };
    },
  );
  await firstStarted;
  const alias = mutationCoordinator.mutate(
    { scope: "project", cwd: "/workspace/project/../project" },
    async () => {
      calls.push("alias");
      return { value: undefined, reload: false };
    },
  );
  const unrelated = mutationCoordinator.mutate(
    { scope: "project", cwd: "/workspace/other" },
    async () => {
      calls.push("unrelated");
      return { value: undefined, reload: false };
    },
  );

  await unrelated;
  assert.deepEqual(calls, ["first:start", "unrelated"]);

  releaseFirst();
  await Promise.all([first, alias]);
  assert.deepEqual(calls, ["first:start", "unrelated", "first:end", "alias"]);
});

test("keeps the resource mutation locked through post-reload cleanup", async () => {
  const mutationCoordinator = new PiResourceMutationCoordinator({
    getLoadedSessions: () => [],
  });
  const calls: string[] = [];
  let releaseCleanup!: () => void;
  let markCleanupStarted!: () => void;
  const cleanupStarted = new Promise<void>((resolve) => {
    markCleanupStarted = resolve;
  });
  const cleanupPending = new Promise<void>((resolve) => {
    releaseCleanup = resolve;
  });

  const first = mutationCoordinator.mutate({ scope: "user" }, async () => ({
    value: undefined,
    reload: true,
    afterReload: async () => {
      calls.push("cleanup:start");
      markCleanupStarted();
      await cleanupPending;
      calls.push("cleanup:end");
    },
  }));
  await cleanupStarted;

  const second = mutationCoordinator.mutate({ scope: "user" }, async () => {
    calls.push("next-mutation");
    return { value: undefined, reload: false };
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["cleanup:start"]);

  releaseCleanup();
  await Promise.all([first, second]);
  assert.deepEqual(calls, ["cleanup:start", "cleanup:end", "next-mutation"]);
});

test("a queued mutation rechecks busy sessions before changing settings", async () => {
  let busy = false;
  let releaseFirst!: () => void;
  let markFirstStarted!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const installations: string[] = [];
  const loadedHost = {
    id: "session-target",
    get isRunning() {
      return busy;
    },
    session: {
      sessionManager: { getCwd: () => "/workspace/target" },
      reload: async () => {
        busy = true;
      },
    },
  };
  const mutationCoordinator = new PiResourceMutationCoordinator({
    getLoadedSessions: () => [loadedHost],
  });
  const packageService = new InstalledPackageService({
    mutationCoordinator,
    installUserPackage: async (_sessionId, source) => {
      installations.push(source);
      if (source !== "npm:first-package") return;
      markFirstStarted();
      await firstGate;
    },
  });

  const first = packageService.install({
    name: "first-package",
    target: { scope: "user", sessionId: "session-target" },
  });
  await firstStarted;
  const second = packageService.install({
    name: "second-package",
    target: { scope: "user", sessionId: "session-target" },
  });
  const secondRejected = assert.rejects(second, (error: unknown) => {
    assert.ok(error instanceof InstalledPackageServiceError);
    assert.equal(error.code, "session-busy");
    assert.deepEqual(error.details, { sessionId: "session-target" });
    return true;
  });

  releaseFirst();
  await Promise.all([first, secondRejected]);
  assert.deepEqual(installations, ["npm:first-package"]);
});

test("Workbench busy state blocks mutation after Pi running has settled", async () => {
  const loadedHost = {
    id: "session-cleanup",
    isRunning: false,
    isBusy: true,
    session: {
      sessionManager: { getCwd: () => "/workspace/target" },
      reload: async () => undefined,
    },
  };
  const mutationCoordinator = new PiResourceMutationCoordinator({
    getLoadedSessions: () => [loadedHost],
  });

  await assert.rejects(
    mutationCoordinator.mutate({ scope: "user" }, async () => ({
      value: undefined,
      reload: false,
    })),
    (error: unknown) => {
      assert.ok(error instanceof PiResourceMutationBusyError);
      assert.equal(error.sessionId, loadedHost.id);
      return true;
    },
  );
});

test("an already-matching Extension state does not reload sessions", async () => {
  const baseDir = path.join("/virtual", "pi-agent");
  const extensionFile = path.join(baseDir, "extensions", "review.ts");
  const skillFile = path.join(baseDir, "skills", "review-skill", "SKILL.md");
  const settingsManager = resourceSettingsManager();
  let reloadCount = 0;
  const host = targetSession({
    settingsManager,
    extensionFile,
    skillFile,
    baseDir,
    reload: async () => {
      reloadCount += 1;
    },
  });
  const mutationCoordinator = new PiResourceMutationCoordinator({
    getLoadedSessions: () => [host],
  });
  const extensionService = new ExtensionService({
    getSession: async () => host,
    mutationCoordinator,
  });

  assert.deepEqual(
    await extensionService.setEnabled({ ...extensionToggle(extensionFile), enabled: true }),
    { name: "review", filePath: extensionFile, enabled: true },
  );
  assert.equal(reloadCount, 0);
});

test("a queued Skill mutation rejects when the same name resolves to another identity", async () => {
  const baseDir = path.join("/virtual", "pi-agent");
  const initialSkillFile = path.join(baseDir, "skills", "review-skill", "SKILL.md");
  const replacementBaseDir = path.join("/virtual", "replacement-agent");
  const replacementSkillFile = path.join(replacementBaseDir, "skills", "review-skill", "SKILL.md");
  const settingsManager = resourceSettingsManager();
  let currentSkill = skill(initialSkillFile, baseDir);
  let markInitialRead!: () => void;
  const initialRead = new Promise<void>((resolve) => {
    markInitialRead = resolve;
  });
  let skillReadCount = 0;
  let reloadCount = 0;
  const host = {
    id: "session-target",
    isRunning: false,
    session: {
      resourceLoader: {
        getSkills: () => {
          skillReadCount += 1;
          if (skillReadCount === 1) markInitialRead();
          return { skills: [currentSkill] };
        },
      },
      settingsManager,
      sessionManager: { getCwd: () => "/workspace/target" },
      reload: async () => {
        reloadCount += 1;
      },
    },
  };
  const mutationCoordinator = new PiResourceMutationCoordinator({
    getLoadedSessions: () => [host],
  });
  let releaseBlocker!: () => void;
  let markBlockerStarted!: () => void;
  const blockerStarted = new Promise<void>((resolve) => {
    markBlockerStarted = resolve;
  });
  const blockerGate = new Promise<void>((resolve) => {
    releaseBlocker = resolve;
  });
  const blocker = mutationCoordinator.mutate({ scope: "user" }, async () => {
    markBlockerStarted();
    await blockerGate;
    return { value: undefined, reload: false };
  });
  await blockerStarted;
  const skillService = new SkillService({ getSession: async () => host, mutationCoordinator });
  const pending = skillService.setEnabled(skillToggle);
  await initialRead;
  currentSkill = skill(replacementSkillFile, replacementBaseDir);
  const rejected = assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof SkillServiceError);
    assert.equal(error.code, "skill-not-found");
    return true;
  });

  releaseBlocker();
  await Promise.all([blocker, rejected]);
  assert.equal(reloadCount, 0);
  assert.equal(settingsManager.getGlobalSettings().skills, undefined);
});
