import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readSync,
  writeFileSync,
} from "node:fs";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { PiAssistantMessage } from "@workbench/agent-runtime-pi-protocol/messages";
import type { SessionEvent } from "@workbench/agent-runtime-pi-protocol/rpc";
import { isSessionMessageChunkData } from "@workbench/agent-runtime-pi-protocol/stream";
import {
  applySessionMessageDelta,
  PI_MESSAGE_TERMINATION_DIAGNOSTIC_TYPE,
} from "@workbench/agent-runtime-pi-shared/messages";
import { appendSessionEventJournal, createCanonicalSessionEvent } from "./session-event-journal";

/** Pi otherwise defers the entire first turn's journal until an assistant message ends. */
export function ensureSessionPersistence(manager: SessionManager): void {
  const file = manager.getSessionFile();
  if (!manager.isPersisted() || !file) return;
  if (existsSync(file)) {
    const fd = openSync(file, "r");
    try {
      const size = fstatSync(fd).size;
      const lastByte = Buffer.alloc(1);
      if (size > 0 && readSync(fd, lastByte, 0, 1, size - 1) === 1 && lastByte[0] !== 10) {
        // Pi skips a torn final JSON record. Keep the next append on its own readable line.
        appendFileSync(file, "\n");
      }
    } finally {
      closeSync(fd);
    }
    return;
  }
  const header = manager.getHeader();
  if (!header) throw new Error("Cannot persist a session without its header.");
  const leafId = manager.getLeafId();
  // ponytail: SDK 0.84 has no eager flush API; bootstrap its JSONL once, then let Pi own all appends.
  writeFileSync(
    file,
    [header, ...manager.getEntries()].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    { flag: "wx", mode: 0o600 },
  );
  manager.setSessionFile(file);
  if (leafId) manager.branch(leafId);
  else manager.resetLeaf();
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Only call for a detached session, or after its running agent has fully stopped. */
export function reconcileInterruptedSession(
  manager: SessionManager,
  events: SessionEvent[],
  interruptedRunSeq?: number,
): void {
  const start = events.findLast((event) => event.type === "agent_start");
  if (!start) return;
  const settled = events.some((event) => event.seq > start.seq && event.type === "agent_settled");
  if (settled && interruptedRunSeq !== start.seq) return;

  let pending: PiAssistantMessage | undefined;
  let pendingStartSeq: number | undefined;
  let revision = 0;
  let lastMessage: Record<string, unknown> | undefined;
  let pendingContextMessage: Record<string, unknown> | undefined;
  const toolCallJson = new Map<number, string>();
  for (const event of events.slice(start.seq + 1)) {
    const data = record(event.data);
    const message = record(data?.message);
    if (
      event.type === "message_start" &&
      (message?.role === "user" || message?.role === "toolResult")
    ) {
      pendingContextMessage = message;
      lastMessage = message;
    } else if (
      event.type === "message_start" &&
      message?.role === "assistant" &&
      Array.isArray(message.content)
    ) {
      pending = message as unknown as PiAssistantMessage;
      pendingStartSeq = event.seq;
      revision = 0;
      toolCallJson.clear();
    } else if (event.type === "message_update") {
      if (isSessionMessageChunkData(data)) {
        if (!pending || data.startSeq !== pendingStartSeq || data.firstRevision !== revision + 1) {
          throw new Error("Cannot recover a session with missing assistant chunks.");
        }
        pending = { ...pending, ...data.message, content: pending.content };
        for (const update of data.updates) {
          const next = applySessionMessageDelta(pending, toolCallJson, update);
          if (!next) throw new Error("Cannot recover an invalid assistant chunk.");
          pending = next;
        }
        revision = data.revision;
      } else if (message?.role === "assistant" && Array.isArray(message.content)) {
        pending = message as unknown as PiAssistantMessage;
      }
    } else if (event.type === "message_end" && message) {
      if (message.role === "assistant") pending = undefined;
      if (
        message.role === "assistant" ||
        message.role === "user" ||
        message.role === "toolResult"
      ) {
        pendingContextMessage = undefined;
        lastMessage = message;
        // A crash can land between the canonical event and Pi's native context append.
        if (manager.getLeafId() === event.entryId) {
          manager.appendMessage(
            message as unknown as Parameters<SessionManager["appendMessage"]>[0],
          );
        }
      }
    }
  }

  const time = events.at(-1)?.time ?? start.time;
  const append = (source: { type: string; [key: string]: unknown }) => {
    events.push(
      appendSessionEventJournal(manager, createCanonicalSessionEvent(source, events.length, time)),
    );
  };
  if (pendingContextMessage) {
    append({ type: "message_end", message: pendingContextMessage });
    manager.appendMessage(
      pendingContextMessage as unknown as Parameters<SessionManager["appendMessage"]>[0],
    );
  }
  const finished =
    !pending &&
    lastMessage?.role === "assistant" &&
    ["stop", "length", "error", "aborted"].includes(String(lastMessage.stopReason));
  if (!finished) {
    const model = manager.buildSessionContext().model;
    const message = {
      role: "assistant" as const,
      content: [],
      api: "openai-completions",
      provider: model?.provider ?? "unknown",
      model: model?.modelId ?? "unknown",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: time,
      ...pending,
      stopReason: "aborted" as const,
      diagnostics: [
        ...(pending?.diagnostics ?? []).filter(
          (diagnostic) => diagnostic.type !== PI_MESSAGE_TERMINATION_DIAGNOSTIC_TYPE,
        ),
        {
          type: PI_MESSAGE_TERMINATION_DIAGNOSTIC_TYPE,
          timestamp: time,
          details: { schemaVersion: 1, kind: "aborted", stopReason: "aborted" },
        },
      ],
    };
    if (!pending) append({ type: "message_start", message });
    append({ type: "message_end", message });
    manager.appendMessage(message as Parameters<SessionManager["appendMessage"]>[0]);
  }
  // After a normal shutdown during tool execution, Pi may have settled without an aborted assistant.
  if (!settled || !finished) append({ type: "agent_settled" });
}
