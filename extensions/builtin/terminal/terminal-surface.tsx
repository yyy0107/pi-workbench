"use client";

import "@xterm/xterm/css/xterm.css";

import { useAuiState } from "@assistant-ui/react";
import { SquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ITerminalInitOnlyOptions, ITerminalOptions, ITheme, Terminal } from "@xterm/xterm";

import { useRightWorkspace } from "@/components/right-workspace";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import type { WorkspaceSurfaceProps } from "@/platform/extensions";
import {
  parseTerminalServerFrame,
  TERMINAL_WEBSOCKET_PATH,
  type TerminalClientFrame,
  type TerminalErrorCode,
} from "@/runtime/terminal/contracts";

import { normalizeTerminalTabTitle, terminalTabTitleFromPrompt } from "./terminal-tab-title";
import {
  isTerminalTranscriptTarget,
  type TerminalPtyTarget,
  type TerminalTarget,
  type TerminalTranscriptTarget,
} from "./terminal-target";
import {
  bashCommandFromArgs,
  findBashToolCall,
  findBashToolCallMessage,
  terminalOutputAppendDelta,
  terminalResultLines,
} from "./terminal-tool-transcript";
import { createTerminalFrameWriter, type TerminalFrameWriter } from "./terminal-frame-writer";

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

function resolveTerminalFontFamily(container: HTMLElement): string {
  const geistMono = getComputedStyle(container).getPropertyValue("--font-geist-mono").trim();
  return geistMono ? `${geistMono}, ${TERMINAL_MONOSPACE_FALLBACK}` : TERMINAL_MONOSPACE_FALLBACK;
}

const LIGHT_ANSI_THEME = {
  black: "#24292f",
  red: "#cf222e",
  green: "#116329",
  yellow: "#9a6700",
  blue: "#0969da",
  magenta: "#8250df",
  cyan: "#1b7c83",
  white: "#6e7781",
  brightBlack: "#57606a",
  brightRed: "#a40e26",
  brightGreen: "#1a7f37",
  brightYellow: "#9a6700",
  brightBlue: "#218bff",
  brightMagenta: "#a475f9",
  brightCyan: "#3192aa",
  brightWhite: "#24292f",
} satisfies ITheme;

