const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { getSystemFontFamilies } = require("../src/system-fonts.cjs");

test("system font queries use bounded native commands and preserve family names", async () => {
  for (const [platform, command] of [
    ["linux", "fc-list"],
    ["darwin", "/usr/bin/osascript"],
    ["win32", "powershell.exe"],
  ]) {
    const fonts = await getSystemFontFamilies({
      platform,
      execute: async (file, args, options) => {
        assert.equal(file, command);
        assert.ok(args.length > 0);
        assert.equal(options.shell, undefined);
        assert.equal(options.encoding, "utf8");
        assert.equal(options.windowsHide, true);
        assert.ok(options.timeout > 0);
        assert.ok(options.maxBuffer > 0);
        if (platform === "linux") assert.deepEqual(args, ["--format", "%{[]family{%{family}\\n}}"]);
        return { stdout: "文泉驿正黑\r\nA, B\n文泉驿正黑\n  Noto Sans  \n" };
      },
    });
    assert.deepEqual(fonts, ["文泉驿正黑", "A, B", "Noto Sans"]);
  }
  await assert.rejects(getSystemFontFamilies({ platform: "unsupported" }), /unavailable/);
  await assert.rejects(
    getSystemFontFamilies({
      platform: "linux",
      execute: async () => {
        throw new Error("timed out");
      },
    }),
    /timed out/,
  );
});

test("real preload routes fonts through the trusted main-frame handler, caching successes and retrying failures", async () => {
  const main = readFileSync(path.join(__dirname, "../src/main.cjs"), "utf8");
  const handlers = new Map();
  const webContents = { mainFrame: { url: "workbench://app/" } };
  const trustedEvent = { sender: webContents, senderFrame: webContents.mainFrame };
  let attempts = 0;
  const context = vm.createContext({
    URL,
    SYSTEM_FONTS_CHANNEL: "workbench:system-fonts",
    currentWorkbenchUrl: "workbench://app/",
    mainWindow: { webContents, isDestroyed: () => false },
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    getSystemFontFamilies: async () => {
      attempts++;
      if (attempts === 1) throw new Error("temporary failure");
      return ["中文字体", "Noto Sans"];
    },
  });
  vm.runInContext(
    main.slice(
      main.indexOf("function navigationOrigin("),
      main.indexOf("function isTrustedClipboardWrite("),
    ) +
      main.slice(
        main.indexOf("function isTrustedMainFrameEvent("),
        main.indexOf("ipcMain.on(RUNTIME_BOOTSTRAP_CHANNEL"),
      ),
    context,
  );
  let bridge;
  vm.runInNewContext(readFileSync(path.join(__dirname, "../src/preload.cjs"), "utf8"), {
    require: (name) => {
      assert.equal(name, "electron");
      return {
        contextBridge: {
          exposeInMainWorld: (name, value) => {
            assert.equal(name, "workbenchDesktop");
            bridge = value;
          },
        },
        ipcRenderer: { invoke: (channel) => handlers.get(channel)(trustedEvent) },
      };
    },
  });
  const handler = handlers.get("workbench:system-fonts");
  assert.throws(() => handler({ sender: {}, senderFrame: webContents.mainFrame }), /unavailable/);
  assert.throws(
    () => handler({ sender: webContents, senderFrame: { url: "workbench://app/" } }),
    /unavailable/,
  );
  webContents.mainFrame.url = "https://example.com/";
  assert.throws(() => handler(trustedEvent), /unavailable/);
  webContents.mainFrame.url = "workbench://app/";
  assert.equal(attempts, 0);
  await assert.rejects(bridge.systemFonts.getFontFamilies(), /temporary failure/);
  const first = bridge.systemFonts.getFontFamilies();
  assert.equal(bridge.systemFonts.getFontFamilies(), first);
  assert.deepEqual(await first, ["中文字体", "Noto Sans"]);
  assert.equal(attempts, 2);
  assert.throws(() => handler({ sender: webContents, senderFrame: {} }), /unavailable/);
});
