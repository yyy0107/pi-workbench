const path = require("node:path");

const electron = require("electron");
const {
  readDesktopSettings,
  createDesktopServices,
  applyRuntimeTerminalShell,
  runtimeHasActiveTasks,
} = require("./desktop-services.cjs");
const { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, protocol, session, shell } =
  electron;
const {
  createPackagedSmokeOwnerReporter,
  startPackagedWorkbenchRuntime,
} = require("./packaged-runtime-lifecycle.cjs");
const {
  DESKTOP_RENDERER_ORIGIN,
  DESKTOP_RENDERER_SCHEME,
  assertDesktopRendererDevelopmentResponse,
  createDesktopRendererProtocolHandler,
} = require("./desktop-renderer-protocol.cjs");
const { copyTitleBarOverlayOptions } = require("./title-bar-overlay.cjs");
const { resolveDesktopArtifactSupport } = require("./runtime-artifact-environment.cjs");

const RUNTIME_BOOTSTRAP_CHANNEL = "workbench:runtime-bootstrap";
const RUNTIME_RESTART_CHANNEL = "workbench:runtime-restart";
const TITLE_BAR_OVERLAY_CHANNEL = "workbench:title-bar-overlay";
protocol.registerSchemesAsPrivileged([
  {
    scheme: DESKTOP_RENDERER_SCHEME,
    privileges: {
      corsEnabled: true,
      secure: true,
      standard: true,
      supportFetchAPI: true,
    },
  },
]);

let isQuitting = false;
let currentWorkbenchUrl;
let mainWindow;
let packagedRuntimeSession;
let rendererRuntimeConnection;
let runtimeConfiguration;
let runtimeReady = false;
let runtimeRestartPromise;
let runtimeStartPromise;
let runtimeStartupCleanup;
let runtimeStopComplete = false;
let rendererProtocolInstalled = false;
let quitPreparation;
let rendererTitleBarOverlayOptions;
let desktopSettings;
let desktopSettingsError;
try {
  desktopSettings = readDesktopSettings(app);
  if (!desktopSettings.preferences.hardwareAcceleration) app.disableHardwareAcceleration();
} catch (error) {
  desktopSettingsError = error;
}
const desktopServices = desktopSettings
  ? createDesktopServices(electron, {
      settings: desktopSettings,
      isTrusted: isTrustedMainFrameEvent,
      getWindow: () => mainWindow,
      applyTerminalShell: (shell) =>
        applyRuntimeTerminalShell(rendererRuntimeConnection, shell, (url, options) =>
          net.fetch(url, options),
        ),
      hasActiveTasks: () =>
        runtimeHasActiveTasks(rendererRuntimeConnection, (url, options) => net.fetch(url, options)),
      onInstallFailed() {
        app.relaunch();
        app.quit();
      },
      async beforeInstall() {
        isQuitting = true;
        await Promise.allSettled([runtimeStartPromise, runtimeRestartPromise]);
        await stopWorkbenchRuntime();
        runtimeStopComplete = true;
        desktopServices.dispose();
      },
    })
  : undefined;

function titleBarOverlayOptions() {
  if (rendererTitleBarOverlayOptions) return rendererTitleBarOverlayOptions;
  return {
    color: "#00000000",
    symbolColor: nativeTheme.shouldUseDarkColors ? "#fafafa" : "#18181b",
  };
}

ipcMain.on(TITLE_BAR_OVERLAY_CHANNEL, (event, options) => {
  const validatedOptions = copyTitleBarOverlayOptions(options);
  if (
    process.platform === "darwin" ||
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame ||
    !validatedOptions
  ) {
    return;
  }

  rendererTitleBarOverlayOptions = validatedOptions;
  mainWindow.setTitleBarOverlay(validatedOptions);
});

function isTrustedMainFrameEvent(event) {
  if (
    !currentWorkbenchUrl ||
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame
  ) {
    return false;
  }
  try {
    return navigationOrigin(event.senderFrame.url) === navigationOrigin(currentWorkbenchUrl);
  } catch {
    return false;
  }
}

ipcMain.on(RUNTIME_BOOTSTRAP_CHANNEL, (event) => {
  const response =
    rendererRuntimeConnection && isTrustedMainFrameEvent(event)
      ? rendererRuntimeConnection
      : undefined;
  // `returnValue` replies immediately to sendSync, so it must be assigned exactly once after
  // every trust check has completed.
  event.returnValue = response;
});

function parseExplicitLoopbackOrigin(name) {
  const value = process.env[name]?.trim();
  try {
    const origin = new URL(value);
    const port = Number(origin.port);
    if (
      origin.protocol !== "http:" ||
      origin.hostname !== "127.0.0.1" ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65_535 ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash ||
      origin.origin !== value
    ) {
      throw new Error();
    }
    return origin.origin;
  } catch {
    throw new Error(`${name} must be a canonical loopback HTTP origin.`);
  }
}

