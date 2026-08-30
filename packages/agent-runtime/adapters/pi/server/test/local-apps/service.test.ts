import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { LocalAppService, LocalAppServiceError } from "../../src/local-apps/service";
import type { DetectedLocalApp, LocalAppLaunchTarget } from "../../src/local-apps/types";

const detectedEditor: DetectedLocalApp = {
  id: "vscode",
  name: "VS Code",
  kind: "editor",
  icon: "vscode",
  supportedFileKinds: ["text"],
  platform: "linux",
  targetMode: "path",
  launcher: { type: "executable", path: "/usr/bin/code" },
};

test("caches detection, refreshes explicitly, and hides launcher details", async () => {
  let detections = 0;
  const service = new LocalAppService({
    detect: async () => {
      detections += 1;
      return [detectedEditor];
    },
  });

  const first = await service.list();
  const second = await service.list();
  assert.equal(detections, 1);
  assert.deepEqual(first, {
    apps: [
      {
        id: "vscode",
        name: "VS Code",
        kind: "editor",
        icon: "vscode",
        supportedFileKinds: ["text"],
      },
    ],
  });
  assert.deepEqual(second, first);
  assert.equal("launcher" in first.apps[0]!, false);

  await service.refresh();
  assert.equal(detections, 2);
});

test("canonicalizes launch targets and derives the containing directory", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-local-apps-"));
  const target = path.join(root, 'literal;$(touch injected)".ts');
  await writeFile(target, "export {};\n");
  t.after(() => rm(root, { recursive: true, force: true }));
  let launched: { app: DetectedLocalApp; target: LocalAppLaunchTarget } | undefined;
  const service = new LocalAppService({
    detect: async () => [detectedEditor],
    launch: async (app, launchTarget) => {
      launched = { app, target: launchTarget };
    },
  });

  assert.deepEqual(await service.open("vscode", target), { opened: true });
  assert.equal(launched?.app, detectedEditor);
  assert.deepEqual(launched?.target, {
    path: await realpath(target),
    directory: await realpath(root),
  });
});

test("returns stable domain errors for unavailable apps, targets, and launch failures", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-local-app-errors-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new LocalAppService({
    detect: async () => [detectedEditor],
    launch: async () => {
      throw new Error("spawn failed");
    },
  });

  await assert.rejects(service.open("missing", root), (error: unknown) => {
    assert.ok(error instanceof LocalAppServiceError);
    assert.equal(error.code, "local-app-not-found");
    assert.deepEqual(error.details, { appId: "missing" });
    return true;
  });
  await assert.rejects(service.open("vscode", path.join(root, "missing")), (error: unknown) => {
    assert.ok(error instanceof LocalAppServiceError);
    assert.equal(error.code, "local-app-target-unreadable");
    return true;
  });
  await assert.rejects(service.open("vscode", root), (error: unknown) => {
    assert.ok(error instanceof LocalAppServiceError);
    assert.equal(error.code, "local-app-launch-failed");
    return true;
  });
});