const DARK_ANSI_THEME = {
  black: "#484f58",
  red: "#ff7b72",
  green: "#3fb950",
  yellow: "#d29922",
  blue: "#58a6ff",
  magenta: "#bc8cff",
  cyan: "#39c5cf",
  white: "#b1bac4",
  brightBlack: "#6e7681",
  brightRed: "#ffa198",
  brightGreen: "#56d364",
  brightYellow: "#e3b341",
  brightBlue: "#79c0ff",
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

function resolveTerminalTheme(container: HTMLElement): ITheme {
  const root = container.ownerDocument.documentElement;
  const themeBackground = resolveThemeColor(container, "--background", "#ffffff");
  const background = resolveThemeColor(container, "--workbench-canvas-background", themeBackground);
  const foreground = resolveThemeColor(container, "--foreground", "#18181b");
  const accent = resolveThemeColor(container, "--primary", foreground);
  const muted = resolveThemeColor(container, "--muted", background);

  return {
    ...(root.classList.contains("dark") ? DARK_ANSI_THEME : LIGHT_ANSI_THEME),
    background,
    foreground,
    cursor: accent,
    cursorAccent: background,
    selectionBackground: accent,
    selectionInactiveBackground: muted,
  };
}

function synchronizeTerminalTheme(container: HTMLElement, terminal: Terminal): () => void {
  const root = container.ownerDocument.documentElement;
  let updateFrame: number | undefined;
  const update = () => {
    if (updateFrame !== undefined) cancelAnimationFrame(updateFrame);
    updateFrame = requestAnimationFrame(() => {
      updateFrame = undefined;
      terminal.options.theme = resolveTerminalTheme(container);
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
    cursorBlink: !disabledStdin,
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

function terminalSocketUrl(
  target: Pick<TerminalPtyTarget, "sessionId" | "cwd">,
  cols: number,
  rows: number,
): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(TERMINAL_WEBSOCKET_PATH, `${protocol}//${window.location.host}`);
  url.searchParams.set("sessionId", target.sessionId);
  if (target.cwd) url.searchParams.set("cwd", target.cwd);
  url.searchParams.set("cols", String(cols));
  url.searchParams.set("rows", String(rows));
  return url.toString();
}

function toolTerminalSocketUrl(
  target: Pick<TerminalTranscriptTarget, "piSessionId" | "toolCallId">,
  cols: number,
  rows: number,
): string | undefined {
  if (!target.piSessionId) return undefined;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(TERMINAL_WEBSOCKET_PATH, `${protocol}//${window.location.host}`);
  url.searchParams.set("sessionId", target.piSessionId);
  url.searchParams.set("toolCallId", target.toolCallId);
  url.searchParams.set("cols", String(cols));
  url.searchParams.set("rows", String(rows));
  return url.toString();
}

function terminalText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replaceAll("\n", "\r\n");
}

export function TerminalSurface({ surface }: WorkspaceSurfaceProps<TerminalTarget>) {
  if (isTerminalTranscriptTarget(surface.params)) {
    return (
      <TerminalTranscriptSurface
        surfaceId={surface.id}
        surfaceTitle={surface.title}
        target={surface.params}
      />
    );
  }

  return <PtyTerminalSurface surfaceId={surface.id} target={surface.params} />;
}

function TerminalTranscriptSurface({
  surfaceId,
  surfaceTitle,
  target,
}: {
  surfaceId: string;
  surfaceTitle: string;
  target: TerminalTranscriptTarget;
}) {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const interruptRef = useRef<() => void>(() => {});
  const fallbackSnapshotRef = useRef<{ command: string; output: string } | undefined>(undefined);
  const [connection, setConnection] = useState<ToolConnectionStatus>({ phase: "connecting" });
  const { piSessionId, toolCallId } = target;
  const message = useAuiState((state) =>
    findBashToolCallMessage(state.thread.messages, toolCallId),
  );
  const part = message ? findBashToolCall([message], toolCallId) : undefined;
  const command = bashCommandFromArgs(part?.args) ?? target.command;
  const output = terminalResultLines(part?.result ?? part?.artifact).join("\n");
  const statusType = message?.status.type;
  const running = statusType === "running" && part?.result === undefined;
  const failed =
    Boolean(part?.isError) || (statusType === "incomplete" && part?.result === undefined);
  const statusLabel = !part
    ? t("extensions.terminal.transcript.unavailable")
    : failed
      ? t("extensions.terminal.transcript.failed")
      : statusType === "requires-action"
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
    let attempts = 0;
    let socket: WebSocket | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let resizeFrame: number | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let dataSubscription: { dispose(): void } | undefined;
    let terminal: Terminal | undefined;
    let terminalWriter: TerminalFrameWriter | undefined;
    let stopThemeSync: (() => void) | undefined;

    const start = async () => {
      const [{ Terminal: XtermTerminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        document.fonts.ready,
      ]);
      if (disposed) return;

      const fitAddon = new FitAddon();
      terminal = new XtermTerminal(xtermOptions(container, true));
      terminal.loadAddon(fitAddon);
      terminal.open(container);
      const writer = createTerminalFrameWriter(terminal);
      terminalWriter = writer;
      stopThemeSync = synchronizeTerminalTheme(container, terminal);
      terminalRef.current = terminal;
      fitAddon.fit();

      const send = (frame: TerminalClientFrame): boolean => {
        if (!ready || socket?.readyState !== WebSocket.OPEN) return false;
        socket.send(JSON.stringify(frame));
        return true;
      };
      const showFallback = () => {
        if (disposed || !terminal) return;
        ready = false;
        terminal.options.disableStdin = true;
        terminal.options.cursorBlink = false;
        setConnection({ phase: "fallback" });
      };
      const connect = () => {
        if (disposed || exited || !terminal) return;
        const url = toolTerminalSocketUrl(
          { piSessionId, toolCallId },
          terminal.cols,
          terminal.rows,
        );
        if (!url) {
          showFallback();
          return;
        }
        if (attempts > 0) {
          writer.flush();
          terminal.reset();
        }
        ready = false;
        setConnection(attempts === 0 ? { phase: "connecting" } : { phase: "disconnected" });
        const nextSocket = new WebSocket(url);
        socket = nextSocket;
        nextSocket.addEventListener("message", (event) => {
          if (disposed || typeof event.data !== "string" || nextSocket !== socket) return;
          let value: unknown;
          try {
            value = JSON.parse(event.data);
          } catch {
            return;
          }
          const frame = parseTerminalServerFrame(value);
          if (!frame || !terminal) return;
          if (frame.type === "data") writer.enqueue(frame.data);
          else if (frame.type === "ready") {
            writer.flush();
            ready = true;
            attempts = 0;
            terminal.options.disableStdin = false;
            terminal.options.cursorBlink = true;
            setConnection({ phase: "connected" });
            send({ type: "resize", cols: terminal.cols, rows: terminal.rows });
            terminal.focus();
          } else if (frame.type === "exit") {
            writer.flush();
            exited = true;
            ready = false;
            terminal.options.disableStdin = true;
            terminal.options.cursorBlink = false;
            setConnection({ phase: "exited", exitCode: frame.exitCode });
          } else if (frame.code === "invalid-session") {
            writer.flush();
            exited = true;
            showFallback();
          } else {
            writer.flush();
            exited = true;
            ready = false;
            setConnection({ phase: "error" });
          }
        });
        nextSocket.addEventListener("close", (event) => {
          if (disposed || nextSocket !== socket || exited) return;
          writer.flush();
          ready = false;
          terminal!.options.disableStdin = true;
          if (event.code === 1008) {
            exited = true;
            showFallback();
            return;
          }
          attempts += 1;
          const delay = Math.min(10_000, 250 * 2 ** Math.min(attempts, 6));
          reconnectTimer = setTimeout(connect, delay);
        });
      };

      dataSubscription = terminal.onData((data) => send({ type: "input", data }));
      resizeObserver = new ResizeObserver(() => {
        if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => {
          if (
            disposed ||
            !terminal ||
            container.clientWidth === 0 ||
            container.clientHeight === 0
          ) {
            return;
          }
          fitAddon.fit();
          send({ type: "resize", cols: terminal.cols, rows: terminal.rows });
        });
      });
      resizeObserver.observe(container);
      interruptRef.current = () => {
        if (!send({ type: "interrupt" })) return;
        terminal!.options.disableStdin = true;
        setConnection({ phase: "stopping" });
      };
      connect();
    };

    void start();
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      resizeObserver?.disconnect();
      dataSubscription?.dispose();
      stopThemeSync?.();
      socket?.close(1000, "surface closed");
      terminalWriter?.dispose();
      terminal?.dispose();
      terminalRef.current = null;
      interruptRef.current = () => {};
    };
  }, [piSessionId, toolCallId]);

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
    connection.phase === "connecting"
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
      style={{ backgroundColor: "var(--workbench-canvas-background, var(--background))" }}
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
          className="bg-background/85 text-muted-foreground hover:bg-muted hover:text-foreground absolute end-2 top-2 z-10 opacity-100 shadow-sm backdrop-blur-sm transition-opacity md:pointer-events-none md:opacity-0 md:group-hover/terminal:pointer-events-auto md:group-hover/terminal:opacity-100 md:group-focus-within/terminal:pointer-events-auto md:group-focus-within/terminal:opacity-100"
          aria-label={t("extensions.terminal.transcript.stop")}
          title={t("extensions.terminal.transcript.stop")}
          onClick={() => interruptRef.current()}
        >
          <SquareIcon className="size-4" fill="currentColor" />
        </Button>
      ) : null}
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-hidden p-2 [&_.xterm]:h-full [&_.xterm-viewport]:!bg-transparent [&_.xterm-viewport]:!overflow-y-auto"
      />
    </section>
  );
}

