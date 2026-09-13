"use client";

import { type LexicalEditor } from "lexical";
import { useCallback, useEffect, useRef, useState } from "react";

import { composerCommandArgumentKey, parseComposerDocument } from "./composer-document";

import {
  type ComposerCommandParameterValues,
  type ComposerCommandParametersByKey,
} from "../lib/composer-suggestion-model";
export function useComposerCommandParameters({
  mainThreadId,
  composerValue,
  lexicalEditorRef,
}: {
  mainThreadId: string;
  composerValue: string;
  lexicalEditorRef: import("react").RefObject<LexicalEditor | null>;
}) {
  const commandParametersByThreadRef = useRef(new Map<string, ComposerCommandParametersByKey>());
  const [commandParametersByKey, setCommandParametersByKey] =
    useState<ComposerCommandParametersByKey>({});
  const [activeCommandParameterKey, setActiveCommandParameterKey] = useState<string>();
  const [commandParameterValidationKey, setCommandParameterValidationKey] = useState<string>();
  useEffect(() => {
    setCommandParametersByKey(commandParametersByThreadRef.current.get(mainThreadId) ?? {});
    setActiveCommandParameterKey(undefined);
    setCommandParameterValidationKey(undefined);
    lexicalEditorRef.current?.focus();
  }, [mainThreadId]);

  useEffect(() => {
    const commandKeys = new Set(
      parseComposerDocument(composerValue)
        .filter((node) => node.type === "command")
        .map((node) => composerCommandArgumentKey(node.source, node.commandId)),
    );

    setCommandParametersByKey((current) => {
      const entries = Object.entries(current).filter(([key]) => commandKeys.has(key));
      if (entries.length === Object.keys(current).length) return current;
      const next = Object.fromEntries(entries);
      commandParametersByThreadRef.current.set(mainThreadId, next);
      return next;
    });
    setActiveCommandParameterKey((current) =>
      current && !commandKeys.has(current) ? undefined : current,
    );
    setCommandParameterValidationKey((current) =>
      current && !commandKeys.has(current) ? undefined : current,
    );
  }, [composerValue, mainThreadId]);

  const updateCommandParameterValues = useCallback(
    (key: string, values: ComposerCommandParameterValues) => {
      setCommandParametersByKey((current) => {
        const next = { ...current, [key]: values };
        commandParametersByThreadRef.current.set(mainThreadId, next);
        return next;
      });
    },
    [mainThreadId],
  );

  const clearCommandParameterValues = useCallback(() => {
    commandParametersByThreadRef.current.delete(mainThreadId);
    setCommandParametersByKey({});
    setActiveCommandParameterKey(undefined);
    setCommandParameterValidationKey(undefined);
  }, [mainThreadId]);

  return {
    commandParametersByKey,
    activeCommandParameterKey,
    setActiveCommandParameterKey,
    commandParameterValidationKey,
    setCommandParameterValidationKey,
    updateCommandParameterValues,
    clearCommandParameterValues,
  };
}
