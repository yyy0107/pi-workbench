import { SquareTerminalIcon, TerminalIcon } from "lucide-react";

import {
  createLazyWorkspaceSurface,
  defineExtension,
  type WorkspaceSurfaceDefinition,
} from "@workbench/extension-sdk";

import { definePiMessage } from "../../i18n";

import { createToggleTerminalCommand } from "./open-terminal-command";
import { BashToolDisclosureController } from "./bash-tool-disclosure-controller";
import { BashToolRenderer } from "./bash-tool-renderer";
import { TerminalMenuItem } from "./terminal-menu-item";
import { terminalCommandOpenHandler } from "./terminal-command-opener";
import { TerminalRuntimeBridge } from "./terminal-runtime-bridge";
import { loadTerminalSurface } from "./terminal-surface-loader";
import { isTerminalTranscriptTarget, type TerminalTarget } from "./terminal-target";
import { TerminalTrigger } from "./terminal-trigger";
import { TerminalWorkspaceService } from "./terminal-workspace-service";

const TerminalSurface = createLazyWorkspaceSurface(loadTerminalSurface);

export const terminalSurfaceDefinition = {
  kind: "terminal",
  icon: TerminalIcon,
  cachePolicy: "keep-alive",
  allowDuplicateResources: true,
  getResourceKey: (params) =>
    isTerminalTranscriptTarget(params)
      ? `terminal:transcript:${params.threadId ?? "thread"}:${params.toolCallId}`
      : `terminal:pty:${params.threadId ?? "thread"}:${params.terminalId ?? params.sessionId}`,
  getDefaultScope: (params, context) => {
    const threadId = params.threadId === "application" ? context.threadId : params.threadId;
    return threadId || context.threadId
      ? {
          type: "thread",
          key: threadId ?? context.threadId ?? context.applicationId,
        }
      : {
          type: "application",
          key: context.applicationId,
        };
  },
  render: TerminalSurface,
  menuItem: TerminalMenuItem,
  runtime: TerminalRuntimeBridge,
} satisfies WorkspaceSurfaceDefinition<TerminalTarget>;

export const terminalExtension = defineExtension({
  id: "workbench.terminal",
  name: "Terminal",
  version: "1.0.0",

  setup(context) {
    const workspaceService = new TerminalWorkspaceService();
    const surface = context.workspace.register(terminalSurfaceDefinition);
    const commandOpener = context.openers.register(terminalCommandOpenHandler);
    const command = context.commands.register(createToggleTerminalCommand(workspaceService));
    const bashRenderer = context.renderers.tools.register("bash", BashToolRenderer);
    const bashPresentation = context.renderers.toolPresentations.register("bash", {
      label: definePiMessage("extensions.terminal.tool.activityComplete"),
      activeLabel: definePiMessage("extensions.terminal.tool.activityRunning"),
      icon: SquareTerminalIcon,
      disclosureController: BashToolDisclosureController,
    });
    const mobileTrigger = context.slots.register("header.right", {
      id: "workbench.terminal.mobile-trigger",
      order: 100,
      component: TerminalTrigger,
    });

    return [
      surface,
      commandOpener,
      command,
      bashRenderer,
      bashPresentation,
      mobileTrigger,
      { dispose: () => workspaceService.dispose() },
    ];
  },
});
