import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { ExtensionProvider } from "../packages/extension-platform/host/src/extension-provider";
import { SessionContext } from "../packages/agent-runtime/core/client/src/runtime-context";
import { WorkbenchAgentRuntimeEnvironmentProvider } from "../packages/agent-runtime/core/client/src/agent-runtime-context";
import {
  useConversationSession,
  useSessionState,
} from "../packages/agent-runtime/core/client/src/hooks";
import { FakeConversationSession } from "../packages/agent-runtime/core/testkit/src/runtime/fake-agent-runtime";
import { PiConversationAssembler } from "../packages/agent-runtime/runtimes/pi/client/src/conversation/conversation-assembler";
import {
  longConversation,
  appendConversationDelta,
} from "../packages/agent-runtime/runtimes/pi/client/test/fixtures/long-conversation";
import { ConversationList } from "../packages/workbench/shell/src/chat/conversation-list";
import { useWorkbenchConversationViewport } from "../packages/workbench/shell/src/chat/workbench-conversation-viewport";
import { ThreadScrollStateProvider } from "../packages/workbench/shell/src/thread-scroll-state";
import { WorkbenchSettingsProvider } from "../packages/workbench/shell/src/settings";
import { I18nProvider } from "../packages/workbench/shell/src/i18n";
import { createPanelStore } from "../packages/workbench/shell/src/panels/panel-store";
import { messagePresentationExtension } from "../packages/workbench/shell/src/extensions/builtin/message-presentation";
import { ToastProvider } from "../packages/workbench/shell/src/ui/toast";
import { RightWorkspaceProvider } from "../packages/workbench/shell/src/right-workspace/right-workspace-provider";
import { WorkspaceSurfaceRegistryImpl } from "@workbench/extension-sdk/internal";
import type { LocalizableText } from "@workbench/extension-sdk";

const count = Number(new URLSearchParams(location.search).get("count") ?? 100);
const assembler = new PiConversationAssembler("benchmark");
let messages = longConversation(count);
let isRunning = false;
let draft = "";
const publish = () =>
  assembler.update({
    messages,
    isLoading: false,
    isRunning,
    composer: { text: draft, attachments: [], mode: "send", phase: "idle" },
  });
