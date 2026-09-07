const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const DEFAULTS = Object.freeze({
  hardwareAcceleration: true,
  keepAwake: false,
  previewUpdates: false,
  automaticUpdates: false,
  taskNotifications: true,
  notificationSounds: true,
  notificationSound: "chime",
  terminalShell: "powershell",
  httpProxy: "",
  noProxy: "",
});
const LOOPBACK_BYPASS = "localhost,127.0.0.1,::1";

function validatePreferences(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid-settings");
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (!Object.hasOwn(DEFAULTS, key) || typeof item !== typeof DEFAULTS[key])
      throw new Error("invalid-settings");
    result[key] = typeof item === "string" ? item.trim() : item;
  }
  if (
    result.notificationSound !== undefined &&
    !["chime", "soft", "bell", "droplet"].includes(result.notificationSound)
  )
    throw new Error("invalid-settings");
  if (
    result.terminalShell !== undefined &&
    !["powershell", "command-prompt", "git-bash", "wsl"].includes(result.terminalShell)
  )
    throw new Error("invalid-settings");
  if (result.httpProxy) {
    if (result.httpProxy.length > 4096) throw new Error("invalid-proxy");
    let url;
    try {
      url = new URL(result.httpProxy);
    } catch {
      throw new Error("invalid-proxy");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error("invalid-proxy");
    result.httpProxy = url.origin;
  }
  if (
    result.noProxy &&
    (result.noProxy.length > 4096 || !/^[a-zA-Z0-9.*:[\]_,-]+$/u.test(result.noProxy))
  )
    throw new Error("invalid-bypass");
  return result;
}

