// Run with Electron; on headless Linux, prefix the command with xvfb-run -a.
const assert = require("node:assert/strict");
const { app, BrowserWindow } = require("electron");
const { copyTitleBarOverlayOptions } = require("../src/title-bar-overlay.cjs");

app.whenReady().then(() => {
  try {
    const overlay = copyTitleBarOverlayOptions({ color: "#00000000", symbolColor: "#fafafa" });
    assert.ok(overlay);
    const window = new BrowserWindow({
      show: false,
      titleBarStyle: "hidden",
      titleBarOverlay: overlay,
    });
    for (const symbolColor of ["#18181b", "#fafafa"]) {
      window.setTitleBarOverlay({ ...overlay, symbolColor });
    }
    window.destroy();
    console.log("Native title-bar transparency and theme colors passed.");
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
