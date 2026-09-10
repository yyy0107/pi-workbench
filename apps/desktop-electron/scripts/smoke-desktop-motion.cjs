// Run with Electron, once with each factor: <script> 0.25 and <script> 0.
const assert = require("node:assert/strict");
const { app, BrowserWindow } = require("electron");
const { applyDesktopMotionPreference } = require("../src/desktop-services.cjs");

const factor = process.argv.at(-1);
assert.ok(["0.25", "0"].includes(factor));
applyDesktopMotionPreference(app, {
  platform: "linux",
  environment: { XDG_CURRENT_DESKTOP: "KDE" },
  execute: () => factor,
});

app.whenReady().then(async () => {
  try {
    const window = new BrowserWindow({ show: false });
    await window.loadURL(
      `data:text/html,${encodeURIComponent(`
      <style>
        @keyframes pulse { to { opacity: 0.5; } }
        div { animation: pulse 1s infinite; }
        @media (prefers-reduced-motion: reduce) { div { animation: none; } }
      </style><div>Motion probe</div>
    `)}`,
    );
    const actual = await window.webContents.executeJavaScript(`({
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
      animation: getComputedStyle(document.querySelector('div')).animationName
    })`);
    assert.deepEqual(actual, {
      reduced: factor === "0",
      animation: factor === "0" ? "none" : "pulse",
    });
    window.destroy();
    console.log(`KDE factor ${factor}: CSS and matchMedia agree.`, actual);
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
