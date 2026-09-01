const { contextBridge, ipcRenderer } = require("electron");

const { copyTitleBarOverlayOptions } = require("./title-bar-overlay.cjs");

const TITLE_BAR_OVERLAY_CHANNEL = "workbench:title-bar-overlay";
const RUNTIME_BOOTSTRAP_CHANNEL = "workbench:runtime-bootstrap";
const RUNTIME_RESTART_CHANNEL = "workbench:runtime-restart";

function setTitleBarOverlay(options) {
  const validated = copyTitleBarOverlayOptions(options);
  if (!validated) return;
  ipcRenderer.send(TITLE_BAR_OVERLAY_CHANNEL, validated);
}

// The renderer receives a capability, not ipcRenderer. Main still validates the
// sender, frame, and payload before applying any native window change.
contextBridge.exposeInMainWorld(
  "workbenchDesktop",
  Object.freeze({
    lifecycle: Object.freeze({
      restartRuntime: () => ipcRenderer.invoke(RUNTIME_RESTART_CHANNEL),
    }),
    runtime: Object.freeze({
      bootstrap: () => ipcRenderer.sendSync(RUNTIME_BOOTSTRAP_CHANNEL),
    }),
    titleBar: Object.freeze({ setOverlay: setTitleBarOverlay }),
  }),
);
