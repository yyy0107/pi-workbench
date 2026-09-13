import type { PiBashToolFactoryInput } from "@workbench/pi-sdk-ports/host";
import type { ToolDefinition, SessionManager } from "@earendil-works/pi-coding-agent";
import type { GitReviewSnapshot } from "@workbench/workspace-server/git";

export interface PiSessionToolOverride {
  readonly name: string;
  readonly source: string;
  create(input: PiBashToolFactoryInput): ToolDefinition;
}

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
  toolOverrides(
    cwd: string,
    bindings: PiAgentHostBindings,
    enhancedSearch?: boolean,
  ): readonly PiSessionToolOverride[];
  resolveReviewSnapshots(
    cwd: string,
    manager: Pick<SessionManager, "getCwd" | "getBranch">,
  ): Promise<{ gitDir: string; snapshots: GitReviewSnapshot[] }>;
}
