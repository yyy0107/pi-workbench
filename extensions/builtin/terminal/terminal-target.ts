"use client";

import { useAuiState } from "@assistant-ui/react";
import { useMemo } from "react";

export interface TerminalPtyTarget extends Record<string, unknown> {
  mode?: "pty";
  sessionId: string;
  terminalId?: string;
  threadId?: string;
  workspaceId: string;
  cwd?: string;
  initialCommand?: string;
}

export interface TerminalLaunchContext {
  threadId: string;
  workspaceId: string;
  cwd?: string;
}

export interface TerminalTranscriptTarget extends Record<string, unknown> {
  mode: "transcript";
  toolCallId: string;
  command: string;
  piSessionId?: string;
  threadId?: string;
}

export type TerminalTarget = TerminalPtyTarget | TerminalTranscriptTarget;

export function isTerminalTranscriptTarget(
  target: Record<string, unknown>,
): target is TerminalTranscriptTarget {
  return target.mode === "transcript";
}

function safeSessionSegment(value: string, maxLength: number): string {
  const normalized = value.replaceAll(/[^A-Za-z0-9._:-]/g, "_").slice(0, maxLength);
  return normalized || "application";
}

function createTerminalId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

export function createTerminalTarget(
  launch: TerminalLaunchContext,
  terminalId = createTerminalId(),
): TerminalPtyTarget {
  return {
    mode: "pty",
    terminalId,
    threadId: launch.threadId,
    sessionId: `terminal:${safeSessionSegment(launch.threadId, 110)}:${safeSessionSegment(terminalId, 64)}`,
    workspaceId: launch.workspaceId,
    ...(launch.cwd ? { cwd: launch.cwd } : {}),
  };
}

export function useTerminalLaunchContext(): TerminalLaunchContext {
  const mainThreadId = useAuiState((state) => state.threads.mainThreadId);
  const mainThread = useAuiState((state) =>
    state.threads.threadItems.find((thread) => thread.id === state.threads.mainThreadId),
  );
  const workspaceId =
    typeof mainThread?.custom?.piWorkspaceId === "string"
      ? mainThread.custom.piWorkspaceId
      : "application";
  const cwd =
    typeof mainThread?.custom?.piWorkspaceCwd === "string"
      ? mainThread.custom.piWorkspaceCwd
      : undefined;
  const threadId = mainThread?.remoteId ?? mainThread?.externalId ?? mainThreadId ?? "application";

  return useMemo(
    () => ({
      threadId,
      workspaceId,
      ...(cwd ? { cwd } : {}),
    }),
    [cwd, threadId, workspaceId],
  );
}
