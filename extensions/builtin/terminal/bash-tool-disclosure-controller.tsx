"use client";

import { useEffect, useRef } from "react";

import { useRightWorkspace, useWorkspaceContext } from "@/components/right-workspace";
import type { ToolPresentationDisclosureControllerProps } from "@/platform/extensions";
import { usePiActiveSessionId } from "@/runtime/pi/client/runtime/context";

import {
  shouldExpandInteractiveTerminal,
  shouldRevealInteractiveTerminal,
} from "./terminal-disclosure-policy";
import { normalizeTerminalTabTitle } from "./terminal-tab-title";
import { bashCommandFromArgs } from "./terminal-tool-transcript";
import { revealTerminalTranscript, TERMINAL_SURFACE_TITLE } from "./terminal-workspace-service";
import { useToolTerminalInteraction } from "./use-tool-terminal-interaction";

export function BashToolDisclosureController({
  part,
  running,
  open,
  onOpenChange,
}: ToolPresentationDisclosureControllerProps) {
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();
  const piSessionId = usePiActiveSessionId();
  const revealedToolCallIdRef = useRef<string | undefined>(undefined);
  const alreadyRevealed = revealedToolCallIdRef.current === part.toolCallId;
  const interactionState = useToolTerminalInteraction(
    piSessionId,
    part.toolCallId,
    running && (!open || !alreadyRevealed),
  );

  useEffect(() => {
    if (shouldExpandInteractiveTerminal(interactionState, running, open)) {
      onOpenChange(true);
    }

    if (!shouldRevealInteractiveTerminal(interactionState, running, alreadyRevealed)) return;

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
    interactionState,
    onOpenChange,
    open,
    part.args,
    part.toolCallId,
    piSessionId,
    running,
  ]);

  return null;
}
