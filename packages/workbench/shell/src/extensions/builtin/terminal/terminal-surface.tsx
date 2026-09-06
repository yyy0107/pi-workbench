"use client";

import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import {
  Terminal,
  type ITerminalInitOnlyOptions,
  type ITerminalOptions,
  type ITheme,
} from "@xterm/xterm";
import { SquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createRuntimeWebSocketFactory, type RuntimeWebSocket } from "@workbench/host-client";
import {
  createTerminalFrameWriter,
  isInvalidTerminalSessionClose,
  isTerminalSocketWritable,
  normalizeTerminalTabTitle,
  ptyTerminalSocketPath,
  terminalReconnectDelay,
  terminalTabTitleFromPrompt,
  toolTerminalSocketPath,
  type TerminalFrameWriter,
} from "@workbench/terminal-client";
import {
  parseTerminalServerFrame,
  type TerminalClientFrame,
  type TerminalErrorCode,
  type TerminalInteractionState,
  workbenchBashInputFromArgs,
} from "@workbench/terminal-contracts";

import type { WorkspaceSurfaceProps } from "@workbench/extension-sdk";

import { resolveWorkbenchShellOwner } from "../../../dom";
import { useI18n } from "../../../i18n";
import { useRightWorkspace } from "../../../right-workspace-react";
import { useRuntimeConnection } from "../../../runtime-connection";
import { Button } from "../../../ui";

import {
  isTerminalTranscriptTarget,
  type TerminalPtyTarget,
  type TerminalTarget,
  type TerminalTranscriptTarget,
} from "./terminal-target";
import {
  bashCommandFromArgs,
  terminalOutputAppendDelta,
  terminalResultLines,
} from "./terminal-tool-transcript";
import styles from "./terminal-surface.module.css";
import { useTerminalToolCall } from "./use-terminal-tool-call";
import { createTerminalResizeObserver } from "./terminal-resize-observer";

type ConnectionStatus =
  | { phase: "connecting" }
  | { phase: "connected"; process: string; pid: number; cwd: string }
  | { phase: "disconnected" }
  | { phase: "exited"; exitCode: number }
  | { phase: "error"; code: TerminalErrorCode };

type ToolConnectionStatus =
  | { phase: "connecting" }
  | { phase: "connected" }
  | { phase: "disconnected" }
  | { phase: "stopping" }
  | { phase: "exited"; exitCode: number }
  | { phase: "fallback" }
  | { phase: "error" };

const TERMINAL_MONOSPACE_FALLBACK =
  'ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
const TERMINAL_SCROLLBAR_FALLBACK_SIZE = 16;
const TERMINAL_VIEWPORT_CLASS_NAME = `${styles.scrollbarTheme} min-h-0 flex-1 overflow-hidden py-2 ps-2 [&_.xterm]:h-full [&_.xterm-viewport]:!bg-transparent [&_.xterm-viewport]:!overflow-y-auto`;

function resolveTerminalFontFamily(container: HTMLElement): string {
  const geistMono = getComputedStyle(container).getPropertyValue("--font-geist-mono").trim();
  return geistMono ? `${geistMono}, ${TERMINAL_MONOSPACE_FALLBACK}` : TERMINAL_MONOSPACE_FALLBACK;
}

const LIGHT_ANSI_THEME = {
  black: "#24292f",
  red: "#cf222e",
  green: "#116329",
  yellow: "#9a6700",
  magenta: "#8250df",
  cyan: "#1b7c83",
  white: "#6e7781",
  brightBlack: "#57606a",
  brightRed: "#a40e26",
  brightGreen: "#1a7f37",
  brightYellow: "#9a6700",
  brightMagenta: "#a475f9",
  brightCyan: "#3192aa",
  brightWhite: "#24292f",
} satisfies ITheme;

const DARK_ANSI_THEME = {
  black: "#484f58",
  red: "#ff7b72",
  green: "#3fb950",
  yellow: "#d29922",
  magenta: "#bc8cff",
  cyan: "#39c5cf",
  white: "#b1bac4",
  brightBlack: "#6e7681",
  brightRed: "#ffa198",
  brightGreen: "#56d364",
  brightYellow: "#e3b341",
  brightMagenta: "#d2a8ff",
  brightCyan: "#56d4dd",
  brightWhite: "#f0f6fc",
} satisfies ITheme;

