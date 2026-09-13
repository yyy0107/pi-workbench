import type { PiStreamPublisher } from "@workbench/pi-sdk-ports/streams";
import type { PiAgentHostBindings } from "@workbench/pi-sdk-ports/host";
import type {
  AskUserCapabilitySettings,
  ToolCapabilitySettings,
  BuiltinToolSettings,
} from "@workbench/pi-sdk-ports/tools";
import type { InlineExtension, LoadExtensionsResult } from "@earendil-works/pi-coding-agent";
import type { WorkspaceSessionRemovalPort } from "@workbench/agent-runtime-contracts/workspace-catalog";
export interface PiSessionRuntimeDependencies {
  getPublisher(): PiStreamPublisher;
  getWorkspaceStore(): WorkspaceSessionRemovalPort;
  getHostBindings(): PiAgentHostBindings;
  ensureBuiltinResources(): Promise<unknown>;
  createExtensions(
    askUser?: AskUserCapabilitySettings,
    todo?: ToolCapabilitySettings,
    builtin?: BuiltinToolSettings,
    settings?: ToolCapabilitySettings,
  ): InlineExtension[];
  prepareExtensions(result: LoadExtensionsResult): LoadExtensionsResult;
}
