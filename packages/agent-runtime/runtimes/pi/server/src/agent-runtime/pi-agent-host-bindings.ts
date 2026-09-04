import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

import type { AskUserCapabilitySettings } from "../internal-extensions/ask-user";

export interface PiBashToolFactoryInput {
  readonly cwd: string;
  readonly sessionId: string;
  readonly commandPrefix?: string;
  readonly shellPath?: string;
}

/** Workbench Host capabilities required while constructing a Pi session. */
export interface PiAgentHostBindings {
  readonly attachmentUnderstandingSettings?: () => Pick<
    import("@workbench/attachment-understanding-server/settings").ImageUnderstandingSettingsStore,
    "resolveRuntimeSettings"
  >;
  readonly workspaceFiles?: Pick<
    import("@workbench/workspace-server/files").WorkspaceFileService,
    "readFile"
  >;
  readonly createBashToolOverride?: (input: PiBashToolFactoryInput) => ToolDefinition;
  readonly askUserSettings?: AskUserCapabilitySettings;
}

interface PiAgentHostBindingsGlobal {
  __workbenchPiAgentHostBindings?: PiAgentHostBindings;
}

const bindingGlobal = globalThis as typeof globalThis & PiAgentHostBindingsGlobal;
const EMPTY_PI_AGENT_HOST_BINDINGS = Object.freeze({}) satisfies PiAgentHostBindings;

export function bindPiAgentHostBindings(bindings: PiAgentHostBindings): void {
  bindingGlobal.__workbenchPiAgentHostBindings = bindings;
}

export function getPiAgentHostBindings(): PiAgentHostBindings {
  return bindingGlobal.__workbenchPiAgentHostBindings ?? EMPTY_PI_AGENT_HOST_BINDINGS;
}
