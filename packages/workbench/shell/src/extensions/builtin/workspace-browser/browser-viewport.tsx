"use client";

import { useEffect, useMemo, useRef } from "react";
import { MousePointer2Icon } from "lucide-react";
import type { BrowserDevice, BrowserEvent, BrowserInput } from "@workbench/browser-contracts";
import type { BrowserSessionService } from "./browser-session-service";
import { useI18n } from "../../../i18n";

function modifiers(event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): number {
  return (
    (event.altKey ? 1 : 0) |
    (event.ctrlKey ? 2 : 0) |
    (event.metaKey ? 4 : 0) |
    (event.shiftKey ? 8 : 0)
  );
}

/** Pipeline a bounded window; the gateway preserves each session's input order. */
export function createBrowserInputQueue(
  send: (event: BrowserInput) => Promise<unknown>,
  onError: (error: unknown) => void,
) {
  const queued: BrowserInput[] = [];
  let running = 0;
  const flush = () => {
    while (running < 8 && queued.length) {
      const event = queued.shift()!;
      running++;
      void Promise.resolve()
        .then(() => send(event))
        .catch((error: unknown) => {
          queued.length = 0;
          onError(error);
        })
        .finally(() => {
          running--;
          flush();
        });
    }
  };
  return {
    push(event: BrowserInput) {
      const previous = queued.at(-1);
      if (
        event.kind === "mouse" &&
        previous?.kind === "mouse" &&
        event.type === previous.type &&
        event.modifiers === previous.modifiers &&
        event.buttons === previous.buttons &&
        (event.type === "mouseMoved" || event.type === "mouseWheel")
      ) {
        queued[queued.length - 1] =
          event.type === "mouseMoved"
            ? event
            : {
                ...event,
                deltaX: Math.max(
                  -10000,
                  Math.min(10000, (previous.deltaX ?? 0) + (event.deltaX ?? 0)),
                ),
                deltaY: Math.max(
                  -10000,
                  Math.min(10000, (previous.deltaY ?? 0) + (event.deltaY ?? 0)),
                ),
              };
      } else queued.push(event);
      flush();
    },
    clear() {
      queued.length = 0;
    },
  };
}