publish();
let reads = 0;
let listeners = 0;
const sources = new Map<string, ReturnType<typeof assembler.node>>();
const session = {
  id: "benchmark",
  snapshot: assembler.snapshot,
  node(key: string) {
    let source = sources.get(key);
    if (!source) {
      const original = assembler.node(key);
      source = {
        getSnapshot() {
          reads++;
          return original.getSnapshot();
        },
        subscribe(listener: () => void) {
          listeners++;
          const off = original.subscribe(listener);
          return () => {
            listeners--;
            off();
          };
        },
      };
      sources.set(key, source);
    }
    return source;
  },
  actions: {
    ...new FakeConversationSession("benchmark").actions,
    setComposerText(text: string) {
      draft = text;
      publish();
    },
  },
};
const panelStore = createPanelStore();
const extensions = [messagePresentationExtension];
const workspace = {
  registry: new WorkspaceSurfaceRegistryImpl(),
  initialContext: { applicationId: "benchmark" },
  createOpener: () => ({ open: async () => {}, getHandlers: () => [], subscribe: () => () => {} }),
  validateLocalizableText: (text: unknown): text is LocalizableText => typeof text === "string",
};
const settings = { load: async () => ({ locale: "en-US" as const }), update: async () => {} };
let persisted: string | null = null;
const persistence = {
  read: () => persisted,
  write: (value: string) => {
    persisted = value;
  },
};
const results: Record<string, unknown> = {};
const nextPaint = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
const percentile = (values: number[]) =>
  values.toSorted((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];

function Viewport() {
  const nodeKeys = useSessionState((snapshot) => snapshot.nodeKeys);
  const running = useSessionState((snapshot) => snapshot.isRunning);
  const viewport = useWorkbenchConversationViewport({
    autoScroll: running,
    isRunning: running,
    nodeKeys,
    scrollToBottomOnInitialize: false,
    sessionId: session.id,
  });
  return (
    <div
      id="viewport"
      ref={viewport.viewportRef}
      tabIndex={0}
      style={{ height: "70vh", overflowY: "auto", overflowAnchor: "none" }}
    >
      <ConversationList renderWorkingStatus={() => <span>Working</span>} />
    </div>
  );
}

function Composer() {
  const { actions } = useConversationSession();
  const text = useSessionState((snapshot) => snapshot.composer.text);
  return (
    <input
      aria-label="Benchmark composer"
      value={text}
      onChange={(event) => actions.setComposerText?.(event.target.value)}
    />
  );
}

function App() {
  const output = useRef<HTMLPreElement>(null);
  const [mounted, setMounted] = useState(true);
  const [revision, setRevision] = useState(0);
  const report = () => {
    if (output.current) output.current.textContent = JSON.stringify(results, null, 2);
  };
  useEffect(() => {
    results.ready = true;
    results.count = count;
    results.environment = {
      userAgent: navigator.userAgent,
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
    };
    report();
  }, []);
  const stream = async () => {
    if (results.error) return;
    results.runs = [];
    for (let run = 0; run < 6; run++) {
      messages = longConversation(count);
      isRunning = true;
      publish();
      await nextPaint();
      const streamMs: number[] = [];
      const inputMs: number[] = [];
      reads = 0;
      const pending: Promise<void>[] = [];
      const feedStarted = performance.now();
      await new Promise<void>((resolve) => {
        let index = 0;
        const timer = setInterval(() => {
          const started = performance.now();
          messages = appendConversationDelta(messages, ` delta-${index}`);
          publish();
          pending.push(
            nextPaint().then(() => {
              streamMs.push(performance.now() - started);
            }),
          );
          if (index % 3 === 0) {
            const inputStarted = performance.now();
            session.actions.setComposerText(`typing-${index}`);
            pending.push(
              nextPaint().then(() => {
                inputMs.push(performance.now() - inputStarted);
              }),
            );
          }
          if (++index === 90) {
            clearInterval(timer);
            resolve();
          }
        }, 1000 / 30);
      });
      const feedMs = performance.now() - feedStarted;
      await Promise.all(pending);
      isRunning = false;
      publish();
      await nextPaint();
      results.stream = {
        run,
        feedMs,
        inputP95: percentile(inputMs),
        streamP95: percentile(streamMs),
        reads,
        listeners,
        dom: document.getElementsByTagName("*").length,
        messages: document.querySelectorAll("[data-conversation-node-key]").length,
        heapBytes: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
          ?.usedJSHeapSize,
        finalText: document
          .querySelector(`[data-conversation-node-key="message-${count - 1}"]`)
          ?.textContent?.includes("delta-89"),
      };
      if (run > 0) (results.runs as unknown[]).push(results.stream);
      report();
    }
  };
  const verify = async () => {
    const viewport = document.getElementById("viewport")!;
    const target = viewport.querySelector<HTMLElement>(
      `[data-conversation-node-key="message-${Math.floor(count / 2)}"]`,
    )!;
    target.scrollIntoView({ block: "start" });
    await nextPaint();
    await nextPaint();
    const bounds = viewport.getBoundingClientRect();
    const range = document.caretRangeFromPoint(bounds.left + bounds.width / 2, bounds.top + 32)!;
    const offset = () => range.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    const initial = offset();
    const earlier = longConversation(50).map((message, index) => ({
      ...message,
      id: `older-${index}`,
      createdAt: new Date(1_724_000_000_000 + index * 60_000),
    }));
    flushSync(() => {
      messages = [...earlier, ...messages];
      publish();
    });
    await nextPaint();
    await nextPaint();
    const prependDrift = offset() - initial;
    const beforeResize = offset();
    viewport.style.width = "600px";
    await nextPaint();
    await nextPaint();
    const resizeDrift = offset() - beforeResize;
    viewport.style.width = "";
    await nextPaint();
    await nextPaint();
    const messageOffset = target.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    flushSync(() => setRevision((value) => value + 1));
    await nextPaint();
    await nextPaint();
    const restoredViewport = document.getElementById("viewport")!;
    const restored = restoredViewport.querySelector<HTMLElement>(
      `[data-conversation-node-key="message-${Math.floor(count / 2)}"]`,
    )!;
    const restoreDrift =
      restored.getBoundingClientRect().top -
      restoredViewport.getBoundingClientRect().top -
      messageOffset;
    results.anchors = {
      prependDrift,
      resizeDrift,
      restoreDrift,
      anchorMessage: range.startContainer.parentElement
        ?.closest("[data-conversation-node-key]")
        ?.getAttribute("data-conversation-node-key"),
      persisted,
    };
    report();
  };
  const reading = async () => {
    const viewport = document.getElementById("viewport")!;
    viewport.dispatchEvent(new WheelEvent("wheel"));
    document.getSelection()?.removeAllRanges();
    const found = (
      window as Window & {
        find: (
          text: string,
          caseSensitive: boolean,
          backwards: boolean,
          wrapAround: boolean,
        ) => boolean;
      }
    ).find("Question 2: explain the result.", false, false, true);
    await nextPaint();
    const first = viewport.querySelector('[data-conversation-node-key="message-2"]')!;
    const second = viewport.querySelector('[data-conversation-node-key="message-4"]')!;
    const range = document.createRange();
    range.setStartBefore(first);
    range.setEndAfter(second);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    const text = document.getSelection()?.toString() ?? "";
    results.reading = {
      found,
      acrossMessages: text.includes("Question 2") && text.includes("Question 4"),
      listeners,
    };
    report();
  };
  return (
    <>
      <header>
        <button onClick={() => void stream()}>Run stream</button>
        <button onClick={() => void verify()}>Verify anchors</button>
        <button onClick={() => void reading()}>Verify reading</button>
        <button onClick={() => setMounted((value) => !value)}>Toggle conversation</button>
        <button onClick={() => setRevision((value) => value + 1)}>Restore conversation</button>
        <button
          onClick={() => {
            document.documentElement.classList.toggle("dark");
          }}
        >
          Toggle theme
        </button>
        <button
          onClick={() => {
            results.reading = {
              selection: document.getSelection()?.toString().length ?? 0,
              listeners,
            };
            report();
          }}
        >
          Read selection
        </button>
      </header>
      <RightWorkspaceProvider {...workspace}>
        <ToastProvider>
          <WorkbenchSettingsProvider service={settings}>
            <I18nProvider initialLocale="en-US">
              <WorkbenchAgentRuntimeEnvironmentProvider id="benchmark" commands={[]}>
                <ExtensionProvider extensions={extensions} panelStore={panelStore}>
                  <SessionContext.Provider value={session}>
                    <ThreadScrollStateProvider persistence={persistence}>
                      <div
                        data-slot="workbench-conversation"
                        style={{ "--assistant-turn-min-height": "5.25rem" } as React.CSSProperties}
                      >
                        {mounted && <Viewport key={revision} />}
                        <Composer />
                      </div>
                    </ThreadScrollStateProvider>
                  </SessionContext.Provider>
                </ExtensionProvider>
              </WorkbenchAgentRuntimeEnvironmentProvider>
            </I18nProvider>
          </WorkbenchSettingsProvider>
        </ToastProvider>
      </RightWorkspaceProvider>
      <pre ref={output} id="results" aria-label="Benchmark results" />
    </>
  );
}

createRoot(document.getElementById("root")!, {
  onCaughtError(error) {
    results.error = String(error);
    const output = document.getElementById("results");
    if (output) output.textContent = JSON.stringify(results, null, 2);
  },
}).render(<App />);
