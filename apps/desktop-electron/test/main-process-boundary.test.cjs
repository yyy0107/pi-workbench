const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const mainSource = readFileSync(path.join(__dirname, "..", "src", "main.cjs"), "utf8");
const preloadSource = readFileSync(path.join(__dirname, "..", "src", "preload.cjs"), "utf8");
const projectPackage = JSON.parse(readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));

test("Electron owns one privileged static-renderer origin and one Runtime child", () => {
  assert.match(mainSource, /registerSchemesAsPrivileged/u);
  assert.match(mainSource, /corsEnabled: true/u);
  assert.match(mainSource, /secure: true/u);
  assert.match(mainSource, /standard: true/u);
  assert.match(mainSource, /supportFetchAPI: true/u);
  assert.doesNotMatch(mainSource, /bypassCSP: true/u);
  assert.match(mainSource, /parseExplicitLoopbackOrigin\("WORKBENCH_DESKTOP_RENDERER_ORIGIN"\)/u);
  assert.match(mainSource, /assertDesktopRendererDevelopmentResponse\(response\)/u);
  assert.match(mainSource, /path\.join\(process\.resourcesPath, "desktop-runtime"\)/u);
  assert.match(mainSource, /startPackagedWorkbenchRuntime/u);
  assert.match(mainSource, /protocol\.handle/u);
  assert.doesNotMatch(mainSource, /workbenchSettingsFile|PI_WORKBENCH_SETTINGS_FILE/u);
  assert.doesNotMatch(mainSource, /WORKBENCH_WEB_ORIGIN|WORKBENCH_RUNTIME_ORIGIN|same-origin/u);
});

test("Runtime bootstrap remains a main-frame-only in-memory capability", () => {
  assert.match(mainSource, /event\.senderFrame !== mainWindow\.webContents\.mainFrame/u);
  assert.equal(mainSource.match(/event\.returnValue\s*=/gu)?.length, 1);
  assert.match(
    mainSource,
    /rendererRuntimeConnection && isTrustedMainFrameEvent\(event\)[\s\S]*\? rendererRuntimeConnection/u,
  );
  assert.match(mainSource, /mainWindow = window;\s*void window\.loadURL/u);
  assert.match(
    preloadSource,
    /bootstrap: \(\) => ipcRenderer\.sendSync\(RUNTIME_BOOTSTRAP_CHANNEL\)/u,
  );
  assert.doesNotMatch(preloadSource, /require\(["']\.\//u);
  assert.doesNotMatch(preloadSource, /localStorage|sessionStorage|URLSearchParams|accessToken/u);
});

test("Clipboard writes are limited to the trusted Workbench main frame", () => {
  assert.match(mainSource, /permission !== "clipboard-sanitized-write"/u);
  assert.match(mainSource, /webContents !== mainWindow\.webContents/u);
  assert.match(
    mainSource,
    /navigationOrigin\(requestingUrl\) === navigationOrigin\(currentWorkbenchUrl\)/u,
  );
  assert.match(mainSource, /setPermissionCheckHandler/u);
  assert.match(mainSource, /setPermissionRequestHandler/u);
});

test("Runtime restart is a trusted-frame lifecycle capability with ordered generation replacement", () => {
  assert.match(mainSource, /ipcMain\.handle\(RUNTIME_RESTART_CHANNEL/u);
  assert.match(
    mainSource,
    /event\.sender !== mainWindow\.webContents[\s\S]*event\.senderFrame !== mainWindow\.webContents\.mainFrame/u,
  );
  assert.match(
    preloadSource,
    /lifecycle: Object\.freeze\(\{[\s\S]*restartRuntime: \(\) => ipcRenderer\.invoke\(RUNTIME_RESTART_CHANNEL\)/u,
  );
  const drain = mainSource.indexOf("await previousSession.drainForRestart()");
  const start = mainSource.indexOf("const nextSession = await startWorkbenchRuntime()", drain);
  const publish = mainSource.indexOf(
    "rendererRuntimeConnection = nextSession.runtimeConnection",
    start,
  );
  assert.ok(drain >= 0 && start > drain && publish > start);
  assert.match(mainSource, /installPackagedRendererProtocol\(nextSession\)/u);
  assert.match(
    mainSource,
    /Promise\.allSettled\(\[runtimeStartPromise, runtimeRestartPromise\]\)[\s\S]*\.then\(stopWorkbenchRuntime\)/u,
  );
  assert.match(
    mainSource,
    /const tracked = starting[\s\S]*\.finally[\s\S]*runtimeStartPromise = tracked/u,
  );
  assert.match(
    mainSource,
    /packagedRuntimeSession = await startWorkbenchRuntime\(\);[\s\S]*if \(isQuitting\)/u,
  );
});

test("sandboxed preload delegates title-bar payload validation to the trusted main process", () => {
  assert.match(preloadSource, /ipcRenderer\.send\(TITLE_BAR_OVERLAY_CHANNEL, options\)/u);
  assert.match(mainSource, /const validatedOptions = copyTitleBarOverlayOptions\(options\)/u);
  assert.match(
    mainSource,
    /ipcMain\.on\(TITLE_BAR_OVERLAY_CHANNEL[\s\S]*event\.sender !== mainWindow\.webContents[\s\S]*event\.senderFrame !== mainWindow\.webContents\.mainFrame/u,
  );
});

test("Electron packages the curated renderer/runtime tree as an opaque resource", () => {
  assert.equal(
    projectPackage.build.files.some((pattern) => pattern.includes("desktop-runtime")),
    false,
  );
  assert.equal(projectPackage.build.extraResources, undefined);
  assert.equal(projectPackage.build.files.includes("electron/desktop-renderer-protocol.cjs"), true);
  assert.equal(
    projectPackage.build.files.includes("electron/packaged-runtime-lifecycle.cjs"),
    true,
  );
  assert.equal(projectPackage.build.afterPack, "scripts/after-pack.cjs");
});

test("Electron packages a high-resolution native PNG icon", () => {
  assert.equal(projectPackage.build.icon, "../../.electron-build/app/public/app-icon.png");
  assert.ok(projectPackage.build.files.includes("public/app-icon.png"));
  const icon = readFileSync(path.join(__dirname, "../../desktop-renderer/public/app-icon.png"));
  assert.equal(icon.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(icon.readUInt32BE(16), 1024);
  assert.equal(icon.readUInt32BE(20), 1024);
});
