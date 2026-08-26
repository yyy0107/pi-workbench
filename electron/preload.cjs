const { ipcRenderer } = require("electron");

const TITLE_BAR_OVERLAY_CHANNEL = "workbench:title-bar-overlay";

function byteToHex(value) {
  return value.toString(16).padStart(2, "0");
}

function cssColorToHex(color) {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return undefined;

  context.clearRect(0, 0, 1, 1);
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
  if (alpha !== 255) return undefined;

  return `#${byteToHex(red)}${byteToHex(green)}${byteToHex(blue)}`;
}

function readTitleBarOverlay() {
  const probe = document.createElement("div");
  probe.style.cssText = [
    "position:fixed",
    "visibility:hidden",
    "pointer-events:none",
    "background-color:var(--workbench-canvas-background, var(--background))",
    "color:var(--foreground)",
  ].join(";");
  document.body.append(probe);

  const style = getComputedStyle(probe);
  const color = cssColorToHex(style.backgroundColor);
  const symbolColor = cssColorToHex(style.color);
  probe.remove();

  if (!color || !symbolColor) return undefined;
  return { color, symbolColor };
}

function installTitleBarOverlaySync() {
  let scheduled = false;
  let previousOptions;

  const sync = () => {
    scheduled = false;
    const options = readTitleBarOverlay();
    if (!options) return;

    const serialized = JSON.stringify(options);
    if (serialized === previousOptions) return;
    previousOptions = serialized;
    ipcRenderer.send(TITLE_BAR_OVERLAY_CHANNEL, options);
  };

  const scheduleSync = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(sync);
  };

  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style", "data-workbench-appearance"],
  });
  window.addEventListener("pageshow", scheduleSync);
  scheduleSync();
}

window.addEventListener("DOMContentLoaded", installTitleBarOverlaySync, { once: true });
