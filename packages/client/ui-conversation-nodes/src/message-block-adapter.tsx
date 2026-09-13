"use client";
import type { ComponentProps } from "react";
import { useConversationSession } from "@workbench/agent-runtime-client";
import {
  WorkbenchMessageTextBlock as TextBlockView,
  WorkbenchMessageFileBlock as FileBlockView,
} from "@workbench/ui-message-blocks/message-blocks";
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
  return <FileBlockView {...props} readAttachment={session.actions.readManagedFileAttachment} />;
}
