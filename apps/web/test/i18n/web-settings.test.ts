import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createExplicitWebWorkbenchSettingsService,
  explicitWebWorkbenchSettingsFile,
} from "@/i18n/web-settings";

test("does not infer a Pi settings directory when Web configuration is absent", () => {
  assert.equal(explicitWebWorkbenchSettingsFile({ configuredFile: "" }), undefined);
  assert.equal(createExplicitWebWorkbenchSettingsService({ configuredFile: "  " }), undefined);
});

test("resolves only an explicitly supplied Web settings file", () => {
  assert.equal(
    explicitWebWorkbenchSettingsFile({
      configuredFile: "config/workbench-settings.json",
      workingDirectory: "/srv/workbench-web",
    }),
    path.resolve("/srv/workbench-web", "config/workbench-settings.json"),
  );
  assert.equal(
    explicitWebWorkbenchSettingsFile({
      configuredFile: "/var/lib/workbench/settings.json",
      workingDirectory: "/ignored",
    }),
    path.resolve("/ignored", "/var/lib/workbench/settings.json"),
  );
});

test("reads missing explicit settings without creating the configured file", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-web-settings-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateFile = path.join(root, "nested", "workbench-settings.json");
  const service = createExplicitWebWorkbenchSettingsService({ configuredFile: stateFile });

  assert.ok(service);
  assert.deepEqual(await service.describe(), { revision: 0, preferences: {} });
  await assert.rejects(readFile(stateFile, "utf8"), { code: "ENOENT" });
});
