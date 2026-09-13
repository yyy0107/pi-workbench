"use client";

import { WorkbenchShell, type WorkbenchShellProps } from "@workbench/ui-layout";
import { useCurrentSession, useThreadList } from "@workbench/agent-runtime-client";
import { useWorkspaceSelection } from "@workbench/agent-runtime-client/workspaces";
import { useI18n } from "@workbench/i18n";
import { sidebarTranslationBundle } from "@workbench/ui-sidebar/i18n";
import { truncateConversationTitle } from "@workbench/ui-conversation/title";
import { ConversationActionsMenu } from "@workbench/ui-conversation-list";

/** Product projection is mounted inside the installation RuntimeProvider. */
export function ConversationWorkbenchShell(props: WorkbenchShellProps) {
  const { t } = useI18n(sidebarTranslationBundle);
  const current = useCurrentSession();
  const thread = useThreadList((snapshot) =>
    snapshot.threads.find((item) => item.threadId === current.threadId),
  );
  const { draftWorkspace } = useWorkspaceSelection();
  const workspace = thread?.workspace ?? (current.isNewThread ? draftWorkspace : undefined);
  const title = thread?.title || t("workbench.sidebar.newThread");
  return (
    <WorkbenchShell
      {...props}
      conversationHeader={{
        fullTitle: title,
        displayTitle: truncateConversationTitle(title),
        workspaceName: workspace?.name ?? workspace?.rootPath ?? workspace?.id,
        workspacePath: workspace?.rootPath,
      }}
      conversationActions={
        thread ? (
          <ConversationActionsMenu
            threadId={thread.threadId}
            isPinned={thread.isPinned}
            title={thread.title}
          />
        ) : null
      }
    />
  );
}
