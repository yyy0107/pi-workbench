import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface ToolCapabilitySettings {
  readEnabled(): Promise<boolean>;
  subscribe(listener: (enabled: boolean) => void): () => void;
}

/** Keep a tool's model exposure and execution guard on the same persisted preference. */
export function bindToolAvailability(
  pi: ExtensionAPI,
  toolName: string,
  settings?: ToolCapabilitySettings,
  defaultEnabled = true,
): () => Promise<boolean> {
  const readEnabled = async () => {
    try {
      return (await settings?.readEnabled()) ?? defaultEnabled;
    } catch (error) {
      console.error(`[workbench-pi] ${toolName} preference could not be read.`, error);
      return defaultEnabled;
    }
  };
  const setEnabled = (enabled: boolean) => {
    const active = pi.getActiveTools();
    if (active.includes(toolName) === enabled) return;
    pi.setActiveTools(enabled ? [...active, toolName] : active.filter((name) => name !== toolName));
  };
  let unsubscribe: (() => void) | undefined;
  let revision = 0;
  pi.on("session_start", async () => {
    if (!settings && defaultEnabled) return;
    const initialRevision = ++revision;
    unsubscribe ??= settings?.subscribe((enabled) => {
      revision += 1;
      setEnabled(enabled);
    });
    const enabled = await readEnabled();
    if (revision === initialRevision) setEnabled(enabled);
  });
  pi.on("session_shutdown", () => {
    revision += 1;
    unsubscribe?.();
    unsubscribe = undefined;
  });
  return readEnabled;
}
