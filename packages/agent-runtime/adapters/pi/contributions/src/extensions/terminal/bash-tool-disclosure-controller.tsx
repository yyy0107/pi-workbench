"use client";

import { useEffect, useRef } from "react";

import { useRightWorkspace, useWorkspaceContext } from "@workbench/shell/right-workspace/react";
import type { ToolPresentationDisclosureControllerProps } from "@workbench/extension-sdk";
import { useWorkbenchAgentThreadId } from "@workbench/agent-runtime-client/context";
import {
  normalizeTerminalTabTitle,
  shouldExpandBashTerminalForUserInput,
  shouldRevealBashTerminalForUserInput,
} from "@workbench/terminal-client";
import { workbenchBashInputFromArgs } from "@workbench/terminal-contracts";

import { bashCommandFromArgs } from "./terminal-tool-transcript";
import { revealTerminalTranscript, TERMINAL_SURFACE_TITLE } from "./terminal-workspace-service";
import { useToolTerminalReady } from "./use-tool-terminal-ready";

export function BashToolDisclosureController({
  part,
  running,
  open,
  onOpenChange,
}: ToolPresentationDisclosureControllerProps) {
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();
  const piSessionId = useWorkbenchAgentThreadId();
  const revealedToolCallIdRef = useRef<string | undefined>(undefined);
  const alreadyRevealed = revealedToolCallIdRef.current === part.toolCallId;
  const inputSource = workbenchBashInputFromArgs(part.args)?.source;
  const terminalReady = useToolTerminalReady(
    piSessionId,
    part.toolCallId,
    running && inputSource === "user" && !alreadyRevealed,
  );

  useEffect(() => {
    if (shouldExpandBashTerminalForUserInput(inputSource, terminalReady, running, open)) {
      onOpenChange(true);
    }

    if (
      !shouldRevealBashTerminalForUserInput(inputSource, terminalReady, running, alreadyRevealed)
    ) {
      return;
    }

    const command = bashCommandFromArgs(part.args) ?? "bash";
    revealedToolCallIdRef.current = part.toolCallId;
    revealTerminalTranscript({
      controller,
      context,
      toolCallId: part.toolCallId,
      command,
      ...(piSessionId ? { piSessionId } : {}),
      title: normalizeTerminalTabTitle(command) ?? TERMINAL_SURFACE_TITLE,
    });
  }, [
    alreadyRevealed,
    context,
    controller,
    inputSource,
    onOpenChange,
    open,
    part.args,
    part.toolCallId,
    piSessionId,
    running,
    terminalReady,
  ]);

  return null;
}
