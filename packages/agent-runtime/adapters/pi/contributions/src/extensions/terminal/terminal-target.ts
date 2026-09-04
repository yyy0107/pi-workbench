"use client";

import { useMemo } from "react";

import { useCurrentSession, useThreadList } from "@workbench/agent-runtime-client";

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
  const current = useCurrentSession();
  const thread = useThreadList((snapshot) =>
    snapshot.threads.find((candidate) => candidate.threadId === current.threadId),
  );
  const threadId = current.threadId ?? current.sessionId ?? "application";
  const workspaceId = thread?.workspace?.id ?? "application";
  const cwd = thread?.workspace?.rootPath;

  return useMemo(
    () => ({
      threadId,
      workspaceId,
      ...(cwd ? { cwd } : {}),
    }),
    [cwd, threadId, workspaceId],
  );
}
