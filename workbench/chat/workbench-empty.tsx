"use client";

import { ThreadPrimitive, useAuiState } from "@assistant-ui/react";
import type { ReactNode } from "react";

import { useI18n } from "@/i18n";
import { useWorkspaceSelection } from "@/services/workspace-selection-service";

import { NEW_THREAD_COMPOSER_WIDTH_CLASS_NAME } from "./thread-content-width";

export function WorkbenchEmpty({ children }: Readonly<{ children: ReactNode }>) {
  const { t } = useI18n();
  const isNewThread = useAuiState(
    (state) => state.threads.mainThreadId === state.threads.newThreadId,
  );
  const hasDraftWorkspace = useWorkspaceSelection().draftWorkspace !== undefined;
  const canAutoSendSuggestion = !isNewThread || hasDraftWorkspace;
  const starterPrompts = [
    t("workbench.chat.empty.planProject"),
    t("workbench.chat.empty.explainConcept"),
    t("workbench.chat.empty.reviewIdea"),
  ];

  return (
    <div className="relative mx-auto flex w-full flex-1 flex-col justify-center py-12">
      <img
        src="/pi-logo-on-light.svg"
        alt=""
        aria-hidden="true"
        draggable={false}
        className="pointer-events-none absolute bottom-[calc(50%_-_3rem)] left-1/2 z-0 size-[min(90vw,36rem)] max-w-none -translate-x-1/2 select-none opacity-[0.025] dark:invert dark:opacity-[0.05]"
      />

      <div className="relative z-10 mb-6 flex flex-col items-center text-center">
        <h1 className="from-foreground via-muted-foreground to-foreground bg-linear-to-r bg-clip-text text-balance text-[clamp(1.25rem,4vw,2.75rem)] leading-tight font-normal tracking-[-0.035em] text-transparent drop-shadow-[0_1px_0_rgb(0_0_0_/_0.08)]">
          {t("workbench.chat.empty.question")}
        </h1>
        <p className="text-muted-foreground mt-2 max-w-lg text-sm leading-relaxed">
          {t("workbench.chat.empty.description")}
        </p>
      </div>

      <div className={`relative z-10 ${NEW_THREAD_COMPOSER_WIDTH_CLASS_NAME}`}>{children}</div>

      <div className="relative z-10 mt-5 flex flex-wrap justify-center gap-2">
        {starterPrompts.map((prompt) => (
          <ThreadPrimitive.Suggestion
            key={prompt}
            prompt={prompt}
            method="replace"
            autoSend={canAutoSendSuggestion}
            className="hover:bg-muted focus-visible:ring-ring rounded-full border px-4 py-2 text-sm transition-colors outline-none focus-visible:ring-2"
          >
            {prompt}
          </ThreadPrimitive.Suggestion>
        ))}
      </div>
    </div>
  );
}
