import {
  defineTitleBarOverlay,
  type DesktopTitleBarPort,
  type TitleBarOverlay,
} from "@workbench/desktop-contracts";
import type { DesktopRuntimeBootstrapPort } from "@workbench/desktop-contracts/runtime-bootstrap";

export interface WorkbenchDesktopBridge {
  readonly runtime?: DesktopRuntimeBootstrapPort;
  readonly titleBar?: DesktopTitleBarPort;
}

/**
 * Reads the only desktop bridge shape needed by the Workbench UI. This is the
 * platform boundary: all other Workbench code talks in terms of the neutral
 * DesktopTitleBarPort contract.
 */
export function readWorkbenchDesktopTitleBarPort(value: unknown): DesktopTitleBarPort | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const titleBar = (value as WorkbenchDesktopBridge).titleBar;
  if (!titleBar || typeof titleBar.setOverlay !== "function") return undefined;
  return titleBar;
}

export function getWorkbenchDesktopTitleBarPort(): DesktopTitleBarPort | undefined {
  if (typeof window === "undefined") return undefined;
  return readWorkbenchDesktopTitleBarPort(window.workbenchDesktop);
}

function byteToHex(value: number): string {
  return value.toString(16).padStart(2, "0");
}

function cssColorToHex(color: string, document_: Document): string | undefined {
  const canvas = document_.createElement("canvas");
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

/** Reads one Workbench installation's CSS colors in the portable title-bar format. */
export function readTitleBarOverlay(owner: HTMLElement): TitleBarOverlay | undefined {
  const document_ = owner.ownerDocument;
  const probe = document_.createElement("div");
  probe.style.cssText = [
    "position:fixed",
    "visibility:hidden",
    "pointer-events:none",
    "background-color:var(--workbench-canvas-background, var(--background))",
    "color:var(--foreground)",
  ].join(";");
  owner.append(probe);

  const style = getComputedStyle(probe);
  const color = cssColorToHex(style.backgroundColor, document_);
  const symbolColor = cssColorToHex(style.color, document_);
  probe.remove();

  if (!color || !symbolColor) return undefined;
  return defineTitleBarOverlay({ color, symbolColor });
}

export function syncTitleBarOverlay(port: DesktopTitleBarPort, owner: HTMLElement): boolean {
  const overlay = readTitleBarOverlay(owner);
  if (!overlay) return false;
  port.setOverlay(overlay);
  return true;
}

declare global {
  interface Window {
    workbenchDesktop?: WorkbenchDesktopBridge;
  }
}
