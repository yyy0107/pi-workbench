import type { WorkbenchSessionStorage } from "../src/browser-session-persistence";

export function resolveBrowserSessionStorage(): WorkbenchSessionStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}