function resolveThemeColor(container: HTMLElement, property: string, fallback: string): string {
  const probe = container.ownerDocument.createElement("span");
  probe.style.color = `var(${property}, ${fallback})`;
  probe.style.display = "none";
  container.append(probe);
  const color = container.ownerDocument.defaultView?.getComputedStyle(probe).color.trim();
  probe.remove();
  return color || fallback;
}

function resolveThemeLength(container: HTMLElement, property: string, fallback: number): number {
  const probe = container.ownerDocument.createElement("span");
  probe.style.display = "block";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.width = `var(${property}, ${fallback}px)`;
  container.append(probe);
  const width = Number.parseFloat(
    container.ownerDocument.defaultView?.getComputedStyle(probe).width ?? "",
  );
  probe.remove();
  return Number.isFinite(width) && width > 0 ? width : fallback;
}

function resolveTerminalTheme(container: HTMLElement): ITheme {
  const root = resolveWorkbenchShellOwner(container);
  const themeBackground = resolveThemeColor(container, "--background", "#ffffff");
  const background = resolveThemeColor(container, "--workbench-surface-base", themeBackground);
  const foreground = resolveThemeColor(container, "--foreground", "#18181b");
  const accent = resolveThemeColor(container, "--primary", foreground);
  const muted = resolveThemeColor(container, "--muted", background);

  return {
    ...(root.classList.contains("dark") ? DARK_ANSI_THEME : LIGHT_ANSI_THEME),
    // Standard shell prompts use ANSI blue (or bold blue) for the working directory.
    blue: accent,
    brightBlue: accent,
    background,
    foreground,
    cursor: accent,
    cursorAccent: background,
    selectionBackground: accent,
    selectionInactiveBackground: muted,
  };
}

function synchronizeTerminalTheme(container: HTMLElement, terminal: Terminal): () => void {
  const root = resolveWorkbenchShellOwner(container);
  let updateFrame: number | undefined;
  const update = () => {
    if (updateFrame !== undefined) cancelAnimationFrame(updateFrame);
    updateFrame = requestAnimationFrame(() => {
      updateFrame = undefined;
      terminal.options.theme = resolveTerminalTheme(container);
      terminal.options.overviewRuler = {
        width: resolveThemeLength(
          container,
          "--scrollbar-hit-size",
          TERMINAL_SCROLLBAR_FALLBACK_SIZE,
        ),
      };
    });
  };
  const observer = new MutationObserver(update);

  observer.observe(root, {
    attributes: true,
    attributeFilter: ["class", "style", "data-workbench-appearance"],
  });
  update();

  return () => {
    observer.disconnect();
    if (updateFrame !== undefined) cancelAnimationFrame(updateFrame);
  };
}

function xtermOptions(
  container: HTMLElement,
  disabledStdin = false,
): ITerminalOptions & ITerminalInitOnlyOptions {
  return {
    convertEol: true,
    // The DOM renderer's blink animation continuously recalculates styles even while idle.
    cursorBlink: false,
    cursorStyle: "block",
    disableStdin: disabledStdin,
    fontFamily: resolveTerminalFontFamily(container),
    fontSize: 12,
    fontWeight: "400",
    fontWeightBold: "700",
    letterSpacing: 0,
    lineHeight: 1.25,
    logLevel: "off",
    minimumContrastRatio: 4.5,
    screenReaderMode: true,
    scrollback: 10_000,
    overviewRuler: {
      width: resolveThemeLength(
        container,
        "--scrollbar-hit-size",
        TERMINAL_SCROLLBAR_FALLBACK_SIZE,
      ),
    },
    theme: resolveTerminalTheme(container),
  };
}