function navigationOrigin(rawUrl) {
  const url = new URL(rawUrl);
  return url.origin === "null" ? `${url.protocol}//${url.host}` : url.origin;
}

function isTrustedClipboardWrite(webContents, permission, requestingUrl, isMainFrame) {
  if (
    permission !== "clipboard-sanitized-write" ||
    !isMainFrame ||
    !currentWorkbenchUrl ||
    !mainWindow ||
    mainWindow.isDestroyed() ||
    webContents !== mainWindow.webContents
  ) {
    return false;
  }
  try {
    return navigationOrigin(requestingUrl) === navigationOrigin(currentWorkbenchUrl);
  } catch {
    return false;
  }
}

function stopWorkbenchRuntime() {
  runtimeReady = false;
  rendererRuntimeConnection = undefined;
  const sessionToStop = packagedRuntimeSession;
  if (!sessionToStop) return runtimeStartupCleanup?.() ?? Promise.resolve();
  return sessionToStop.stop().finally(() => {
    if (packagedRuntimeSession === sessionToStop) packagedRuntimeSession = undefined;
  });
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
  const workbenchOrigin = navigationOrigin(workbenchUrl);
  const iconPath = app.isPackaged
    ? path.join(app.getAppPath(), "public", "app-icon.png")
    : path.resolve(app.getAppPath(), "..", "desktop-renderer", "public", "app-icon.png");
  if (process.platform === "darwin") app.dock.setIcon(iconPath);
  rendererTitleBarOverlayOptions = undefined;
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 480,
    minHeight: 640,
    icon: iconPath,
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
      if (navigationOrigin(url) === workbenchOrigin) return;
    } catch {
      // Invalid navigation targets are denied below.
    }
    event.preventDefault();
    openExternalUrl(url, workbenchOrigin);
  });
  window.on("close", (event) => {
    if (process.platform === "darwin" && !isQuitting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.once("ready-to-show", () => window.show());
  window.once("closed", () => {
    if (mainWindow === window) mainWindow = undefined;
  });
  // Install the trusted-window identity before navigation can execute preload's synchronous
  // Runtime bootstrap request.
  mainWindow = window;
  void window.loadURL(workbenchUrl).catch((error) => {
    console.error("Could not load Workbench.", error);
    if (!isQuitting) {
      stopRendererRequestIntake();
      app.quit();
    }
  });
  if (process.env.WORKBENCH_OPEN_DEVTOOLS === "1") {
    window.webContents.openDevTools();
  }

  return window;
}

function stopRendererRequestIntake() {
  const window = mainWindow;
  if (!window || window.isDestroyed()) return;
  mainWindow = undefined;
  window.destroy();
}

function startWorkbenchRuntime() {
  if (!runtimeConfiguration) {
    return Promise.reject(new Error("Workbench Runtime configuration is unavailable."));
  }
  if (runtimeStartPromise) return runtimeStartPromise;
  const starting = (async () => {
    // A failed startup can retain a cleanup obligation; satisfy it before spawning again.
    await runtimeStartupCleanup?.();
    runtimeStartupCleanup = undefined;
    return startPackagedWorkbenchRuntime({
      ...runtimeConfiguration,
      environment: desktopServices.environment,
      beforeStop: stopRendererRequestIntake,
      onUnexpectedExit(error) {
        if (isQuitting) return;
        runtimeReady = false;
        rendererRuntimeConnection = undefined;
        console.error("Workbench Runtime exited unexpectedly.", error);
        desktopServices.showRuntimeError(error);
      },
    });
  })();
  const tracked = starting
    .catch((error) => {
      if (error?.code === "WORKBENCH_RUNTIME_CLEANUP_FAILED") {
        runtimeStartupCleanup = error.cleanup;
      }
      throw error;
    })
    .finally(() => {
      if (runtimeStartPromise === tracked) runtimeStartPromise = undefined;
    });
  runtimeStartPromise = tracked;
  return tracked;
}

function installPackagedRendererProtocol(runtimeSession) {
  if (rendererProtocolInstalled) {
    protocol.unhandle(DESKTOP_RENDERER_SCHEME);
    rendererProtocolInstalled = false;
  }
  protocol.handle(
    DESKTOP_RENDERER_SCHEME,
    createDesktopRendererProtocolHandler(runtimeSession.rendererArtifact, {
      fetchFile: (url) => net.fetch(url),
      runtimeOrigin: runtimeSession.runtimeConnection.httpOrigin,
    }),
  );
  rendererProtocolInstalled = true;
}

async function restartWorkbenchRuntime() {
  const previousSession = packagedRuntimeSession;
  const previousInstanceId =
    rendererRuntimeConnection?.instanceId ?? previousSession?.runtimeConnection.instanceId;
  if (!runtimeConfiguration || !currentWorkbenchUrl) {
    throw new Error("Workbench Runtime restart is unavailable.");
  }

  runtimeReady = false;
  rendererRuntimeConnection = undefined;
  if (previousSession) await previousSession.drainForRestart();
  if (packagedRuntimeSession === previousSession) packagedRuntimeSession = undefined;
  if (isQuitting) return;

  const nextSession = await startWorkbenchRuntime();
  packagedRuntimeSession = nextSession;
  if (nextSession.runtimeConnection.instanceId === previousInstanceId) {
    throw new Error("Workbench Runtime restart did not publish a new generation.");
  }
  if (isQuitting) {
    await stopWorkbenchRuntime();
    return;
  }
  if (app.isPackaged) installPackagedRendererProtocol(nextSession);
  rendererRuntimeConnection = nextSession.runtimeConnection;
  await desktopServices.synchronizeTerminalShell();
  runtimeReady = true;
}

function scheduleWorkbenchRuntimeRestart() {
  runtimeRestartPromise ??= restartWorkbenchRuntime()
    .catch((error) => {
      if (isQuitting) throw error;
      console.error("Could not restart Workbench Runtime.", error);
      desktopServices.showRuntimeError(error);
      throw error;
    })
    .finally(() => {
      runtimeRestartPromise = undefined;
    });
  return runtimeRestartPromise;
}

ipcMain.handle(RUNTIME_RESTART_CHANNEL, (event) => {
  if (isQuitting || !runtimeConfiguration || !isTrustedMainFrameEvent(event)) {
    throw new Error("Workbench Runtime restart is unavailable.");
  }
  return scheduleWorkbenchRuntimeRestart();
});

async function bootstrap() {
  if (desktopSettingsError) throw desktopSettingsError;
  await desktopServices.start();
  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) =>
      isTrustedClipboardWrite(
        webContents,
        permission,
        details.requestingUrl ?? requestingOrigin,
        details.isMainFrame,
      ),
  );
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      callback(
        isTrustedClipboardWrite(
          webContents,
          permission,
          details.requestingUrl,
          details.isMainFrame,
        ),
      );
    },
  );

  const rendererOrigin = app.isPackaged
    ? DESKTOP_RENDERER_ORIGIN
    : parseExplicitLoopbackOrigin("WORKBENCH_DESKTOP_RENDERER_ORIGIN");
  const runtimeDirectory = app.isPackaged
    ? path.join(process.resourcesPath, "desktop-runtime")
    : path.resolve(app.getAppPath(), "../..", ".desktop-build");
  const supportPath = resolveDesktopArtifactSupport(runtimeDirectory).supportPath;
  runtimeConfiguration = Object.freeze({
    runtimeDirectory,
    supportPath,
    rendererOrigin,
    reportOwner: createPackagedSmokeOwnerReporter(),
  });
  packagedRuntimeSession = await startWorkbenchRuntime();
  if (isQuitting) {
    await stopWorkbenchRuntime();
    return;
  }
  rendererRuntimeConnection = packagedRuntimeSession.runtimeConnection;
  await desktopServices.synchronizeTerminalShell();

  const workbenchUrl = `${rendererOrigin}/`;
  if (app.isPackaged) {
    installPackagedRendererProtocol(packagedRuntimeSession);
  } else {
    const response = await net.fetch(workbenchUrl, { redirect: "error" });
    await assertDesktopRendererDevelopmentResponse(response);
    console.log(`> Electron connected to the explicit Desktop renderer at ${rendererOrigin}`);
  }
  if (isQuitting) {
    await stopWorkbenchRuntime();
    return;
  }

  currentWorkbenchUrl = workbenchUrl;
  runtimeReady = true;
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
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      return;
    }
    if (BrowserWindow.getAllWindows().length === 0 && runtimeReady && currentWorkbenchUrl) {
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
  app.on("before-quit", (event) => {
    isQuitting = true;
    desktopServices?.dispose();
    if (runtimeStopComplete) return;

    event.preventDefault();
    stopRendererRequestIntake();
    quitPreparation ??= Promise.allSettled([runtimeStartPromise, runtimeRestartPromise])
      .then(stopWorkbenchRuntime)
      .catch((error) => {
        console.error("Could not stop the Workbench Runtime cleanly.", error);
      })
      .finally(() => {
        runtimeStopComplete = true;
        app.quit();
      });
  });

  app
    .whenReady()
    .then(bootstrap)
    .catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox(
        "Pi Workbench",
        `无法启动桌面应用。\n\nCould not start the desktop application.\n\n${detail}`,
      );
      app.quit();
    });
}
