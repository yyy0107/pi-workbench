"use client";
import type { ComponentProps } from "react";
import { useConversationSession } from "@workbench/agent-runtime-client";
import { useI18n } from "@workbench/i18n";
import { useToastManager } from "@workbench/ui";
import {
  WorkbenchMessageTextBlock as TextBlockView,
  WorkbenchMessageFileBlock as FileBlockView,
} from "@workbench/ui-message-blocks/message-blocks";
import { useOpenerService, useWorkspaceContext } from "@workbench/ui-workspace/react";
import { openFileLink } from "@workbench/workspace-files";
import { filesTranslationBundle } from "@workbench/workspace-files/i18n";
import { useComposerMessagePresentation } from "./composer-message-text";

export function WorkbenchMessageTextBlock(
  props: Omit<ComponentProps<typeof TextBlockView>, "presentation"> & {
    composerDocument?: unknown;
  },
) {
  // Only user messages need command projection and its registry subscription.
  return props.role === "user" ? <UserTextBlock {...props} /> : <TextBlockView {...props} />;
}
function UserTextBlock({
  composerDocument,
  ...props
}: Omit<ComponentProps<typeof TextBlockView>, "presentation"> & { composerDocument?: unknown }) {
  const presentation = useComposerMessagePresentation(props.block.text, composerDocument);
  return <TextBlockView {...props} presentation={presentation} />;
}
export function WorkbenchMessageFileBlock(props: ComponentProps<typeof FileBlockView>) {
  const session = useConversationSession();
  const opener = useOpenerService();
  const context = useWorkspaceContext();
  const notifications = useToastManager();
  const { t } = useI18n(filesTranslationBundle);

  return (
    <FileBlockView
      {...props}
      readAttachment={session.actions.readManagedFileAttachment}
      onOpenFile={(path) => {
        void openFileLink(opener, context, path).catch((error: unknown) => {
          console.warn("[message-file] open failed", error);
          notifications.add({ type: "error", title: t("workspaceFiles.openFailed") });
        });
      }}
    />
  );
}
