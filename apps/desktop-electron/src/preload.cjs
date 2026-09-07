const { contextBridge, ipcRenderer } = require("electron");

const TITLE_BAR_OVERLAY_CHANNEL = "workbench:title-bar-overlay";
const RUNTIME_BOOTSTRAP_CHANNEL = "workbench:runtime-bootstrap";
const RUNTIME_RESTART_CHANNEL = "workbench:runtime-restart";

function setTitleBarOverlay(options) {
  // Sandboxed preload scripts can import Electron, but not arbitrary local modules. Keep payload
  // validation in the main process, which also verifies the sender and main-frame identity.
  ipcRenderer.send(TITLE_BAR_OVERLAY_CHANNEL, options);
}

// The renderer receives a capability, not ipcRenderer. Main still validates the
// sender, frame, and payload before applying any native window change.
contextBridge.exposeInMainWorld(
  "workbenchDesktop",
  Object.freeze({
    settings: Object.freeze({
      load: () => ipcRenderer.invoke("workbench:desktop-settings"),
      update: (patch) => ipcRenderer.invoke("workbench:desktop-settings", patch),
      setUpdateToken: (token) => ipcRenderer.invoke("workbench:desktop-update-token", token),
      runUpdate: (action) => ipcRenderer.invoke("workbench:desktop-update", action),
      syncTasks: (state) => ipcRenderer.invoke("workbench:desktop-task-state", state),
      subscribe: (listener) => {
        const handler = (_event, value) => listener(value);
        ipcRenderer.on("workbench:desktop-changed", handler);
        return () => ipcRenderer.removeListener("workbench:desktop-changed", handler);
      },
      onOpenTask: (listener) => {
        const handler = (_event, id) => listener(id);
        ipcRenderer.on("workbench:desktop-open-task", handler);
        return () => ipcRenderer.removeListener("workbench:desktop-open-task", handler);
      },
      onNotificationSound: (listener) => {
        const handler = (_event, sound) => listener(sound);
        ipcRenderer.on("workbench:desktop-notification-sound", handler);
        return () => ipcRenderer.removeListener("workbench:desktop-notification-sound", handler);
      },
    }),
    systemFonts: Object.freeze({
      getFontFamilies: () => ipcRenderer.invoke("workbench:system-fonts"),
    }),
    lifecycle: Object.freeze({
      restartRuntime: () => ipcRenderer.invoke(RUNTIME_RESTART_CHANNEL),
    }),
    runtime: Object.freeze({
      bootstrap: () => ipcRenderer.sendSync(RUNTIME_BOOTSTRAP_CHANNEL),
    }),
    titleBar: Object.freeze({ setOverlay: setTitleBarOverlay }),
  }),
);
