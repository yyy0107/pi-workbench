// Run with Electron; on headless Linux, prefix the command with xvfb-run -a.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const { app, BrowserWindow, protocol } = require("electron");
const {
  DESKTOP_RENDERER_ORIGIN,
  DESKTOP_RENDERER_SCHEME,
  createDesktopRendererProtocolHandler,
} = require("../src/desktop-renderer-protocol.cjs");

const shellRequire = createRequire(
  path.resolve(__dirname, "../../../packages/workbench/shell/package.json"),
);
const xtermRoot = path.dirname(shellRequire.resolve("@xterm/xterm/package.json"));
const resources = {
  "index.html": [
    "text/html",
    '<!doctype html><link rel="stylesheet" href="/xterm.css"><div id="terminal"></div>' +
      '<p id="inline-style" style="color: rgb(123, 45, 67)">blocked</p>' +
      '<script>globalThis.inlineScriptRan = true</script><script src="/xterm.js"></script>',
  ],
  "xterm.css": ["text/css", readFileSync(path.join(xtermRoot, "css/xterm.css"))],
  "xterm.js": ["text/javascript", readFileSync(path.join(xtermRoot, "lib/xterm.js"))],
};

protocol.registerSchemesAsPrivileged([
  { scheme: DESKTOP_RENDERER_SCHEME, privileges: { standard: true, secure: true } },
]);
app.commandLine.appendSwitch("disable-gpu");
setTimeout(() => {
  console.error("Terminal renderer smoke timed out.");
  app.exit(1);
}, 10_000).unref();

app.whenReady().then(async () => {
  let window;
  try {
    protocol.handle(
      DESKTOP_RENDERER_SCHEME,
      createDesktopRendererProtocolHandler(
        {
          artifactRoot: __dirname,
          manifest: {
            entrypoint: "index.html",
            files: Object.keys(resources).map((resource) => ({ path: resource })),
          },
        },
        {
          runtimeOrigin: "http://127.0.0.1:43102",
          fetchFile(url) {
            const [contentType, body] = resources[path.basename(fileURLToPath(url))];
            return new Response(body, { headers: { "Content-Type": contentType } });
          },
        },
      ),
    );
    window = new BrowserWindow({
      show: true,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    await window.loadURL(`${DESKTOP_RENDERER_ORIGIN}/`);
    const result = await window.webContents.executeJavaScript(`(async () => {
      const terminal = new Terminal({ fontFamily: 'monospace', fontSize: 12,
        theme: { green: '#116329', cursor: '#116329' } });
      terminal.open(document.querySelector('#terminal'));
      terminal.focus();
      await new Promise(resolve => terminal.write('\\x1b[32mgreen\\x1b[0m ', resolve));
      await new Promise(resolve => requestAnimationFrame(resolve));
      const text = document.querySelector('.xterm-fg-2');
      const result = {
        fontFamily: getComputedStyle(text).fontFamily,
        color: getComputedStyle(text).color,
        cursor: getComputedStyle(document.querySelector('.xterm-cursor')).backgroundColor,
        inlineScriptRan: globalThis.inlineScriptRan === true,
        inlineStyleColor: getComputedStyle(document.querySelector('#inline-style')).color,
      };
      terminal.options.theme = { green: '#3fb950' };
      result.updatedColor = getComputedStyle(text).color;
      terminal.dispose();
      return result;
    })()`);
    assert.equal(result.fontFamily, "monospace");
    assert.equal(result.color, "rgb(17, 99, 41)");
    assert.equal(result.cursor, "rgb(17, 99, 41)");
    assert.equal(result.updatedColor, "rgb(63, 185, 80)");
    assert.equal(result.inlineScriptRan, false);
    assert.notEqual(result.inlineStyleColor, "rgb(123, 45, 67)");
    console.log(
      "Terminal font, ANSI colors, cursor and theme updates passed; inline scripts and style attributes remain blocked.",
    );
    window.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    window?.destroy();
    app.exit(1);
  }
});
