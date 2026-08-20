"use client";

import { Trash2Icon } from "lucide-react";
import { useAuiState } from "@assistant-ui/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { useI18n } from "@/i18n";
import type { PanelComponentProps } from "@/platform/extensions";

import { terminalSessionStore } from "./terminal-session-store";

export function TerminalPanel({ panelId }: PanelComponentProps) {
  const { t } = useI18n();
  const mainThreadId = useAuiState((state) => state.threads.mainThreadId);
  const mainThread = useAuiState((state) =>
    state.threads.threadItems.find((thread) => thread.id === state.threads.mainThreadId),
  );
  const workspaceId =
    typeof mainThread?.custom?.piWorkspaceId === "string"
      ? mainThread.custom.piWorkspaceId
      : "application";
  // The assistant-ui thread id stays stable while a draft thread is promoted to a
  // remote Pi session. Using remoteId here would silently swap terminal history
  // as soon as the first prompt creates that session.
  const sessionId = `${workspaceId}:${mainThreadId}`;
  const lines = useSyncExternalStore(
    terminalSessionStore.subscribe,
    () => terminalSessionStore.getLines(sessionId),
    () => terminalSessionStore.getLines(sessionId),
  );
  const [input, setInput] = useState("");
  const scrollArea = useRef<HTMLDivElement>(null);

  useEffect(() => {
    terminalSessionStore.ensure(sessionId, [
      { kind: "muted", text: t("extensions.terminal.welcome") },
      { kind: "output", text: t("extensions.terminal.hint") },
    ]);
  }, [sessionId, t]);

  useEffect(() => {
    const element = scrollArea.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lines]);

  const clear = () => terminalSessionStore.clear(sessionId);

  const submit = () => {
    const command = input.trim();
    if (!command) return;

    setInput("");

    if (command.toLowerCase() === "clear") {
      clear();
      return;
    }

    const normalizedCommand = command.toLowerCase().replaceAll(/\s+/g, " ");
    const responses: Readonly<Record<string, readonly string[]>> = {
      help: [t("extensions.terminal.helpCommands"), t("extensions.terminal.helpSafety")],
      pwd: ["~/workbench-ui"],
      whoami: ["workbench"],
      "git status": [t("extensions.terminal.gitBranch"), t("extensions.terminal.gitStatus")],
      "pnpm dev": [t("extensions.terminal.devNotStarted"), t("extensions.terminal.devHint")],
    };
    const response = responses[normalizedCommand] ?? [
      t("extensions.terminal.unavailable", { command }),
      t("extensions.terminal.unavailableHint"),
    ];
    terminalSessionStore.append(sessionId, [
      { kind: "command", text: command },
      ...response.map((text) => ({
        kind: "output" as const,
        text,
      })),
    ]);
  };

  return (
    <section
      data-panel-id={panelId}
      className="flex h-full min-h-0 flex-col bg-[#0d1117] text-[#d1d7e0]"
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-white/8 bg-[#11161d] px-3">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#8b949e]">
          {t("extensions.terminal.session")}
        </span>
        <button
          type="button"
          aria-label={t("extensions.terminal.clear")}
          className="flex size-6 items-center justify-center rounded text-[#8b949e] transition-colors hover:bg-white/8 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
          onClick={clear}
        >
          <Trash2Icon className="size-3.5" />
        </button>
      </div>

      <div
        ref={scrollArea}
        className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[11px] leading-5"
      >
        <div role="log" aria-live="polite" aria-label={t("extensions.terminal.output")}>
          {lines.map((line) => (
            <div
              key={line.id}
              className={
                line.kind === "muted"
                  ? "text-[#6e7681]"
                  : line.kind === "command"
                    ? "text-[#f0f6fc]"
                    : "whitespace-pre-wrap text-[#b7c0cc]"
              }
            >
              {line.kind === "command" && <span className="mr-2 text-[#3fb950]">❯</span>}
              {line.text}
            </div>
          ))}
        </div>

        <form
          className="flex min-w-0 items-center"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <span className="mr-2 text-[#3fb950]">❯</span>
          <label className="sr-only" htmlFor="workbench-terminal-input">
            {t("extensions.terminal.input")}
          </label>
          <input
            id="workbench-terminal-input"
            autoComplete="off"
            spellCheck={false}
            value={input}
            className="min-w-0 flex-1 bg-transparent text-[#f0f6fc] caret-[#58a6ff] outline-none"
            onChange={(event) => setInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.ctrlKey && event.key.toLowerCase() === "l") {
                event.preventDefault();
                clear();
              }
            }}
          />
        </form>
      </div>
    </section>
  );
}
