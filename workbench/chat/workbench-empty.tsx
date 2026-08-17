"use client";

import { ThreadPrimitive } from "@assistant-ui/react";
import { SparklesIcon } from "lucide-react";

const STARTER_PROMPTS = [
  "Help me plan a small project",
  "Explain a difficult concept simply",
  "Review an idea and find its risks",
] as const;

export function WorkbenchEmpty() {
  return (
    <div className="mx-auto flex w-full max-w-[var(--thread-max-width)] flex-1 flex-col justify-center px-4 py-12">
      <div className="mb-8">
        <div className="bg-primary/10 mb-4 flex size-10 items-center justify-center rounded-xl">
          <SparklesIcon className="size-5" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">What are you working on?</h1>
        <p className="text-muted-foreground mt-2 max-w-lg text-sm leading-relaxed">
          Ask a question, attach context, or open a workbench panel when the conversation needs more
          room.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {STARTER_PROMPTS.map((prompt) => (
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
    </div>
  );
}
