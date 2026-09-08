import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { BrowserManager } from "@workbench/browser-server";
import type { BrowserEvent } from "@workbench/browser-contracts";
import type { BrowserHost } from "./index";

type InteractiveEvent = Extract<BrowserEvent, { type: "permission" | "dialog" }>;

/** Pi packages and the embedded Runtime share the existing host binding across module roots. */
function workbenchBrowser(): BrowserHost | undefined {
  return (
    globalThis as typeof globalThis & {
      __workbenchPiAgentHostBindings?: { browser?: BrowserHost };
    }
  ).__workbenchPiAgentHostBindings?.browser;
}

export function createBrowserHostResolver(pi: ExtensionAPI) {
  let standalone:
    | {
        sessionId: string;
        host: BrowserHost;
        context: ExtensionContext;
        dispose(): void;
      }
    | undefined;
  pi.on("session_shutdown", () => {
    standalone?.dispose();
    standalone = undefined;
  });

  return (context: ExtensionContext): BrowserHost => {
    const embedded = workbenchBrowser();
    if (embedded) return embedded;
    const sessionId = context.sessionManager.getSessionId();
    if (standalone?.sessionId === sessionId) {
      standalone.context = context;
      return standalone.host;
    }
    standalone?.dispose();
    const stateDirectory = path.join(
      getAgentDir(),
      "browser",
      sessionId.replace(/[^a-zA-Z0-9._-]/g, "_"),
      `active-${process.pid}-${randomUUID()}`,
    );
    const manager = new BrowserManager({ stateDirectory });
    const lifetime = new AbortController();
    let active = { context, signal: lifetime.signal };
    let interaction = Promise.resolve();
    const report = (event: unknown) => {
      if (lifetime.signal.aborted) return;
      pi.sendMessage({
        customType: "browser-event",
        content: JSON.stringify(event),
        display: true,
      });
    };
    const respond = async (
      event: InteractiveEvent,
      { context: current, signal }: typeof active,
    ) => {
      const options = { signal, timeout: 120_000 };
      let accept = false;
      let text: string | undefined;
      try {
        if (current.hasUI && !signal.aborted) {
          if (event.type === "permission") {
            accept = await current.ui.confirm(event.action, event.origin, options);
          } else if (event.kind === "prompt") {
            text = await current.ui.input(
              [event.kind, event.url, event.message].filter(Boolean).join("\n"),
              event.defaultPrompt,
              options,
            );
            accept = text !== undefined;
          } else {
            accept = await current.ui.confirm(
              [event.kind, event.url].filter(Boolean).join(" · "),
              event.message,
              options,
            );
          }
        }
      } catch {
        // Cancellation or unavailable UI cannot grant browser permission.
      }
      if (signal.aborted) accept = false;
      const command =
        event.type === "permission"
          ? { type: "permission.respond" as const, requestId: event.requestId, allow: accept }
          : {
              type: "dialog.respond" as const,
              sessionId: event.sessionId,
              accept,
              ...(accept && text !== undefined ? { text } : {}),
            };
      let expired = false;
      await manager.handle(command, { source: "user" }).catch(() => {
        accept = false;
        expired = true;
      });
      report({
        type: event.type,
        ...(event.type === "permission"
          ? { action: event.action, origin: event.origin, allowed: accept }
          : { kind: event.kind, accepted: accept }),
        ...(expired
          ? { reason: "browser-request-expired" }
          : signal.aborted
            ? { reason: "browser-request-canceled" }
            : !current.hasUI
              ? { reason: "browser-ui-unavailable" }
              : {}),
      });
    };
    const unsubscribe = manager.subscribe((event) => {
      if (event.type === "permission" || event.type === "dialog") {
        const request = {
          ...active,
          signal: AbortSignal.any([active.signal, AbortSignal.timeout(120_000)]),
        };
        interaction = interaction.then(() => respond(event, request)).catch(() => undefined);
      } else if (
        event.type === "file-chooser" ||
        event.type === "error" ||
        (event.type === "download" && event.download.state !== "inProgress")
      ) {
        report(event);
      } else if (event.type === "file") {
        report({ type: "download-file", name: event.file.name, mimeType: event.file.mimeType });
      }
    });
    const instance = {
      sessionId,
      context,
      host: {
        async command(command, signal, controlSignal) {
          lifetime.signal.throwIfAborted();
          active = {
            context: instance.context,
            signal: AbortSignal.any(
              [signal, instance.context.signal, lifetime.signal].filter(
                (candidate): candidate is AbortSignal => candidate !== undefined,
              ),
            ),
          };
          return manager.handle(command, { source: "agent", signal: active.signal, controlSignal });
        },
      } satisfies BrowserHost,
      dispose() {
        if (lifetime.signal.aborted) return;
        lifetime.abort();
        unsubscribe();
        manager.dispose();
      },
    };
    standalone = instance;
    report({ type: "browser-session", stateDirectory });
    return instance.host;
  };
}
