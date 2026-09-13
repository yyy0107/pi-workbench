"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_NORMAL,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  type LexicalEditor,
} from "lexical";
import { useEffect } from "react";

type HistoryDirection = "previous" | "next";

function $isHistoryBoundary(direction: HistoryDirection): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
  const range = selection.clone();
  const root = $getRoot();
  if (direction === "previous") range.anchor.set(root.getKey(), 0, "element");
  else range.focus.set(root.getKey(), root.getChildrenSize(), "element");
  return !range.getTextContent().includes("\n");
}

export function registerComposerHistoryKeyboard(
  editor: LexicalEditor,
  onNavigate: (direction: HistoryDirection) => boolean,
): () => void {
  const navigate = (event: KeyboardEvent, direction: HistoryDirection) => {
    if (
      event.isComposing ||
      editor.isComposing() ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      !$isHistoryBoundary(direction) ||
      !onNavigate(direction)
    )
      return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  };
  const unregister = [
    editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      (event) => navigate(event, "previous"),
      COMMAND_PRIORITY_NORMAL,
    ),
    editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      (event) => navigate(event, "next"),
      COMMAND_PRIORITY_NORMAL,
    ),
  ];
  return () => unregister.forEach((cleanup) => cleanup());
}

export function ComposerHistoryKeyboardPlugin({
  enabled,
  onNavigate,
}: Readonly<{
  enabled: boolean;
  onNavigate(direction: HistoryDirection): boolean;
}>) {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () => (enabled ? registerComposerHistoryKeyboard(editor, onNavigate) : undefined),
    [editor, enabled, onNavigate],
  );
  return null;
}
