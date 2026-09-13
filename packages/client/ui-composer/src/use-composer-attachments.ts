"use client";

import { $getRoot, $getSelection, $isRangeSelection, type LexicalEditor } from "lexical";
import { useCallback } from "react";

import {
  composerAttachmentFromFile,
  useConversationSession,
} from "@workbench/agent-runtime-client";

import { canRestorePastedText } from "@workbench/agent-runtime-contracts/composer-attachments";

export function useComposerAttachments({
  session,
  lexicalEditorRef,
  activeSessionRef,
}: {
  session: ReturnType<typeof useConversationSession>;
  lexicalEditorRef: import("react").RefObject<LexicalEditor | null>;
  activeSessionRef: import("react").RefObject<ReturnType<typeof useConversationSession>>;
}) {
  const restorePastedText = useCallback(
    async (key: string) => {
      const item = session.snapshot
        .getSnapshot()
        .composer.attachments.find((entry) => entry.key === key);
      const editor = lexicalEditorRef.current;
      const read = session.actions.readPastedTextAttachment;
      if (
        !editor ||
        !read ||
        item?.kind !== "pasted-text" ||
        item.status !== "ready" ||
        !canRestorePastedText(item.attachment.characterCount)
      )
        throw new Error("Text attachment cannot be restored");
      const page = await read({ id: item.attachment.id });
      if (
        page.nextOffset !== undefined ||
        !canRestorePastedText(page.text.length) ||
        page.text.length !== item.attachment.characterCount
      )
        throw new Error("Incomplete text attachment");
      if (
        activeSessionRef.current !== session ||
        lexicalEditorRef.current !== editor ||
        !session.snapshot.getSnapshot().composer.attachments.includes(item)
      )
        throw new Error("Composer changed");
      await new Promise<void>((resolve, reject) =>
        editor.focus(() => {
          if (
            activeSessionRef.current !== session ||
            lexicalEditorRef.current !== editor ||
            !session.snapshot.getSnapshot().composer.attachments.includes(item)
          ) {
            reject(new Error("Composer changed"));
            return;
          }
          let inserted = false;
          editor.update(
            () => {
              let selection = $getSelection();
              if (!$isRangeSelection(selection)) {
                $getRoot().selectEnd();
                selection = $getSelection();
              }
              if ($isRangeSelection(selection)) {
                selection.insertRawText(page.text);
                inserted = true;
              }
            },
            {
              discrete: true,
              tag: "history-push",
              onUpdate: () => {
                if (!inserted) {
                  reject(new Error("Editor selection unavailable"));
                  return;
                }
                session.actions.removeComposerAttachment?.(key);
                resolve();
              },
            },
          );
        }),
      );
    },
    [session],
  );

  const addComposerFiles = useCallback(
    async (files: readonly File[]) => {
      const addAttachment = session.actions.addComposerAttachment;
      if (!addAttachment) return;
      try {
        await Promise.all(
          files.map(async (file) => addAttachment(await composerAttachmentFromFile(file))),
        );
      } catch (error) {
        console.error("[workbench] add composer attachment failed", error);
      }
    },
    [session],
  );

  return { restorePastedText, addComposerFiles };
}
