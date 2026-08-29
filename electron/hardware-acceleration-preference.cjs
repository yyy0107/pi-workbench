const { readFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const WORKBENCH_SETTINGS_VERSION = 1;

function expandHomeDirectory(value, homeDirectory) {
  if (value === "~") return homeDirectory;
  if (value.startsWith("~/") || (process.platform === "win32" && value.startsWith("~\\"))) {
    return path.join(homeDirectory, value.slice(2));
  }
  return value;
}

function resolveWorkbenchSettingsFile({
  environment = process.env,
  homeDirectory = os.homedir(),
  workingDirectory = process.cwd(),
} = {}) {
  const explicitSettingsFile = environment.PI_WORKBENCH_SETTINGS_FILE?.trim();
  if (explicitSettingsFile) return path.resolve(workingDirectory, explicitSettingsFile);

  const explicitAgentDirectory = environment.PI_CODING_AGENT_DIR;
  const agentDirectory = explicitAgentDirectory
    ? path.resolve(workingDirectory, expandHomeDirectory(explicitAgentDirectory, homeDirectory))
    : path.join(homeDirectory, ".pi", "agent");
  return path.join(agentDirectory, "workbench-settings.json");
}

function readHardwareAccelerationPreference(settingsFile) {
  try {
    const document = JSON.parse(readFileSync(settingsFile, "utf8"));
    if (
      document === null ||
      typeof document !== "object" ||
      Array.isArray(document) ||
      document.version !== WORKBENCH_SETTINGS_VERSION
    ) {
      return true;
    }
    const preferences = document.preferences;
    if (preferences === null || typeof preferences !== "object" || Array.isArray(preferences)) {
      return true;
    }
    return preferences.hardwareAcceleration !== false;
  } catch {
    // A missing or malformed settings document must not make the desktop app unlaunchable.
    return true;
  }
}

module.exports = { readHardwareAccelerationPreference, resolveWorkbenchSettingsFile };
