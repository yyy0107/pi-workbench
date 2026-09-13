"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_NORMAL,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  type LexicalEditor,
} from "lexical";
import { useEffect } from "react";

import { type ComposerTriggerItem } from "./composer-directive";

export function CaptureLexicalEditor({
  onChange,
}: Readonly<{ onChange(editor: LexicalEditor | null): void }>) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    onChange(editor);
    return () => onChange(null);
  }, [editor, onChange]);
  return null;
}

export function ComposerAccessibilityPlugin({
  enabled,
  label,
}: Readonly<{ enabled: boolean; label: string }>) {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () =>
      editor.registerRootListener((root, previousRoot) => {
        previousRoot?.removeAttribute("aria-label");
        previousRoot?.removeAttribute("aria-disabled");
        previousRoot?.removeAttribute("aria-description");
        root?.setAttribute("aria-label", label);
        root?.setAttribute("aria-disabled", enabled ? "false" : "true");
        root?.removeAttribute("aria-description");
      }),
    [editor, enabled, label],
  );
  return null;
}

export function ComposerEnterPlugin({
  onSubmit,
}: Readonly<{ onSubmit(invertMode?: boolean): void }>) {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () =>
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (!event || event.isComposing || event.shiftKey) return false;
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat) onSubmit(event.ctrlKey || event.metaKey);
          return true;
        },
        COMMAND_PRIORITY_NORMAL,
      ),
    [editor, onSubmit],
  );
  return null;
}

export function ComposerSuggestionKeyboardPlugin({
  active,
  items,
  highlightedIndex,
  onHighlightedIndexChange,
  onSelect,
  onDismiss,
}: Readonly<{
  active: boolean;
  items: readonly ComposerTriggerItem[];
  highlightedIndex: number;
  onHighlightedIndexChange(index: number): void;
  onSelect(item: ComposerTriggerItem): void;
  onDismiss(): void;
}>) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const move = (offset: number) => {
      if (!active || items.length === 0) return false;
      onHighlightedIndexChange((highlightedIndex + offset + items.length) % items.length);
      return true;
    };
    const unregister = [
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        (event) => {
          if (!move(1)) return false;
          event?.preventDefault();
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        (event) => {
          if (!move(-1)) return false;
          event?.preventDefault();
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          const item = active ? items[highlightedIndex] : undefined;
          if (!item || event?.shiftKey) return false;
          event?.preventDefault();
          event?.stopPropagation();
          queueMicrotask(() => onSelect(item));
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        (event) => {
          if (!active) return false;
          event?.preventDefault();
          onDismiss();
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    ];
    return () => unregister.forEach((cleanup) => cleanup());
  }, [active, editor, highlightedIndex, items, onDismiss, onHighlightedIndexChange, onSelect]);
  return null;
}
