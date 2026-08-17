"use client";

import { ThreadPrimitive, useAuiState } from "@assistant-ui/react";
import { FolderIcon, SparklesIcon } from "lucide-react";

import { useI18n } from "@/i18n";
import { useWorkspaceDirectoryStore } from "@/workbench/workspaces/workspace-directory-store";

export function WorkbenchEmpty() {
  const { t } = useI18n();
  const isNewThread = useAuiState(
    (state) => state.threads.mainThreadId === state.threads.newThreadId,
  );
  const hasDraftWorkspace = useWorkspaceDirectoryStore((state) =>
    state.directories.some((directory) => directory.id === state.draftDirectoryId),
  );
  const needsWorkspace = isNewThread && !hasDraftWorkspace;
  const starterPrompts = [
    t("workbench.chat.empty.planProject"),
    t("workbench.chat.empty.explainConcept"),
    t("workbench.chat.empty.reviewIdea"),
  ];

  return (
    <div className="mx-auto flex w-full max-w-[var(--thread-max-width)] flex-1 flex-col justify-center px-4 py-12">
      <div className="mb-8">
        <div className="bg-primary/10 mb-4 flex size-10 items-center justify-center rounded-xl">
          {needsWorkspace ? <FolderIcon className="size-5" /> : <SparklesIcon className="size-5" />}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t(
            needsWorkspace
              ? "workbench.chat.empty.selectWorkspaceTitle"
              : "workbench.chat.empty.title",
          )}
        </h1>
        <p className="text-muted-foreground mt-2 max-w-lg text-sm leading-relaxed">
          {t(
            needsWorkspace
              ? "workbench.chat.empty.selectWorkspaceDescription"
              : "workbench.chat.empty.description",
          )}
        </p>
      </div>

      {!needsWorkspace ? (
        <div className="grid gap-2 sm:grid-cols-3">
          {starterPrompts.map((prompt) => (
            <ThreadPrimitive.Suggestion
              key={prompt}
              prompt={prompt}
              method="replace"
              autoSend
              className="hover:bg-muted focus-visible:ring-ring rounded-xl border p-3 text-start text-sm transition-colors outline-none focus-visible:ring-2"
            >
              {prompt}
            </ThreadPrimitive.Suggestion>
          ))}
        </div>
      ) : null}
    </div>
  );
}