function readDesktopSettings(app) {
  const file = path.join(app.getPath("userData"), "desktop-settings.json");
  let document = {};
  try {
    document = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const { updateToken, ...preferences } = document;
  if (updateToken !== undefined && typeof updateToken !== "string")
    throw new Error("invalid-settings");
  return { file, preferences: { ...DEFAULTS, ...validatePreferences(preferences) }, updateToken };
}

/** Build the explicit environment shared by desktop-owned outbound processes. */
function proxyEnvironment(environment, preferences, platform = process.platform) {
  const result = { ...environment };
  delete result.PI_WORKBENCH_UPDATE_TOKEN;
  for (const key of Object.keys(result)) {
    if (/^(http_proxy|https_proxy|all_proxy|no_proxy)$/iu.test(key)) delete result[key];
  }
  if (preferences.httpProxy) {
    result.HTTP_PROXY = result.HTTPS_PROXY = preferences.httpProxy;
    result.http_proxy = result.https_proxy = preferences.httpProxy;
  }
  result.NO_PROXY = result.no_proxy = [LOOPBACK_BYPASS, preferences.noProxy]
    .filter(Boolean)
    .join(",");
  if (platform === "win32") result.PI_WORKBENCH_TERMINAL_SHELL_PROFILE = preferences.terminalShell;
  return result;
}

async function applyRuntimeTerminalShell(connection, shell, fetchImpl = fetch) {
  if (!connection) throw new Error("terminal-shell-unavailable");
  const rpcId = `desktop-terminal-shell:${randomUUID()}`;
  const method = "terminal.setDefaultShell";
  const response = await fetchImpl(`${connection.httpOrigin}/api/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${connection.accessToken}`,
    },
    body: JSON.stringify({ type: "client-request", rpcId, method, payload: { shell } }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("terminal-shell-unavailable");
  const result = await response.json();
  if (
    result.type !== "server-response" ||
    result.rpcId !== rpcId ||
    result.result?.ok !== true ||
    result.result.value?.shell !== shell
  ) {
    throw new Error("terminal-shell-unavailable");
  }
}

/** Recheck authoritative state, including hidden sessions, immediately before update installation. */
async function runtimeHasActiveTasks(connection, fetchImpl = fetch) {
  if (!connection) return true;
  try {
    const response = await fetchImpl(`${connection.httpOrigin}/api/session.list`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${connection.accessToken}`,
      },
      body: JSON.stringify({
        type: "client-request",
        rpcId: "desktop-update-activity",
        method: "session.list",
        payload: {},
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return true;
    const body = await response.json();
    const value = body.result?.ok === true ? body.result.value : undefined;
    if (
      !Array.isArray(value?.items) ||
      (value.runningSessionIds !== undefined && !Array.isArray(value.runningSessionIds))
    )
      return true;
    return (
      (value.runningSessionIds?.length ?? 0) > 0 ||
      value.items.some(
        (item) =>
          typeof item.running !== "boolean" || item.running || item.waitingForUserInput === true,
      )
    );
  } catch {
    return true;
  }
}

function createDesktopServices(
  electron,
  {
    settings,
    isTrusted,
    getWindow,
    beforeInstall,
    onInstallFailed = () => {},
    getUpdater = () => require("electron-updater").autoUpdater,
    hasActiveTasks = async () => true,
    applyTerminalShell = async () => {
      throw new Error("terminal-shell-unavailable");
    },
    platform = process.platform,
  },
) {
  const { app, ipcMain, session, powerSaveBlocker, Notification, safeStorage, dialog } = electron;
  const startupPreferences = { ...settings.preferences };
  let preferences = settings.preferences;
  let terminalShellStatus = platform === "win32" ? "applying" : "applied";
  let settingsOperation = Promise.resolve();
  let encryptedToken = settings.updateToken;
  let updater;
  let update = { status: app.isPackaged ? "idle" : "development" };
  let busy = true;
  let lastActivity = 0;
  let tasks;
  let locale = "en-US";
  let blocker;
  let installing = false;
  let operation;
  let interval;
  const notices = new Set();
  const copy = { "en-US": require("./i18n/en-US.cjs"), "zh-CN": require("./i18n/zh-CN.cjs") };
  const snapshot = () => ({
    preferences: { ...preferences },
    update: { ...update },
    version: app.getVersion(),
    platform,
    tokenConfigured: Boolean(encryptedToken || process.env.PI_WORKBENCH_UPDATE_TOKEN),
    terminalShellStatus,
    restartRequired: ["hardwareAcceleration", "httpProxy", "noProxy"].some(
      (key) => startupPreferences[key] !== preferences[key],
    ),
    notificationsSupported: Notification.isSupported(),
  });
  const publish = () => getWindow()?.webContents.send("workbench:desktop-changed", snapshot());
  const setUpdate = (next) => {
    update = next;
    publish();
  };
  function save(next, token = encryptedToken) {
    fs.mkdirSync(path.dirname(settings.file), { recursive: true, mode: 0o700 });
    const temporary = `${settings.file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(
        temporary,
        JSON.stringify({ ...next, ...(token ? { updateToken: token } : {}) }, null, 2),
        { mode: 0o600 },
      );
      fs.chmodSync(temporary, 0o600);
      fs.renameSync(temporary, settings.file);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
    preferences = next;
    encryptedToken = token;
  }
  function applyPower() {
    if (preferences.keepAwake && blocker === undefined)
      blocker = powerSaveBlocker.start("prevent-app-suspension");
    if (!preferences.keepAwake && blocker !== undefined) {
      powerSaveBlocker.stop(blocker);
      blocker = undefined;
    }
  }
  function token() {
    if (encryptedToken) return safeStorage.decryptString(Buffer.from(encryptedToken, "base64"));
    return process.env.PI_WORKBENCH_UPDATE_TOKEN;
  }
  function configureUpdater() {
    if (!updater) return;
    // Credentials are supplied on this machine, never embedded in release artifacts.
    const accessToken = token();
    const {
      PrivateGitHubProvider,
    } = require("electron-updater/out/providers/PrivateGitHubProvider");
    class WorkbenchGitHubProvider extends PrivateGitHubProvider {
      constructor(options, owner, runtimeOptions) {
        super(options, owner, options.token, runtimeOptions);
      }
      getChannelFilePrefix() {
        return `-${process.platform}-${process.arch}${process.platform === "linux" ? "-glibc" : ""}`;
      }
    }
    updater.setFeedURL({
      provider: "custom",
      updateProvider: WorkbenchGitHubProvider,
      owner: "yyy0107",
      repo: "pi-workbench",
      private: true,
      ...(accessToken ? { token: accessToken } : {}),
    });
    updater.allowPrerelease = preferences.previewUpdates;
    updater.allowDowngrade = false;
    updater.autoDownload = preferences.automaticUpdates;
    updater.autoInstallOnAppQuit = false;
    // ponytail: full downloads; enable differential updates when releases include blockmaps.
    updater.disableDifferentialDownload = true;
  }
  async function install(automatic = false) {
    if (installing || update.status !== "downloaded") return;
    installing = true;
    let stopped = false;
    try {
      const active =
        busy || !getWindow() || Date.now() - lastActivity > 30_000 || (await hasActiveTasks());
      if (automatic && active) {
        installing = false;
        return;
      }
      if (active) {
        const result = await dialog.showMessageBox({
          type: "question",
          title: "Pi Workbench",
          message: copy[locale].restart,
          detail: copy[locale].busy,
          buttons: [copy[locale].later, copy[locale].restartNow],
          defaultId: 0,
          cancelId: 0,
        });
        if (result.response !== 1) {
          installing = false;
          return;
        }
      }
      stopped = true;
      await beforeInstall();
      updater.quitAndInstall(false, true);
    } catch {
      installing = false;
      setUpdate({ status: "error", error: "install-failed" });
      if (stopped) onInstallFailed();
    }
  }
  async function runUpdate(action) {
    if (operation) return operation;
    if (!updater) throw new Error("updates-unavailable");
    operation = (async () => {
      if (action === "check") {
        configureUpdater();
        if (!token()) {
          setUpdate({ status: "error", error: "update-token-required" });
          return;
        }
        setUpdate({ status: "checking" });
        await updater.checkForUpdates();
      } else if (action === "download" && update.status === "available") {
        setUpdate({ status: "downloading" });
        await updater.downloadUpdate();
      } else if (action === "install") await install();
      else throw new Error("invalid-update-action");
    })()
      .catch(() => setUpdate({ status: "error", error: "update-failed" }))
      .finally(() => {
        operation = undefined;
      });
    return operation;
  }
  function handle(channel, handler) {
    ipcMain.handle(channel, (event, payload) => {
      if (!isTrusted(event)) throw new Error("untrusted-desktop-request");
      return handler(payload);
    });
  }
  function enqueueSettings(operation) {
    const next = settingsOperation.then(operation);
    settingsOperation = next.catch(() => {});
    return next;
  }
  async function synchronizeTerminalShell() {
    if (platform !== "win32") return;
    terminalShellStatus = "applying";
    publish();
    try {
      await applyTerminalShell(preferences.terminalShell);
      terminalShellStatus = "applied";
    } catch {
      terminalShellStatus = "failed";
    }
    publish();
  }
  handle("workbench:desktop-settings", (patch) => {
    if (patch === undefined) return snapshot();
    const validated = validatePreferences(patch);
    return enqueueSettings(async () => {
      if (operation || installing || update.status === "downloading")
        throw new Error("update-in-progress");
      const next = { ...preferences, ...validated };
      const channelChanged = next.previewUpdates !== preferences.previewUpdates;
      const autoChanged = next.automaticUpdates !== preferences.automaticUpdates;
      save(next);
      if (platform === "win32" && validated.terminalShell !== undefined)
        terminalShellStatus = "applying";
      applyPower();
      if (updater && channelChanged) {
        setUpdate({ status: "idle" });
        void runUpdate("check");
      } else if (updater && autoChanged) {
        updater.autoDownload = preferences.automaticUpdates;
        if (preferences.automaticUpdates && update.status === "available")
          void runUpdate("download");
      }
      publish();
      if (validated.terminalShell !== undefined) await synchronizeTerminalShell();
      return snapshot();
    });
  });
  handle("workbench:desktop-update-token", (value) => {
    if (typeof value !== "string" || value.length > 4096 || /\s/u.test(value))
      throw new Error("invalid-token");
    if (operation || installing || update.status === "downloading")
      throw new Error("update-in-progress");
    if (
      value &&
      (!safeStorage.isEncryptionAvailable() ||
        safeStorage.getSelectedStorageBackend?.() === "basic_text")
    )
      throw new Error("secure-storage-unavailable");
    save(preferences, value ? safeStorage.encryptString(value).toString("base64") : null);
    configureUpdater();
    publish();
    return snapshot();
  });
  handle("workbench:desktop-update", async (action) => {
    if (!["check", "download", "install"].includes(action))
      throw new Error("invalid-update-action");
    await runUpdate(action);
    return snapshot();
  });
  handle("workbench:desktop-task-state", (state) => {
    if (
      !state ||
      typeof state.locale !== "string" ||
      state.locale.length > 64 ||
      !Array.isArray(state.tasks) ||
      state.tasks.length > 10000 ||
      state.tasks.some(
        (task) =>
          !task ||
          typeof task.id !== "string" ||
          task.id.length > 512 ||
          typeof task.title !== "string" ||
          task.title.length > 1000 ||
          [task.running, task.waiting, task.completed, task.failed].some(
            (value) => typeof value !== "boolean",
          ),
      )
    )
      throw new Error("invalid-task-state");
    locale = Object.hasOwn(copy, state.locale) ? state.locale : "en-US";
    const next = new Map(state.tasks.map((task) => [task.id, task]));
    if (tasks && preferences.taskNotifications && Notification.isSupported()) {
      for (const task of next.values()) {
        const previous = tasks.get(task.id);
        const kind =
          task.failed && !previous?.failed
            ? "failed"
            : task.waiting && !previous?.waiting
              ? "waiting"
              : task.completed && !previous?.completed && !task.failed
                ? "completed"
                : undefined;
        if (!kind) continue;
        const notification = new Notification({
          title: copy[locale][kind],
          body: task.title || "Pi Workbench",
          silent: true,
        });
        notices.add(notification);
        notification.once("show", () => {
          if (preferences.taskNotifications && preferences.notificationSounds)
            getWindow()?.webContents.send(
              "workbench:desktop-notification-sound",
              preferences.notificationSound,
            );
        });
        notification.on("close", () => notices.delete(notification));
        notification.on("failed", () => notices.delete(notification));
        notification.on("click", () => {
          const window = getWindow();
          if (window) {
            window.show();
            window.focus();
            window.webContents.send("workbench:desktop-open-task", task.id);
          }
        });
        notification.show();
      }
    }
    tasks = next;
    busy = state.tasks.some((task) => task.running || task.waiting);
    lastActivity = Date.now();
  });
  return {
    showRuntimeError(error) {
      dialog.showErrorBox(
        "Pi Workbench",
        `${copy[locale].runtimeUnavailable}\n\n${copy[locale].runtimeRecovery}\n\n${error instanceof Error ? error.message : String(error)}`,
      );
    },
    get environment() {
      return proxyEnvironment(
        process.env,
        {
          ...startupPreferences,
          terminalShell: preferences.terminalShell,
        },
        platform,
      );
    },
    synchronizeTerminalShell: () => enqueueSettings(synchronizeTerminalShell),
    async start() {
      const proxyConfig = startupPreferences.httpProxy
        ? {
            mode: "fixed_servers",
            proxyRules: startupPreferences.httpProxy,
            proxyBypassRules: [LOOPBACK_BYPASS, startupPreferences.noProxy]
              .filter(Boolean)
              .join(",")
              .replaceAll(",", ";"),
          }
        : { mode: "system" };
      await session.defaultSession.setProxy(proxyConfig);
      applyPower();
      if (app.isPackaged) {
        updater = getUpdater();
        await updater.netSession?.setProxy(proxyConfig);
        updater.logger = null;
        updater.on("error", () => {
          setUpdate({ status: "error", error: "update-failed" });
          if (installing) {
            installing = false;
            onInstallFailed();
          }
        });
        updater.on("update-not-available", () => setUpdate({ status: "current" }));
        updater.on("update-available", (info) =>
          setUpdate({
            status: preferences.automaticUpdates ? "downloading" : "available",
            version: info.version,
          }),
        );
        updater.on("download-progress", (progress) =>
          setUpdate({ status: "downloading", percent: Math.round(progress.percent) }),
        );
        updater.on("update-downloaded", (info) => {
          setUpdate({ status: "downloaded", version: info.version });
          if (preferences.automaticUpdates) void install(true);
        });
        interval = setInterval(
          () => {
            if (update.status !== "downloaded" && update.status !== "downloading")
              void runUpdate("check");
          },
          6 * 60 * 60_000,
        );
        interval.unref();
        void runUpdate("check");
      }
    },
    dispose() {
      if (interval) clearInterval(interval);
      if (blocker !== undefined) {
        powerSaveBlocker.stop(blocker);
        blocker = undefined;
      }
      for (const notice of notices) notice.close();
      notices.clear();
    },
  };
}

module.exports = {
  runtimeHasActiveTasks,
  DEFAULTS,
  readDesktopSettings,
  validatePreferences,
  applyRuntimeTerminalShell,
  proxyEnvironment,
  createDesktopServices,
};
