"use client";

import {
  ActiveWorkspaceRuntimeBindings as ShellActiveWorkspaceRuntimeBindings,
  type ActiveConversationWorkspace,
} from "@workbench/shell/application";
import type { WorkspaceRuntimeErrorReporter } from "@workbench/shell/right-workspace/react";

const WEB_APPLICATION_ID = "pi-workbench";

export type { ActiveConversationWorkspace };

export function ActiveWorkspaceRuntimeBindings({
  activeMainViewKind,
  conversation,
  reportError,
  revealWorkspace,
}: Readonly<{
  activeMainViewKind?: string;
  conversation: ActiveConversationWorkspace;
  reportError: WorkspaceRuntimeErrorReporter;
  revealWorkspace(workspaceId: string): void;
}>) {
  return (
    <ShellActiveWorkspaceRuntimeBindings
      activeMainViewKind={activeMainViewKind}
      applicationId={WEB_APPLICATION_ID}
      conversation={conversation}
      reportError={reportError}
      revealWorkspace={revealWorkspace}
    />
  );
}
