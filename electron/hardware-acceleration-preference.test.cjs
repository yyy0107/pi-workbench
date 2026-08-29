const assert = require("node:assert/strict");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  readHardwareAccelerationPreference,
  resolveWorkbenchSettingsFile,
} = require("./hardware-acceleration-preference.cjs");

test("resolves the same default and configured Workbench settings locations as the server", () => {
  const homeDirectory = path.join(path.sep, "users", "developer");
  const workingDirectory = path.join(path.sep, "workbench");

  assert.equal(
    resolveWorkbenchSettingsFile({ environment: {}, homeDirectory, workingDirectory }),
    path.join(homeDirectory, ".pi", "agent", "workbench-settings.json"),
  );
  assert.equal(
    resolveWorkbenchSettingsFile({
      environment: { PI_CODING_AGENT_DIR: "~/custom-agent" },
      homeDirectory,
      workingDirectory,
    }),
    path.join(homeDirectory, "custom-agent", "workbench-settings.json"),
  );
  assert.equal(
    resolveWorkbenchSettingsFile({
      environment: { PI_WORKBENCH_SETTINGS_FILE: "config/workbench.json" },
      homeDirectory,
      workingDirectory,
    }),
    path.join(workingDirectory, "config", "workbench.json"),
  );
});

test("disables acceleration only for an explicit false preference", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "workbench-hardware-acceleration-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const settingsFile = path.join(root, "workbench-settings.json");

  writeFileSync(
    settingsFile,
    JSON.stringify({
      version: 1,
      revision: 1,
      preferences: { hardwareAcceleration: false },
    }),
  );
  assert.equal(readHardwareAccelerationPreference(settingsFile), false);

  writeFileSync(
    settingsFile,
    JSON.stringify({
      version: 1,
      revision: 2,
      preferences: { hardwareAcceleration: true },
    }),
  );
  assert.equal(readHardwareAccelerationPreference(settingsFile), true);
});

test("falls back to acceleration when the preference cannot be trusted", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "workbench-hardware-acceleration-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const settingsFile = path.join(root, "workbench-settings.json");

  assert.equal(readHardwareAccelerationPreference(settingsFile), true);
  writeFileSync(settingsFile, "{ invalid json");
  assert.equal(readHardwareAccelerationPreference(settingsFile), true);
  writeFileSync(
    settingsFile,
    JSON.stringify({
      version: 2,
      revision: 0,
      preferences: { hardwareAcceleration: false },
    }),
  );
  assert.equal(readHardwareAccelerationPreference(settingsFile), true);
  writeFileSync(
    settingsFile,
    JSON.stringify({
      version: 1,
      revision: 0,
      preferences: { hardwareAcceleration: "false" },
    }),
  );
  assert.equal(readHardwareAccelerationPreference(settingsFile), true);
});
