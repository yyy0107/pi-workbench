import type { RightWorkspaceController } from "@workbench/shell/right-workspace";
import { type LocalizableText } from "@workbench/shell/i18n";
import { definePiMessage } from "../../i18n";
import type { WorkspaceContext } from "@workbench/extension-sdk";

import {
  createTerminalTarget,
  type TerminalLaunchContext,
  type TerminalTranscriptTarget,
} from "./terminal-target";

export interface TerminalWorkspaceHost {
  controller: RightWorkspaceController;
  context: WorkspaceContext;
  launch: TerminalLaunchContext;
  title: LocalizableText;
  activeTerminal: boolean;
  workspaceOpen: boolean;
}

export interface TerminalTranscriptWorkspaceHost {
  controller: RightWorkspaceController;
  context: WorkspaceContext;
  toolCallId: string;
  command: string;
  piSessionId?: string;
  title: LocalizableText;
}

export const TERMINAL_SURFACE_TITLE = definePiMessage("extensions.terminal.title");

function terminalLaunchForContext(
  launch: TerminalLaunchContext,
  context: WorkspaceContext,
): TerminalLaunchContext {
  const threadId = context.threadId ?? "application";
  if (threadId === launch.threadId) return launch;

  return {
    threadId,
    workspaceId: context.projectId ?? "application",
    ...(context.rootPath ? { cwd: context.rootPath } : {}),
  };
}

export function openTerminal(
  host: Pick<TerminalWorkspaceHost, "controller" | "context" | "launch" | "title">,
  terminalId?: string,
): string {
  const launch = terminalLaunchForContext(host.launch, host.context);
  const target = createTerminalTarget(launch, terminalId);
  const scope =
    launch.threadId === "application"
      ? { type: "application" as const, key: host.context.applicationId }
      : { type: "thread" as const, key: launch.threadId };
  return host.controller.open({
    kind: "terminal",
    title: host.title,
    params: target,
    context: host.context,
    scope,
    status: "ready",
  });
}

export function revealTerminalTranscript(host: TerminalTranscriptWorkspaceHost): string {
  const target: TerminalTranscriptTarget = {
    mode: "transcript",
    toolCallId: host.toolCallId,
    command: host.command,
    ...(host.piSessionId ? { piSessionId: host.piSessionId } : {}),
    ...(host.context.threadId ? { threadId: host.context.threadId } : {}),
  };
  const scope = host.context.threadId
    ? { type: "thread" as const, key: host.context.threadId }
    : { type: "application" as const, key: host.context.applicationId };

  return host.controller.reveal({
    kind: "terminal",
    title: host.title,
    params: target,
    context: host.context,
    scope,
    status: "ready",
  });
}

/**
 * Per-extension-installation terminal workspace state.
 *
 * This deliberately has no module singleton: two ExtensionHosts can register the same
 * `terminal.toggle` command ID, and each command must operate on its own Right Workspace.
 */
export class TerminalWorkspaceService {
  #host?: TerminalWorkspaceHost;
  #generation = 0;

  attach(host: TerminalWorkspaceHost): () => void {
    const generation = ++this.#generation;
    this.#host = host;
    return () => {
      if (this.#generation === generation) this.#host = undefined;
    };
  }

  toggle(): void {
    const host = this.#host;
    if (!host) throw new Error("Terminal workspace runtime is unavailable.");
    if (host.workspaceOpen && host.activeTerminal) {
      host.controller.setWorkspaceOpen(false);
      return;
    }
    openTerminal(host);
  }

  dispose(): void {
    this.#generation += 1;
    this.#host = undefined;
  }
}
