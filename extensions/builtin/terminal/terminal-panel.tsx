"use client";

import { Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { PanelComponentProps } from "@/platform/extensions";

interface TerminalLine {
  id: string;
  kind: "command" | "output" | "muted";
  text: string;
}

const INITIAL_LINES: readonly TerminalLine[] = [
  {
    id: "welcome",
    kind: "muted",
    text: "Workbench Terminal · front-end preview",
  },
  {
    id: "hint",
    kind: "output",
    text: 'Type "help" to see the available mock commands.',
  },
];

const MOCK_RESPONSES: Readonly<Record<string, readonly string[]>> = {
  help: [
    "Available: help, pwd, whoami, git status, pnpm dev, clear",
    "Commands are simulated locally and never reach a shell.",
  ],
  pwd: ["~/workbench-ui"],
  whoami: ["workbench"],
  "git status": [
    "On branch codex/workbench-v1",
    "Mock session — repository state is not inspected here.",
  ],
  "pnpm dev": [
    "Mock only — no process was started.",
    "Use the real project terminal to run pnpm commands.",
  ],
};

export function TerminalPanel({ panelId }: PanelComponentProps) {
  const [lines, setLines] = useState<readonly TerminalLine[]>(INITIAL_LINES);
  const [input, setInput] = useState("");
  const nextLineId = useRef(0);
  const scrollArea = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = scrollArea.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lines]);

  const clear = () => setLines([]);

  const submit = () => {
    const command = input.trim();
    if (!command) return;

    setInput("");

    if (command.toLowerCase() === "clear") {
      clear();
      return;
    }

    const normalizedCommand = command.toLowerCase().replaceAll(/\s+/g, " ");
    const response = MOCK_RESPONSES[normalizedCommand] ?? [
      `mock: command not available: ${command}`,
      'Try "help" for the supported preview commands.',
    ];
    const batchId = nextLineId.current++;

    setLines((current) => [
      ...current,
      { id: `command-${batchId}`, kind: "command", text: command },
      ...response.map((text, index) => ({
        id: `output-${batchId}-${index}`,
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
          Mock session · commands stay in this browser
        </span>
        <button
          type="button"
          aria-label="Clear terminal"
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
        <div role="log" aria-live="polite" aria-label="Terminal output">
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
            Mock terminal command
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