function PtyTerminalSurface({
  surfaceId,
  target,
}: {
  surfaceId: string;
  target: TerminalPtyTarget;
}) {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const containerRef = useRef<HTMLDivElement>(null);
  const { sessionId, cwd } = target;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let ready = false;
    let exited = false;
    let generation = 0;
    let attempts = 0;
    let socket: WebSocket | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let resizeFrame: number | undefined;
    let titleTimer: ReturnType<typeof setTimeout> | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let dataSubscription: { dispose(): void } | undefined;
    let titleSubscription: { dispose(): void } | undefined;
    let terminal: Terminal | undefined;
    let terminalWriter: TerminalFrameWriter | undefined;
    let stopThemeSync: (() => void) | undefined;
    let promptTitleResolved = false;
    let lastReportedTitle: string | undefined;

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
      if (!ready || socket?.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify(frame));
      return true;
    };
    const start = async () => {
      const [{ Terminal: XtermTerminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        document.fonts.ready,
      ]);
      if (disposed) return;

      const fitAddon = new FitAddon();
      terminal = new XtermTerminal(xtermOptions(container));
      terminal.loadAddon(fitAddon);
      terminal.open(container);
      const writer = createTerminalFrameWriter(terminal);
      terminalWriter = writer;
      stopThemeSync = synchronizeTerminalTheme(container, terminal);
      fitAddon.fit();
      terminal.focus();
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
      const scheduleReconnect = (ownGeneration: number) => {
        if (disposed || exited || ownGeneration !== generation) return;
        const delay = Math.min(10_000, 250 * 2 ** Math.min(attempts++, 6));
        reconnectTimer = setTimeout(connect, delay);
      };
      const connect = () => {
        if (disposed || exited) return;
        const ownGeneration = ++generation;
        ready = false;
        reportStatus(attempts === 0 ? { phase: "connecting" } : { phase: "disconnected" });
        const nextSocket = new WebSocket(
          terminalSocketUrl(
            { sessionId, ...(cwd ? { cwd } : {}) },
            terminal?.cols ?? 100,
            terminal?.rows ?? 30,
          ),
        );
        socket = nextSocket;
        nextSocket.addEventListener("message", (event) => {
          if (disposed || ownGeneration !== generation || typeof event.data !== "string") return;
          let value: unknown;
          try {
            value = JSON.parse(event.data);
          } catch {
            return;
          }
          const frame = parseTerminalServerFrame(value);
          if (!frame || !terminal) return;
          if (frame.type === "data") {
            writer.enqueue(frame.data, schedulePromptTitle);
          } else if (frame.type === "ready") {
            writer.flush();
            ready = true;
            attempts = 0;
            reportStatus({
              phase: "connected",
              process: frame.process,
              pid: frame.pid,
              cwd: frame.cwd,
            });
            send({ type: "resize", cols: terminal.cols, rows: terminal.rows });
          } else if (frame.type === "exit") {
            writer.flush();
            exited = true;
            ready = false;
            reportStatus({ phase: "exited", exitCode: frame.exitCode });
            terminal.writeln(
              `\r\n${t("extensions.terminal.status.exited", { code: frame.exitCode })}`,
            );
          } else {
            writer.flush();
            exited = true;
            ready = false;
            reportStatus({ phase: "error", code: frame.code });
            terminal.writeln(`\r\n${t("extensions.terminal.status.error")}`);
          }
        });
        nextSocket.addEventListener("close", (event) => {
          if (disposed || ownGeneration !== generation || exited) return;
          writer.flush();
          ready = false;
          if (event.code === 1008) {
            exited = true;
            reportStatus({ phase: "error", code: "invalid-session" });
            return;
          }
          reportStatus({ phase: "disconnected" });
          scheduleReconnect(ownGeneration);
        });
      };

      dataSubscription = terminal.onData((data) => send({ type: "input", data }));
      resizeObserver = new ResizeObserver(() => {
        if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => {
          if (
            disposed ||
            !terminal ||
            container.clientWidth === 0 ||
            container.clientHeight === 0
          ) {
            return;
          }
          fitAddon.fit();
          send({ type: "resize", cols: terminal.cols, rows: terminal.rows });
        });
      });
      resizeObserver.observe(container);
      connect();
    };

    void start();
    return () => {
      disposed = true;
      generation += 1;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (titleTimer) clearTimeout(titleTimer);
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      resizeObserver?.disconnect();
      dataSubscription?.dispose();
      titleSubscription?.dispose();
      stopThemeSync?.();
      socket?.close(1000, "surface closed");
      terminalWriter?.dispose();
      terminal?.dispose();
    };
  }, [controller, cwd, sessionId, surfaceId, t]);

  return (
    <section
      className="text-foreground flex size-full min-h-0 flex-col"
      style={{ backgroundColor: "var(--workbench-canvas-background, var(--background))" }}
      aria-label={t("extensions.terminal.output")}
    >
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-hidden p-2 [&_.xterm]:h-full [&_.xterm-viewport]:!bg-transparent [&_.xterm-viewport]:!overflow-y-auto"
      />
    </section>
  );
}