function currentLogicalLine(terminal: Terminal): string {
  const buffer = terminal.buffer.active;
  const currentRow = buffer.baseY + buffer.cursorY;
  let firstRow = currentRow;
  while (firstRow > 0 && buffer.getLine(firstRow)?.isWrapped) firstRow -= 1;

  let value = "";
  for (let row = firstRow; row <= currentRow; row += 1) {
    value += buffer.getLine(row)?.translateToString(true) ?? "";
  }
  return value;
}

function terminalText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replaceAll("\n", "\r\n");
}

export function TerminalSurface({ surface, isVisible }: WorkspaceSurfaceProps<TerminalTarget>) {
  const { text } = useI18n();

  if (isTerminalTranscriptTarget(surface.params)) {
    return (
      <TerminalTranscriptSurface
        surfaceId={surface.id}
        surfaceTitle={text(surface.title)}
        target={surface.params}
        isVisible={isVisible}
      />
    );
  }

  return (
    <PtyTerminalSurface surfaceId={surface.id} target={surface.params} isVisible={isVisible} />
  );
}

function TerminalTranscriptSurface({
  surfaceId,
  surfaceTitle,
  target,
  isVisible,
}: {
  surfaceId: string;
  surfaceTitle: string;
  target: TerminalTranscriptTarget;
  isVisible: boolean;
}) {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const runtimeConnection = useRuntimeConnection();
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const interruptRef = useRef<() => void>(() => {});
  const synchronizeVisibilityRef = useRef<() => void>(() => {});
  const visibleRef = useRef(isVisible);
  visibleRef.current = isVisible;
  const fallbackSnapshotRef = useRef<{ command: string; output: string } | undefined>(undefined);
  const [connection, setConnection] = useState<ToolConnectionStatus>({ phase: "connecting" });
  const [interactionState, setInteractionState] = useState<TerminalInteractionState>("none");
  const { piSessionId, toolCallId } = target;
  const block = useTerminalToolCall(target);
  const command = bashCommandFromArgs(block?.arguments) ?? target.command;
  const output = terminalResultLines(block?.result ?? block?.error?.message).join("\n");
  const running = block?.status === "running";
  const userInputRequested =
    running && workbenchBashInputFromArgs(block?.arguments)?.source === "user";
  const failed = block?.status === "error" || block?.status === "incomplete";
  useEffect(() => {
    synchronizeVisibilityRef.current();
  }, [isVisible]);

  const statusLabel = !block
    ? t("extensions.terminal.transcript.unavailable")
    : failed
      ? t("extensions.terminal.transcript.failed")
      : block.status === "requires-action"
        ? t("extensions.terminal.transcript.waiting")
        : running
          ? t("extensions.terminal.transcript.running")
          : t("extensions.terminal.transcript.complete");

  useEffect(() => {
    const title = normalizeTerminalTabTitle(command);
    if (title && title !== surfaceTitle) controller.update(surfaceId, { title });
  }, [command, controller, surfaceId, surfaceTitle]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let ready = false;
    let exited = false;
    let processHandle: string | undefined;
    let attempts = 0;
    let socket: RuntimeWebSocket | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let resizeObserver: ReturnType<typeof createTerminalResizeObserver> | undefined;
    let dataSubscription: { dispose(): void } | undefined;
    let terminal: Terminal | undefined;
    let terminalWriter: TerminalFrameWriter | undefined;
    let stopThemeSync: (() => void) | undefined;
    const createSocket = createRuntimeWebSocketFactory(runtimeConnection);

    const start = () => {
      const fitAddon = new FitAddon();
      terminal = new Terminal(xtermOptions(container, true));
      terminal.loadAddon(fitAddon);
      terminal.open(container);
      const writer = createTerminalFrameWriter(terminal);
      terminalWriter = writer;
      stopThemeSync = synchronizeTerminalTheme(container, terminal);
      terminalRef.current = terminal;
      if (visibleRef.current) fitAddon.fit();

      const send = (frame: TerminalClientFrame): boolean => {
        if (!isTerminalSocketWritable(socket, ready)) return false;
        socket.send(JSON.stringify(frame));
        return true;
      };
      const fitTerminal = () => {
        if (
          disposed ||
          !visibleRef.current ||
          !terminal ||
          container.clientWidth === 0 ||
          container.clientHeight === 0
        ) {
          return;
        }
        const { cols, rows } = terminal;
        fitAddon.fit();
        if (processHandle && (terminal.cols !== cols || terminal.rows !== rows)) {
          send({
            type: "process/resize",
            processHandle,
            cols: terminal.cols,
            rows: terminal.rows,
          });
        }
      };
      synchronizeVisibilityRef.current = () => {
        if (!terminal) return;
        if (visibleRef.current) {
          resizeObserver?.observe();
        } else {
          resizeObserver?.disconnect();
        }
      };
      const showFallback = () => {
        if (disposed || !terminal) return;
        ready = false;
        processHandle = undefined;
        setInteractionState("none");
        terminal.options.disableStdin = true;
        setConnection({ phase: "fallback" });
      };
      const connect = () => {
        if (disposed || exited || !terminal) return;
        const path = toolTerminalSocketPath(
          { sessionId: piSessionId, toolCallId },
          { cols: terminal.cols, rows: terminal.rows },
        );
        if (!path) {
          showFallback();
          return;
        }
        if (attempts > 0) {
          writer.flush();
          terminal.reset();
        }
        ready = false;
        setConnection(attempts === 0 ? { phase: "connecting" } : { phase: "disconnected" });
        const nextSocket = createSocket(path);
        socket = nextSocket;
        nextSocket.onmessage = (event) => {
          if (disposed || typeof event.data !== "string" || nextSocket !== socket) return;
          let value: unknown;
          try {
            value = JSON.parse(event.data);
          } catch {
            return;
          }
          const frame = parseTerminalServerFrame(value);
          if (!frame || !terminal) return;
          if (frame.type === "process/output-delta") writer.enqueue(frame.delta.data);
          else if (frame.type === "process/state") {
            setInteractionState(frame.interactionState);
          } else if (frame.type === "process/ready") {
            writer.flush();
            processHandle = frame.process.processHandle;
            ready = true;
            attempts = 0;
            setInteractionState(frame.process.interactionState);
            terminal.options.disableStdin = false;
            setConnection({ phase: "connected" });
            if (visibleRef.current) {
              send({
                type: "process/resize",
                processHandle,
                cols: terminal.cols,
                rows: terminal.rows,
              });
              terminal.focus();
            }
          } else if (frame.type === "process/exited") {
            writer.flush();
            exited = true;
            ready = false;
            setInteractionState("none");
            terminal.options.disableStdin = true;
            setConnection({ phase: "exited", exitCode: frame.exit.exitCode });
          } else if (frame.type === "process/error" && frame.code === "invalid-session") {
            writer.flush();
            exited = true;
            showFallback();
          } else if (frame.type === "process/error") {
            writer.flush();
            exited = true;
            ready = false;
            terminal.options.disableStdin = true;
            setConnection({ phase: "error" });
          }
        };
        nextSocket.onclose = (event) => {
          if (disposed || nextSocket !== socket || exited) return;
          writer.flush();
          ready = false;
          terminal!.options.disableStdin = true;
          if (isInvalidTerminalSessionClose(event)) {
            exited = true;
            showFallback();
            return;
          }
          attempts += 1;
          const delay = terminalReconnectDelay(attempts, {
            baseMs: 250,
            maxMs: 10_000,
            exponentCap: 6,
          });
          reconnectTimer = setTimeout(connect, delay);
        };
      };

      dataSubscription = terminal.onData((data) =>
        processHandle ? send({ type: "process/write-stdin", processHandle, data }) : false,
      );
      resizeObserver = createTerminalResizeObserver(container, fitTerminal);
      if (visibleRef.current) resizeObserver.observe();
      void document.fonts.ready.then(() => {
        if (disposed || !terminal) return;
        terminal.options.fontFamily = resolveTerminalFontFamily(container);
        resizeObserver?.schedule();
      });
      interruptRef.current = () => {
        if (!processHandle || !send({ type: "process/terminate", processHandle })) return;
        terminal!.options.disableStdin = true;
        setConnection({ phase: "stopping" });
      };
      connect();
    };

    start();
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      resizeObserver?.disconnect();
      dataSubscription?.dispose();
      stopThemeSync?.();
      socket?.close(1000, "surface closed");
      terminalWriter?.dispose();
      terminal?.dispose();
      terminalRef.current = null;
      interruptRef.current = () => {};
      synchronizeVisibilityRef.current = () => {};
    };
  }, [piSessionId, runtimeConnection, toolCallId]);

  useEffect(() => {
    if (connection.phase !== "fallback") {
      fallbackSnapshotRef.current = undefined;
      return;
    }
    const terminal = terminalRef.current;
    if (!terminal) return;

    const previous = fallbackSnapshotRef.current;
    if (previous?.command === command) {
      const delta = terminalOutputAppendDelta(previous.output, output);
      if (delta !== undefined) {
        if (delta) terminal.write(terminalText(delta));
        fallbackSnapshotRef.current = { command, output };
        return;
      }
    }

    terminal.reset();
    terminal.write(`$ ${terminalText(command)}\r\n`);
    if (output) terminal.write(terminalText(output));
    fallbackSnapshotRef.current = { command, output };
  }, [command, connection.phase, output]);

  const connectionLabel =
    interactionState === "active"
      ? t("extensions.terminal.transcript.interactionActive")
      : userInputRequested
        ? t("extensions.terminal.transcript.userInputRequested")
        : interactionState === "possible"
          ? t("extensions.terminal.transcript.interactionPossible")
          : connection.phase === "connecting"
            ? t("extensions.terminal.transcript.connecting")
            : connection.phase === "disconnected"
              ? t("extensions.terminal.transcript.reconnecting")
              : connection.phase === "stopping"
                ? t("extensions.terminal.transcript.stopping")
                : connection.phase === "error"
                  ? t("extensions.terminal.transcript.connectionError")
                  : statusLabel;

  return (
    <section
      className="group/terminal text-foreground relative flex size-full min-h-0 flex-col"
      aria-label={t("extensions.terminal.transcript.output")}
      aria-busy={running || connection.phase === "stopping"}
    >
      <span className="sr-only" role="status" aria-live="polite">
        {connectionLabel}
      </span>
      {running && connection.phase === "connected" ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          data-frame="none"
          className="bg-background/85 text-muted-foreground hover:bg-muted hover:text-foreground absolute end-2 top-2 z-10 opacity-100 shadow-sm backdrop-blur-sm transition-opacity md:pointer-events-none md:opacity-0 md:group-hover/terminal:pointer-events-auto md:group-hover/terminal:opacity-100 md:group-focus-within/terminal:pointer-events-auto md:group-focus-within/terminal:opacity-100"
          aria-label={t("extensions.terminal.transcript.stop")}
          title={t("extensions.terminal.transcript.stop")}
          onClick={() => interruptRef.current()}
        >
          <SquareIcon className="size-4" fill="currentColor" />
        </Button>
      ) : null}
      <div ref={containerRef} className={TERMINAL_VIEWPORT_CLASS_NAME} />
    </section>
  );
}

