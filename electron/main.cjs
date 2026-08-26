const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

const { app, BrowserWindow, dialog, ipcMain, nativeTheme, session, shell } = require("electron");
const { isWorkbenchServer, waitForWorkbenchServer } = require("./server-probe.cjs");

const LOOPBACK_HOST = "127.0.0.1";
const STARTUP_TIMEOUT_MS = 120_000;
const TITLE_BAR_OVERLAY_CHANNEL = "workbench:title-bar-overlay";
const OPAQUE_HEX_COLOR_PATTERN = /^#[\da-f]{6}$/i;

let isQuitting = false;
let currentWorkbenchUrl;
let mainWindow;
let serverProcess;
let serverProcessError;
let serverReady = false;
let rendererTitleBarOverlayOptions;

function titleBarOverlayOptions() {
  if (rendererTitleBarOverlayOptions) return rendererTitleBarOverlayOptions;
  return nativeTheme.shouldUseDarkColors
    ? { color: "#18181b", symbolColor: "#fafafa" }
    : { color: "#ffffff", symbolColor: "#18181b" };
}

function isTitleBarOverlayOptions(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    OPAQUE_HEX_COLOR_PATTERN.test(value.color) &&
    OPAQUE_HEX_COLOR_PATTERN.test(value.symbolColor)
  );
}

ipcMain.on(TITLE_BAR_OVERLAY_CHANNEL, (event, options) => {
  if (
    process.platform === "darwin" ||
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame ||
    !isTitleBarOverlayOptions(options)
  ) {
    return;
  }

  rendererTitleBarOverlayOptions = options;
  mainWindow.setTitleBarOverlay(options);
});

function parseConfiguredPort() {
  const rawPort = process.env.PORT?.trim();
  if (!rawPort) return undefined;

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new RangeError(`PORT must be an integer from 1 to 65535; received ${rawPort}.`);
  }
  return port;
}

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, LOOPBACK_HOST, () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close();
        reject(new Error("Could not allocate a local port for Workbench."));
        return;
      }

      const { port } = address;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function resolveServerPort() {
  const configuredPort = parseConfiguredPort();
  if (configuredPort) return configuredPort;
  return app.isPackaged ? findAvailablePort() : 3000;
}

function startWorkbenchServer(port) {
  const appRoot = app.getAppPath();
  const development = !app.isPackaged;
  const command = development
    ? process.env.WORKBENCH_NODE_BINARY?.trim() || "node"
    : process.execPath;
  const args = development
    ? [require.resolve("tsx/cli"), "watch", path.join(appRoot, "server.ts"), "--dev"]
    : [path.join(appRoot, "electron", "server-runner.cjs")];
  const environment = {
    ...process.env,
    NODE_ENV: development ? "development" : "production",
    PORT: String(port),
    WORKBENCH_HOST: LOOPBACK_HOST,
  };

  if (!development) environment.ELECTRON_RUN_AS_NODE = "1";

  serverProcess = spawn(command, args, {
    cwd: appRoot,
    env: environment,
    stdio: "inherit",
    windowsHide: true,
  });
  serverProcess.once("error", (error) => {
    serverProcessError = error;
  });
  serverProcess.once("exit", (code, signal) => {
    if (isQuitting || !serverReady) return;

    const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
    dialog.showErrorBox(
      "Pi Workbench",
      `本地服务已停止（${reason}）。\n\nThe local server stopped (${reason}).`,
    );
    app.quit();
  });
}

function stopWorkbenchServer() {
  serverReady = false;
  if (serverProcess && serverProcess.exitCode === null && !serverProcess.killed) {
    serverProcess.kill("SIGTERM");
  }
  serverProcess = undefined;
}

async function waitForServer(url) {
  const ready = await waitForWorkbenchServer(url, {
    timeoutMs: STARTUP_TIMEOUT_MS,
    beforeAttempt: () => {
      if (serverProcessError) throw serverProcessError;
      if (!serverProcess || serverProcess.exitCode !== null) {
        throw new Error(
          `Workbench server exited with code ${serverProcess?.exitCode ?? "unknown"}.`,
        );
      }
    },
  });
  if (ready) return;

  throw new Error(`Workbench server did not become ready within ${STARTUP_TIMEOUT_MS / 1_000}s.`);
}

function isExternalWebUrl(rawUrl, workbenchOrigin) {
  try {
    const target = new URL(rawUrl);
    return (
      (target.protocol === "https:" || target.protocol === "http:") &&
      target.origin !== workbenchOrigin
    );
  } catch {
    return false;
  }
}

function openExternalUrl(rawUrl, workbenchOrigin) {
  if (!isExternalWebUrl(rawUrl, workbenchOrigin)) return;
  void shell.openExternal(rawUrl).catch((error) => {
    console.error("Could not open external URL.", error);
  });
}

function createMainWindow(workbenchUrl) {
  const workbenchOrigin = new URL(workbenchUrl).origin;
  rendererTitleBarOverlayOptions = undefined;
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    icon: path.join(app.getAppPath(), "electron", "assets", "icon.png"),
    show: false,
    backgroundColor: "#09090b",
    autoHideMenuBar: process.platform !== "darwin",
    titleBarStyle: "hidden",
    titleBarOverlay: titleBarOverlayOptions(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url, workbenchOrigin);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    try {
      if (new URL(url).origin === workbenchOrigin) return;
    } catch {
      // Invalid navigation targets are denied below.
    }
    event.preventDefault();
    openExternalUrl(url, workbenchOrigin);
  });
  window.once("ready-to-show", () => window.show());
  window.once("closed", () => {
    if (mainWindow === window) mainWindow = undefined;
  });
  void window.loadURL(workbenchUrl).catch((error) => {
    console.error("Could not load Workbench.", error);
  });

  return window;
}

async function bootstrap() {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  const port = await resolveServerPort();
  const workbenchUrl = `http://${LOOPBACK_HOST}:${port}`;
  currentWorkbenchUrl = workbenchUrl;

  if (!app.isPackaged && (await isWorkbenchServer(workbenchUrl))) {
    console.log(`> Electron connected to the existing Workbench at ${workbenchUrl}`);
    serverReady = true;
    mainWindow = createMainWindow(workbenchUrl);
    return;
  }

  startWorkbenchServer(port);
  await waitForServer(workbenchUrl);
  serverReady = true;
  mainWindow = createMainWindow(workbenchUrl);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverReady && currentWorkbenchUrl) {
      mainWindow = createMainWindow(currentWorkbenchUrl);
    }
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  nativeTheme.on("updated", () => {
    if (
      process.platform !== "darwin" &&
      !rendererTitleBarOverlayOptions &&
      mainWindow &&
      !mainWindow.isDestroyed()
    ) {
      mainWindow.setTitleBarOverlay(titleBarOverlayOptions());
    }
  });
  app.on("before-quit", () => {
    isQuitting = true;
    stopWorkbenchServer();
  });

  app
    .whenReady()
    .then(bootstrap)
    .catch((error) => {
      stopWorkbenchServer();
      const detail = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox(
        "Pi Workbench",
        `无法启动桌面应用。\n\nCould not start the desktop application.\n\n${detail}`,
      );
      app.quit();
    });
}
