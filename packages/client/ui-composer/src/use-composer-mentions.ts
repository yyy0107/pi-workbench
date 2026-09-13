"use client";

import { composerTranslationBundle } from "./i18n";

import type { CatalogTranslate } from "@workbench/i18n/runtime";

import { useEffect, useMemo, useState } from "react";

import {
  COMPOSER_CONVERSATION_MENTION_TYPE,
  COMPOSER_WORKSPACE_FILE_MENTION_TYPE,
} from "@workbench/core-contracts/composer";

import { useWorkbenchAgentWorkspaceFileSearch } from "@workbench/agent-runtime-client/context";
import { useWorkspaceSelection } from "@workbench/agent-runtime-client/workspaces";

import { composerWorkspaceFileMentionId } from "./composer-document";

import { type ComposerTriggerItem } from "./composer-directive";

import { ComposerTriggerEngine } from "@workbench/ui-input-trigger/composer-trigger-engine";

interface WorkspaceFileMentionSearchState {
  readonly workspaceId?: string;
  readonly query: string;
  readonly items: readonly ComposerTriggerItem[];
  readonly loading: boolean;
  readonly loadError: boolean;
}

const EMPTY_WORKSPACE_FILE_MENTION_SEARCH: WorkspaceFileMentionSearchState = {
  query: "",
  items: [],
  loading: false,
  loadError: false,
};

export function useComposerMentions({
  threads,
  mainThreadId,
  t,
  contextWorkspace,
  workspaceFileSearch,
  isComposerFocused,
  composerValue,
  composerCursorPosition,
  isComposerComposing,
}: {
  threads: readonly import("@workbench/agent-runtime-client").ThreadListItem[];
  mainThreadId: string;
  t: CatalogTranslate<(typeof composerTranslationBundle.messages)["en-US"]>;
  contextWorkspace: ReturnType<typeof useWorkspaceSelection>["draftWorkspace"];
  workspaceFileSearch: ReturnType<typeof useWorkbenchAgentWorkspaceFileSearch>;
  isComposerFocused: boolean;
  composerValue: string;
  composerCursorPosition: number;
  isComposerComposing: boolean;
}) {
  const [workspaceFileMentionSearch, setWorkspaceFileMentionSearch] =
    useState<WorkspaceFileMentionSearchState>(EMPTY_WORKSPACE_FILE_MENTION_SEARCH);
  const conversationContextItems = useMemo<readonly ComposerTriggerItem[]>(
    () =>
      threads.flatMap((thread) =>
        thread.threadId === mainThreadId
          ? []
          : [
              {
                id: thread.threadId,
                type: COMPOSER_CONVERSATION_MENTION_TYPE,
                label:
                  thread.title?.trim() ||
                  t("workbench.chat.composer.contextMentions.untitledConversation"),
              },
            ],
      ),
    [mainThreadId, t, threads],
  );
  const workspaceFileContextItems = useMemo<readonly ComposerTriggerItem[]>(
    () =>
      workspaceFileMentionSearch.workspaceId === contextWorkspace?.id
        ? workspaceFileMentionSearch.items
        : [],
    [contextWorkspace?.id, workspaceFileMentionSearch],
  );
  const contextMentionDetectionEngine = useMemo(
    () =>
      new ComposerTriggerEngine<true>([
        {
          id: "context-mention",
          character: "@",
          search: () => [true],
        },
      ]),
    [],
  );
  const contextMentionMatch = useMemo(() => {
    if (!isComposerFocused) return undefined;
    return contextMentionDetectionEngine.detect({
      value: composerValue,
      cursorPosition: composerCursorPosition,
      isComposing: isComposerComposing,
    });
  }, [
    composerCursorPosition,
    composerValue,
    contextMentionDetectionEngine,
    isComposerComposing,
    isComposerFocused,
  ]);
  const activeContextMentionQuery = contextMentionMatch?.query;
  useEffect(() => {
    if (!contextWorkspace || activeContextMentionQuery === undefined || !workspaceFileSearch) {
      setWorkspaceFileMentionSearch(EMPTY_WORKSPACE_FILE_MENTION_SEARCH);
      return;
    }

    const workspaceId = contextWorkspace.id;
    const workspaceName = contextWorkspace.name;
    const query = activeContextMentionQuery;
    const controller = new AbortController();
    setWorkspaceFileMentionSearch({
      workspaceId,
      query,
      items: [],
      loading: true,
      loadError: false,
    });
    const timeout = window.setTimeout(
      () => {
        void workspaceFileSearch
          .search({ workspaceId, query, limit: 50, signal: controller.signal })
          .then((entries) => {
            if (controller.signal.aborted) return;
            setWorkspaceFileMentionSearch({
              workspaceId,
              query,
              items: entries.map((entry) => ({
                id: composerWorkspaceFileMentionId({
                  workspaceId,
                  relativePath: entry.relativePath,
                }),
                type: COMPOSER_WORKSPACE_FILE_MENTION_TYPE,
                label: entry.relativePath,
                description: workspaceName,
              })),
              loading: false,
              loadError: false,
            });
          })
          .catch(() => {
            if (controller.signal.aborted) return;
            setWorkspaceFileMentionSearch({
              workspaceId,
              query,
              items: [],
              loading: false,
              loadError: true,
            });
          });
      },
      query ? 120 : 0,
    );
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [activeContextMentionQuery, contextWorkspace, workspaceFileSearch]);
  const contextMentionItems = useMemo<readonly ComposerTriggerItem[]>(() => {
    const query = contextMentionMatch?.query;
    if (query === undefined) return [];
    const normalized = query.toLocaleLowerCase();
    const conversations = conversationContextItems.filter(
      (item) =>
        item.label.toLocaleLowerCase().includes(normalized) ||
        item.id.toLocaleLowerCase().includes(normalized),
    );
    const workspaceFiles =
      workspaceFileMentionSearch.query === query ? workspaceFileContextItems : [];
    return [...conversations, ...workspaceFiles];
  }, [
    contextMentionMatch?.query,
    conversationContextItems,
    workspaceFileContextItems,
    workspaceFileMentionSearch.query,
  ]);
  return { workspaceFileMentionSearch, contextMentionMatch, contextMentionItems };
}
