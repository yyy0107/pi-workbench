// Run with Electron; on headless Linux, prefix the command with xvfb-run -a.
const assert = require("node:assert/strict");
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");
const { getSystemFontFamilies } = require("../src/system-fonts.cjs");

app.commandLine.appendSwitch("disable-gpu");
setTimeout(() => {
  console.error("System font bridge smoke timed out.");
  app.exit(1);
}, 20_000).unref();

app.whenReady().then(async () => {
  let window;
  try {
    window = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.resolve(__dirname, "../src/preload.cjs"),
      },
    });
    ipcMain.handle("workbench:system-fonts", (event) => {
      assert.equal(event.sender, window.webContents);
      assert.equal(event.senderFrame, window.webContents.mainFrame);
      return getSystemFontFamilies();
    });
    await window.loadURL("data:text/html,<p>System fonts</p>");
    const fonts = await window.webContents.executeJavaScript(
      "window.workbenchDesktop.systemFonts.getFontFamilies()",
    );
    assert.ok(fonts.length > 0, "The native font inventory must reach the sandboxed renderer.");
    assert.ok(fonts.every((family) => typeof family === "string" && family.length > 0));
    assert.equal(new Set(fonts).size, fonts.length);
    console.log(`Sandboxed desktop bridge returned ${fonts.length} system font families.`);
    window.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    window?.destroy();
    app.exit(1);
  }
});