function PtyTerminalSurface({
  surfaceId,
  target,
  isVisible,
}: {
  surfaceId: string;
  target: TerminalPtyTarget;
  isVisible: boolean;
}) {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const runtimeConnection = useRuntimeConnection();
  const containerRef = useRef<HTMLDivElement>(null);
  const synchronizeVisibilityRef = useRef<() => void>(() => {});
  const visibleRef = useRef(isVisible);
  visibleRef.current = isVisible;
  const { sessionId, cwd } = target;
  const pendingInitialCommandRef = useRef<{
    command?: string;
    params: TerminalPtyTarget;
    sessionId: string;
  } | null>(null);

  useEffect(() => {
    synchronizeVisibilityRef.current();
  }, [isVisible]);

  useEffect(() => {
    if (pendingInitialCommandRef.current?.sessionId === sessionId) return;
    const { initialCommand, ...params } = target;
    pendingInitialCommandRef.current = {
      sessionId,
      params,
      ...(typeof initialCommand === "string" && initialCommand.trim()
        ? { command: initialCommand.trim() }
        : {}),
    };
  }, [sessionId, target]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let ready = false;
    let exited = false;
    let processHandle: string | undefined;
    let generation = 0;
    let attempts = 0;
    let socket: RuntimeWebSocket | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let titleTimer: ReturnType<typeof setTimeout> | undefined;
    let resizeObserver: ReturnType<typeof createTerminalResizeObserver> | undefined;
    let dataSubscription: { dispose(): void } | undefined;
    let titleSubscription: { dispose(): void } | undefined;
    let terminal: Terminal | undefined;
    let terminalWriter: TerminalFrameWriter | undefined;
    let stopThemeSync: (() => void) | undefined;
    let promptTitleResolved = false;
    let lastReportedTitle: string | undefined;
    const createSocket = createRuntimeWebSocketFactory(runtimeConnection);

    const reportTabTitle = (value: string) => {
      const title = normalizeTerminalTabTitle(value);
      if (!title || title === lastReportedTitle) return;
      lastReportedTitle = title;
      controller.update(surfaceId, { title });
    };
    const schedulePromptTitle = () => {
      if (disposed || promptTitleResolved) return;
      if (titleTimer) clearTimeout(titleTimer);
      titleTimer = setTimeout(() => {
        if (disposed || promptTitleResolved || !terminal) return;
        const title = terminalTabTitleFromPrompt(currentLogicalLine(terminal));
        if (!title) return;
        promptTitleResolved = true;
        reportTabTitle(title);
      }, 80);
    };

    const send = (frame: TerminalClientFrame): boolean => {
      if (!isTerminalSocketWritable(socket, ready)) return false;
      socket.send(JSON.stringify(frame));
      return true;
    };
    const start = () => {
      const fitAddon = new FitAddon();
      terminal = new Terminal(xtermOptions(container));
      terminal.loadAddon(fitAddon);
      terminal.open(container);
      const writer = createTerminalFrameWriter(terminal);
      terminalWriter = writer;
      stopThemeSync = synchronizeTerminalTheme(container, terminal);
      if (visibleRef.current) fitAddon.fit();
      if (visibleRef.current) terminal.focus();
      titleSubscription = terminal.onTitleChange((title) => {
        const normalized = normalizeTerminalTabTitle(title);
        if (!normalized) return;
        promptTitleResolved = true;
        reportTabTitle(normalized);
      });

      const statusText = (next: ConnectionStatus): string => {
        if (next.phase === "connecting") return t("extensions.terminal.status.connecting");
        if (next.phase === "disconnected") return t("extensions.terminal.status.disconnected");
        if (next.phase === "exited") {
          return t("extensions.terminal.status.exited", { code: next.exitCode });
        }
        if (next.phase === "error") return t("extensions.terminal.status.error");
        return t("extensions.terminal.status.connected");
      };
      const reportStatus = (next: ConnectionStatus) => {
        container.setAttribute("aria-label", statusText(next));
      };
      const fitTerminal = () => {
        if (
          disposed ||
          !visibleRef.current ||
          !terminal ||
          container.clientWidth === 0 ||
          container.clientHeight === 0
        ) {
          return;
        }
        const { cols, rows } = terminal;
        fitAddon.fit();
        if (processHandle && (terminal.cols !== cols || terminal.rows !== rows)) {
          send({
            type: "process/resize",
            processHandle,
            cols: terminal.cols,
            rows: terminal.rows,
          });
        }
      };
      synchronizeVisibilityRef.current = () => {
        if (!terminal) return;
        if (visibleRef.current) {
          resizeObserver?.observe();
        } else {
          resizeObserver?.disconnect();
        }
      };
      const scheduleReconnect = (ownGeneration: number) => {
        if (disposed || exited || ownGeneration !== generation) return;
        const delay = terminalReconnectDelay(attempts++, {
          baseMs: 250,
          maxMs: 10_000,
          exponentCap: 6,
        });
        reconnectTimer = setTimeout(connect, delay);
      };
      const connect = () => {
        if (disposed || exited) return;
        const ownGeneration = ++generation;
        ready = false;
        processHandle = undefined;
        reportStatus(attempts === 0 ? { phase: "connecting" } : { phase: "disconnected" });
        const nextSocket = createSocket(
          ptyTerminalSocketPath(
            { sessionId, ...(cwd ? { cwd } : {}) },
            terminal?.cols ?? 100,
            terminal?.rows ?? 30,
          ),
        );
        socket = nextSocket;
        nextSocket.onmessage = (event) => {
          if (disposed || ownGeneration !== generation || typeof event.data !== "string") return;
          let value: unknown;
          try {
            value = JSON.parse(event.data);
          } catch {
            return;
          }
          const frame = parseTerminalServerFrame(value);
          if (!frame || !terminal) return;
          if (frame.type === "process/output-delta") {
            writer.enqueue(frame.delta.data, schedulePromptTitle);
          } else if (frame.type === "process/state") {
            return;
          } else if (frame.type === "process/ready") {
            writer.flush();
            processHandle = frame.process.processHandle;
            ready = true;
            attempts = 0;
            reportStatus({
              phase: "connected",
              process: frame.process.process,
              pid: frame.process.pid,
              cwd: frame.process.cwd,
            });
            if (visibleRef.current) {
              send({
                type: "process/resize",
                processHandle,
                cols: terminal.cols,
                rows: terminal.rows,
              });
            }
            const pendingLaunch = pendingInitialCommandRef.current;
            const pendingCommand = pendingLaunch?.command;
            if (
              pendingLaunch &&
              pendingCommand &&
              send({ type: "process/run", processHandle, command: pendingCommand })
            ) {
              pendingInitialCommandRef.current = { ...pendingLaunch, command: undefined };
              controller.update(surfaceId, { params: pendingLaunch.params });
            }
          } else if (frame.type === "process/exited") {
            writer.flush();
            exited = true;
            ready = false;
            reportStatus({ phase: "exited", exitCode: frame.exit.exitCode });
            terminal.writeln(
              `\r\n${t("extensions.terminal.status.exited", { code: frame.exit.exitCode })}`,
            );
          } else if (frame.type === "process/error") {
            writer.flush();
            exited = true;
            ready = false;
            reportStatus({ phase: "error", code: frame.code });
            terminal.writeln(`\r\n${t("extensions.terminal.status.error")}`);
          }
        };
        nextSocket.onclose = (event) => {
          if (disposed || ownGeneration !== generation || exited) return;
          writer.flush();
          ready = false;
          if (isInvalidTerminalSessionClose(event)) {
            exited = true;
            reportStatus({ phase: "error", code: "invalid-session" });
            return;
          }
          reportStatus({ phase: "disconnected" });
          scheduleReconnect(ownGeneration);
        };
      };

      dataSubscription = terminal.onData((data) =>
        processHandle ? send({ type: "process/write-stdin", processHandle, data }) : false,
      );
      resizeObserver = createTerminalResizeObserver(container, fitTerminal);
      if (visibleRef.current) resizeObserver.observe();
      void document.fonts.ready.then(() => {
        if (disposed || !terminal) return;
        terminal.options.fontFamily = resolveTerminalFontFamily(container);
        resizeObserver?.schedule();
      });
      connect();
    };

    start();
    return () => {
      disposed = true;
      generation += 1;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (titleTimer) clearTimeout(titleTimer);
      resizeObserver?.disconnect();
      dataSubscription?.dispose();
      titleSubscription?.dispose();
      stopThemeSync?.();
      socket?.close(1000, "surface closed");
      terminalWriter?.dispose();
      terminal?.dispose();
      synchronizeVisibilityRef.current = () => {};
    };
  }, [controller, cwd, runtimeConnection, sessionId, surfaceId, t]);

  return (
    <section
      className="text-foreground flex size-full min-h-0 flex-col"
      aria-label={t("extensions.terminal.output")}
    >
      <div ref={containerRef} className={TERMINAL_VIEWPORT_CLASS_NAME} />
    </section>
  );
}
