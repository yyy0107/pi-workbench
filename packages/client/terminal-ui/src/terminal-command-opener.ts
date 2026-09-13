import type { OpenHandlerDefinition, WorkspaceScope } from "@workbench/extension-sdk";

import { createTerminalTarget } from "./terminal-target";

export const TERMINAL_COMMAND_SCHEME = "terminal-command";

const MAX_COMMAND_LENGTH = 32_768;

function metadataString(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function launchThreadId(scope: WorkspaceScope, contextThreadId: string | undefined): string {
  if (scope.type === "thread") return scope.key;
  if (scope.type === "application") return "application";
  return contextThreadId ?? "application";
}

export const terminalCommandOpenHandler = {
  id: "terminal.command",
  canOpen: ({ resource }) =>
    resource.scheme === TERMINAL_COMMAND_SCHEME &&
    resource.path.trim() &&
    resource.path.length <= MAX_COMMAND_LENGTH
      ? 100
      : 0,
  open: ({ resource, context, scope, policy }, { surfaces }) => {
    const command = resource.path.trim();
    if (!command || command.length > MAX_COMMAND_LENGTH) {
      throw new Error("Terminal command must contain between 1 and 32,768 characters");
    }

    const targetScope =
      scope ??
      (context.threadId
        ? { type: "thread" as const, key: context.threadId }
        : { type: "application" as const, key: context.applicationId });
    const cwd = metadataString(resource.metadata, "cwd") ?? context.rootPath;
    const workspaceId =
      metadataString(resource.metadata, "workspaceId") ?? context.projectId ?? "application";

    return surfaces.open({
      kind: "terminal",
      title: resource.label ?? command,
      params: {
        ...createTerminalTarget({
          threadId: launchThreadId(targetScope, context.threadId),
          workspaceId,
          ...(cwd ? { cwd } : {}),
        }),
        initialCommand: command,
      },
      context,
      placement: "primary",
      scope: targetScope,
      status: "ready",
      policy: policy ?? "force-focus",
    });
  },
} satisfies OpenHandlerDefinition;