/** Map a letterboxed frame to the remote page's CSS viewport, including device-preview scaling. */
export function browserPointerPosition(
  bounds: { left: number; top: number; width: number; height: number },
  frame: { width: number; height: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const scale = Math.min(bounds.width / frame.width, bounds.height / frame.height) || 1;
  return {
    x: Math.max(
      0,
      Math.min(
        frame.width,
        (clientX - bounds.left - (bounds.width - frame.width * scale) / 2) / scale,
      ),
    ),
    y: Math.max(
      0,
      Math.min(
        frame.height,
        (clientY - bounds.top - (bounds.height - frame.height * scale) / 2) / scale,
      ),
    ),
  };
}

export function BrowserViewport({
  browser,
  sessionId,
  isVisible,
  zoom,
  device,
  onError,
  onFind,
}: {
  browser: BrowserSessionService;
  sessionId: string;
  isVisible: boolean;
  zoom: number;
  device?: BrowserDevice;
  onError(error: unknown): void;
  onFind(): void;
}) {
  const { t } = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  const keyboard = useRef<HTMLTextAreaElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const repaint = useRef(() => {});
  const frame = useRef({ width: 1, height: 1 });
  const composing = useRef(false);
  const committedComposition = useRef<string | undefined>(undefined);
  const compositionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pressedKeys = useRef(new Map<string, Extract<BrowserInput, { kind: "key" }>>());
  const pressedButtons = useRef(new Map<number, Extract<BrowserInput, { kind: "mouse" }>>());
  const active = useRef(true);
  const viewportSize = useRef({ width: 800, height: 600 });
  const errorHandler = useRef(onError);
  errorHandler.current = onError;
  const inputs = useMemo(
    () =>
      createBrowserInputQueue(
        (event) => browser.command({ type: "input", sessionId, event }),
        (error) => {
          if (active.current) errorHandler.current(error);
        },
      ),
    [browser, sessionId],
  );
  const input = inputs.push;
  const release = () => {
    for (const key of pressedKeys.current.values())
      input({ ...key, type: "keyUp", text: undefined, modifiers: 0 });
    pressedKeys.current.clear();
    for (const button of pressedButtons.current.values())
      input({ ...button, type: "mouseReleased", buttons: 0, modifiers: 0 });
    pressedButtons.current.clear();
  };

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (compositionTimer.current) clearTimeout(compositionTimer.current);
      inputs.clear();
      release();
    };
  }, [inputs]);

  useEffect(() => {
    let paint: number | undefined;
    let latest: Extract<BrowserEvent, { type: "frame" }> | undefined;
    let controlled = browser.getSession(sessionId)?.agentControlled;
    let position = browser.getSession(sessionId)?.agentCursor;
    const schedule = () => {
      if (paint !== undefined || !picture.current) return;
      paint = requestAnimationFrame(() => {
        paint = undefined;
        if (latest && picture.current) {
          frame.current = { width: latest.width, height: latest.height };
          picture.current.src = `data:${latest.mimeType ?? "image/jpeg"};base64,${latest.data}`;
          latest = undefined;
        }
        const element = container.current;
        const pointer = cursor.current;
        if (!pointer || !element) return;
        pointer.hidden =
          !isVisible ||
          !controlled ||
          !position ||
          !picture.current?.src ||
          position.x < 0 ||
          position.y < 0 ||
          position.x > frame.current.width ||
          position.y > frame.current.height;
        if (pointer.hidden || !position) return;
        // Use local CSS dimensions; ancestor transforms and bitmap density apply independently.
        const { clientWidth: width, clientHeight: height } = element;
        const scale = Math.min(width / frame.current.width, height / frame.current.height);
        const x = (width - frame.current.width * scale) / 2 + position.x * scale;
        const y = (height - frame.current.height * scale) / 2 + position.y * scale;
        pointer.style.transform = `translate(${x}px, ${y}px)`;
      });
    };
    repaint.current = schedule;
    const unsubscribe = browser.subscribeEvents((event) => {
      if (event.type === "state" && event.session.id === sessionId) {
        controlled = event.session.agentControlled;
        position = event.session.agentCursor;
      } else if ("sessionId" in event && event.sessionId === sessionId) {
        if (event.type === "frame") latest = event;
        else if (event.type === "cursor") position = event.cursor ?? undefined;
        else return;
      } else return;
      schedule();
    });
    const unsubscribeSession = browser.subscribe(() => {
      controlled = browser.getSession(sessionId)?.agentControlled;
      position = browser.getSession(sessionId)?.agentCursor;
      schedule();
    });
    schedule();
    return () => {
      unsubscribe();
      unsubscribeSession();
      repaint.current = () => {};
      if (paint !== undefined) cancelAnimationFrame(paint);
    };
  }, [browser, sessionId, isVisible]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const workspace = element.closest('[data-workbench-surface="right-workspace"]');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const resize = () => {
      repaint.current();
      if (timer) clearTimeout(timer);
      // The workspace previews drag geometry locally; apply the remote layout after release.
      if (workspace?.getAttribute("data-resizing") === "true") return;
      timer = setTimeout(() => {
        const { width, height } = element.getBoundingClientRect();
        if (!width || !height || !isVisible) return;
        viewportSize.current = {
          width: Math.max(1, Math.min(7680, Math.round(width))),
          height: Math.max(1, Math.min(7680, Math.round(height))),
        };
        void browser
          .command({
            type: "viewport",
            sessionId,
            ...viewportSize.current,
            visible: true,
            deviceScaleFactor: Math.max(2, Math.min(3, window.devicePixelRatio || 1)),
            zoom,
            device: device ?? null,
          })
          .catch((error: unknown) => errorHandler.current(error));
      }, 80);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    const dragObserver = new MutationObserver(resize);
    if (workspace)
      dragObserver.observe(workspace, { attributes: true, attributeFilter: ["data-resizing"] });
    let resolution: MediaQueryList;
    const densityChanged = () => {
      resolution?.removeEventListener("change", densityChanged);
      resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      resolution.addEventListener("change", densityChanged);
      resize();
    };
    densityChanged();
    return () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
      dragObserver.disconnect();
      resolution.removeEventListener("change", densityChanged);
    };
  }, [browser, sessionId, isVisible, zoom, device?.width, device?.height, device?.mobile]);

  useEffect(() => {
    const hide = () => {
      release();
      keyboard.current?.blur();
      void browser
        .command({ type: "viewport", sessionId, ...viewportSize.current, visible: false })
        .catch(() => {});
    };
    if (!isVisible) hide();
    return () => {
      if (isVisible) hide();
    };
  }, [browser, sessionId, isVisible, inputs]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const position = browserPointerPosition(
        element.getBoundingClientRect(),
        frame.current,
        event.clientX,
        event.clientY,
      );
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      input({
        kind: "mouse",
        type: "mouseWheel",
        ...position,
        deltaX: Math.max(-10000, Math.min(10000, event.deltaX * scale)),
        deltaY: Math.max(-10000, Math.min(10000, event.deltaY * scale)),
        modifiers: modifiers(event),
      });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [inputs]);

  return (
    <div
      ref={container}
      className="relative h-full min-h-0 w-full overflow-hidden bg-muted/25 data-focus-visible:-outline-offset-2"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (event.target === keyboard.current) return;
        event.preventDefault();
        keyboard.current?.focus({ preventScroll: true });
        event.currentTarget.removeAttribute("data-focus-visible");
        event.currentTarget.setPointerCapture(event.pointerId);
        const down: Extract<BrowserInput, { kind: "mouse" }> = {
          kind: "mouse",
          type: "mousePressed",
          ...browserPointerPosition(
            event.currentTarget.getBoundingClientRect(),
            frame.current,
            event.clientX,
            event.clientY,
          ),
          button: event.button === 2 ? "right" : event.button === 1 ? "middle" : "left",
          buttons: event.buttons & 31,
          clickCount: Math.min(3, event.detail || 1),
          modifiers: modifiers(event),
        };
        pressedButtons.current.set(event.button, down);
        input(down);
      }}
      onPointerUp={(event) => {
        if (!pressedButtons.current.delete(event.button)) return;
        input({
          kind: "mouse",
          type: "mouseReleased",
          ...browserPointerPosition(
            event.currentTarget.getBoundingClientRect(),
            frame.current,
            event.clientX,
            event.clientY,
          ),
          button: event.button === 2 ? "right" : event.button === 1 ? "middle" : "left",
          buttons: event.buttons,
          clickCount: Math.min(3, event.detail || 1),
          modifiers: modifiers(event),
        });
      }}
      onPointerCancel={release}
      onLostPointerCapture={() => {
        if (pressedButtons.current.size) release();
      }}
      onPointerMove={(event) => {
        input({
          kind: "mouse",
          type: "mouseMoved",
          ...browserPointerPosition(
            event.currentTarget.getBoundingClientRect(),
            frame.current,
            event.clientX,
            event.clientY,
          ),
          buttons: event.buttons,
          modifiers: modifiers(event),
        });
      }}
    >
      <img
        ref={picture}
        alt={t("extensions.workspaceBrowser.viewportTitle")}
        draggable={false}
        decoding="sync"
        className="pointer-events-none size-full select-none object-contain"
      />
      <textarea
        ref={keyboard}
        aria-label={t("extensions.workspaceBrowser.pageInput")}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        className="pointer-events-none absolute start-0 top-0 size-px resize-none opacity-0"
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          if (event.data) input({ kind: "text", text: event.data });
          committedComposition.current = event.data;
          if (compositionTimer.current) clearTimeout(compositionTimer.current);
          compositionTimer.current = setTimeout(() => {
            committedComposition.current = undefined;
          }, 0);
          event.currentTarget.value = "";
        }}
        onInput={(event) => {
          if (composing.current || (event.nativeEvent as InputEvent).isComposing) return;
          if (
            event.currentTarget.value &&
            event.currentTarget.value !== committedComposition.current
          )
            input({ kind: "text", text: event.currentTarget.value });
          committedComposition.current = undefined;
          event.currentTarget.value = "";
        }}
        onFocus={() => {
          container.current?.setAttribute("data-focus-visible", "");
        }}
        onBlur={() => {
          container.current?.removeAttribute("data-focus-visible");
          release();
        }}
        onPaste={(event) => {
          event.preventDefault();
          input({ kind: "text", text: event.clipboardData.getData("text/plain") });
        }}
        onKeyDown={(event) => {
          if (
            composing.current ||
            event.nativeEvent.isComposing ||
            event.keyCode === 229 ||
            ["Dead", "Process", "Unidentified"].includes(event.key)
          )
            return;
          committedComposition.current = undefined;
          const modified = event.ctrlKey || event.metaKey;
          if (modified && event.key.toLowerCase() === "f") {
            event.preventDefault();
            onFind();
            return;
          }
          if (modified && event.key.toLowerCase() === "v") return;
          if (modified && event.key.toLowerCase() === "c") {
            event.preventDefault();
            void browser
              .command<{ text: string }>({ type: "copy", sessionId })
              .then(({ text }) => navigator.clipboard.writeText(text))
              .catch(onError);
            return;
          }
          const printable = [...event.key].length === 1;
          if (printable && event.altKey && !event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          const down: Extract<BrowserInput, { kind: "key" }> = {
            kind: "key",
            type: "keyDown",
            key: event.key,
            code: event.code,
            windowsVirtualKeyCode: event.keyCode,
            modifiers: modifiers(event),
            ...(printable &&
            ((!event.ctrlKey && !event.metaKey && !event.altKey) ||
              event.getModifierState("AltGraph"))
              ? { text: event.key }
              : {}),
          };
          pressedKeys.current.set(event.code || event.key, down);
          input(down);
        }}
        onKeyUp={(event) => {
          const key = pressedKeys.current.get(event.code || event.key);
          if (!key) return;
          pressedKeys.current.delete(event.code || event.key);
          input({ ...key, type: "keyUp", text: undefined, modifiers: modifiers(event) });
        }}
      />
      <div
        ref={cursor}
        hidden
        aria-hidden="true"
        data-browser-agent-cursor=""
        className="pointer-events-none absolute top-0 left-0 size-0"
      >
        <MousePointer2Icon
          className="size-[var(--icon-size-lg)] fill-primary text-primary-foreground drop-shadow-sm"
          style={{ transform: "translate(-16.6667%, -16.6667%)" }}
        />
      </div>
    </div>
  );
}
