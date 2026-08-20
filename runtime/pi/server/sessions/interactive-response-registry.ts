import { randomUUID } from "node:crypto";
import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";

import type {
  ApprovalResponseValue,
  ClientResponse,
  QuestionAnswerItem,
  QuestionResponseValue,
  RpcReceipt,
} from "../../rpc-contracts";
import type {
  ApprovalRequestedPayload,
  ApprovalResolvedPayload,
  QuestionItem,
} from "../../stream-contracts";
import type { StreamHub } from "../streams/stream-hub";
// Node's native TypeScript test runner requires explicit extensions for runtime imports.
// @ts-expect-error TS5097 -- application sources are bundled without emitting this specifier.
import { getStreamHub } from "../streams/stream-hub.ts";
// @ts-expect-error TS5097 -- application sources are bundled without emitting this specifier.
import { readTrustedJsonPost } from "../transport/rpc-transport.ts";

export const INTERACTIVE_RESPONSE_REGISTRY_SYMBOL = Symbol.for(
  "workbench-ui.pi.interactive-response-registry.v1",
);

type DialogOptions = Parameters<ExtensionUIContext["select"]>[2];
type ApprovalOutcome = ApprovalResolvedPayload["outcome"];

const HEADLESS_THEME = {
  fg: (_color: unknown, text: string) => text,
  bg: (_color: unknown, text: string) => text,
  bold: (text: string) => text,
  italic: (text: string) => text,
  underline: (text: string) => text,
  inverse: (text: string) => text,
  strikethrough: (text: string) => text,
  getFgAnsi: () => "",
  getBgAnsi: () => "",
  getColorMode: () => "truecolor" as const,
  getThinkingBorderColor: () => (text: string) => text,
  getBashModeBorderColor: () => (text: string) => text,
} as unknown as Theme;

interface ParsedSuccess<Value> {
  ok: true;
  value: Value;
}

interface ParsedFailure {
  ok: false;
}

type Parsed<Value> = ParsedSuccess<Value> | ParsedFailure;

interface PendingBase {
  rpcId: string;
  sessionId: string;
  signal?: AbortSignal;
  onAbort?: () => void;
  timeout?: ReturnType<typeof setTimeout>;
}

interface PendingQuestion<Value> extends PendingBase {
  kind: "question";
  questions: QuestionItem[];
  defaultValue: Value;
  parseAnswer: (answer: QuestionAnswerItem[]) => Parsed<Value>;
  resolve: (value: Value) => void;
}

interface PendingApproval extends PendingBase {
  kind: "approval";
  approvalId: string;
  resolve: (value: ApprovalOutcome) => void;
}

type PendingInteraction = PendingQuestion<unknown> | PendingApproval;
type PendingDescriptor = PendingBase &
  ({ kind: "question" } | { kind: "approval"; approvalId: string });

export interface InteractiveResponseRegistryOptions {
  hub?: StreamHub;
  createRpcId?: () => string;
}

export interface ApprovalRequestOptions {
  signal?: AbortSignal;
  timeout?: number;
}

export type ApprovalRequest = Omit<ApprovalRequestedPayload, "type">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseQuestionResponseValue(value: unknown): QuestionResponseValue | undefined {
  if (!isRecord(value) || typeof value.sessionId !== "string" || value.sessionId.length === 0) {
    return undefined;
  }
  if (!isRecord(value.answer) || !Array.isArray(value.answer.answers)) return undefined;

  const answers: QuestionAnswerItem[] = [];
  for (const candidate of value.answer.answers) {
    if (!isRecord(candidate) || typeof candidate.id !== "string") return undefined;
    if (
      !Array.isArray(candidate.selected) ||
      !candidate.selected.every((item) => typeof item === "string")
    ) {
      return undefined;
    }
    if (candidate.custom !== undefined && typeof candidate.custom !== "string") return undefined;
    answers.push({
      id: candidate.id,
      selected: [...candidate.selected],
      ...(candidate.custom === undefined ? {} : { custom: candidate.custom }),
    });
  }
  return { sessionId: value.sessionId, answer: { answers } };
}

function parseApprovalResponseValue(value: unknown): ApprovalResponseValue | undefined {
  if (
    !isRecord(value) ||
    typeof value.sessionId !== "string" ||
    value.sessionId.length === 0 ||
    typeof value.approvalId !== "string" ||
    value.approvalId.length === 0 ||
    (value.outcome !== "allowed-once" && value.outcome !== "rejected")
  ) {
    return undefined;
  }
  return {
    sessionId: value.sessionId,
    approvalId: value.approvalId,
    outcome: value.outcome,
  };
}

/** Parse the complete wire shape without consulting pending interaction state. */
export function parseClientResponse(value: unknown): ClientResponse | undefined {
  if (!isRecord(value) || value.type !== "client-response" || typeof value.rpcId !== "string") {
    return undefined;
  }
  if (!isRecord(value.result)) return undefined;

  if (value.result.ok === false) {
    const error = value.result.error;
    if (
      !isRecord(error) ||
      error.code !== "cancelled" ||
      typeof error.message !== "string" ||
      !isRecord(error.details)
    ) {
      return undefined;
    }
    return {
      type: "client-response",
      rpcId: value.rpcId,
      result: {
        ok: false,
        error: { code: "cancelled", message: error.message, details: { ...error.details } },
      },
    };
  }

  if (value.result.ok !== true || !Object.hasOwn(value.result, "value")) return undefined;
  const approval = parseApprovalResponseValue(value.result.value);
  const question = parseQuestionResponseValue(value.result.value);
  // The document uses JSON Schema `oneOf`: an object satisfying both branches is invalid.
  if ((approval === undefined) === (question === undefined)) return undefined;
  return {
    type: "client-response",
    rpcId: value.rpcId,
    result: { ok: true, value: approval ?? question! },
  };
}

function validTimeout(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

export class InteractiveResponseRegistry {
  private readonly hub: StreamHub;
  private readonly createRpcId: () => string;
  private readonly pending = new Map<string, PendingInteraction>();

  constructor(options: InteractiveResponseRegistryOptions = {}) {
    this.hub = options.hub ?? getStreamHub();
    this.createRpcId = options.createRpcId ?? randomUUID;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  private nextRpcId(): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const rpcId = this.createRpcId();
      if (!this.pending.has(rpcId)) return rpcId;
    }
    throw new Error("Unable to allocate a unique interactive request id.");
  }

  private cleanup(entry: PendingBase): void {
    if (entry.timeout) clearTimeout(entry.timeout);
    if (entry.signal && entry.onAbort) entry.signal.removeEventListener("abort", entry.onAbort);
  }

  private publishResolved(entry: PendingDescriptor, outcome: ApprovalOutcome | "answered"): void {
    try {
      if (entry.kind === "question") {
        this.hub.publishMux({
          type: "question/resolved",
          sessionId: entry.sessionId,
          questionRpcId: entry.rpcId,
          outcome: outcome === "answered" ? "answered" : "cancelled",
        });
      } else {
        this.hub.publishMux({
          type: "approval/resolved",
          sessionId: entry.sessionId,
          approvalId: entry.approvalId,
          outcome: outcome === "answered" ? "cancelled" : outcome,
        });
      }
    } catch {
      // The wait is already settled; reconnect state is still correct because the hub
      // removes a retained request before attempting downstream delivery.
    }
  }

  /** Delete before resolving so duplicate or concurrent callers observe `not-pending`. */
  private claimQuestion<Value>(
    entry: PendingQuestion<Value>,
    value: Value,
    outcome: "answered" | "cancelled",
  ): boolean {
    if (this.pending.get(entry.rpcId) !== entry) return false;
    this.pending.delete(entry.rpcId);
    this.cleanup(entry);
    this.publishResolved(entry, outcome);
    entry.resolve(value);
    return true;
  }

  private claimApproval(entry: PendingApproval, outcome: ApprovalOutcome): boolean {
    if (this.pending.get(entry.rpcId) !== entry) return false;
    this.pending.delete(entry.rpcId);
    this.cleanup(entry);
    this.publishResolved(entry, outcome);
    entry.resolve(outcome);
    return true;
  }

  private ask<Value>(
    sessionId: string,
    questions: QuestionItem[],
    defaultValue: Value,
    parseAnswer: (answers: QuestionAnswerItem[]) => Parsed<Value>,
    options?: DialogOptions,
  ): Promise<Value> {
    if (options?.signal?.aborted) return Promise.resolve(defaultValue);

    const rpcId = this.nextRpcId();
    return new Promise<Value>((resolve) => {
      const entry: PendingQuestion<Value> = {
        kind: "question",
        rpcId,
        sessionId,
        questions,
        defaultValue,
        parseAnswer,
        resolve,
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      };
      const onAbort = () => this.claimQuestion(entry, defaultValue, "cancelled");
      entry.onAbort = onAbort;
      this.pending.set(rpcId, entry as PendingInteraction);
      options?.signal?.addEventListener("abort", onAbort, { once: true });
      if (validTimeout(options?.timeout)) {
        entry.timeout = setTimeout(onAbort, options.timeout);
        entry.timeout.unref?.();
      }

      try {
        this.hub.publishMux({ type: "question/requested", sessionId, questions }, { rpcId });
      } catch {
        this.claimQuestion(entry, defaultValue, "cancelled");
      }
    });
  }

  createExtensionUIContext(sessionId: string): ExtensionUIContext {
    return {
      select: (title, options, dialogOptions) => {
        const id = "selection";
        return this.ask<string | undefined>(
          sessionId,
          [
            {
              id,
              question: title,
              options: options.map((label) => ({ label })),
              multiSelect: false,
            },
          ],
          undefined,
          (answers) => {
            const answer = answers.length === 1 && answers[0]?.id === id ? answers[0] : undefined;
            const selected = answer?.selected;
            return answer &&
              answer.custom === undefined &&
              selected?.length === 1 &&
              options.includes(selected[0]!)
              ? { ok: true, value: selected[0] }
              : { ok: false };
          },
          dialogOptions,
        );
      },
      confirm: (title, message, dialogOptions) => {
        const id = "confirmation";
        return this.ask<boolean>(
          sessionId,
          [
            {
              id,
              question: title,
              detail: message,
              options: [{ label: "true" }, { label: "false" }],
              multiSelect: false,
            },
          ],
          false,
          (answers) => {
            const answer = answers.length === 1 && answers[0]?.id === id ? answers[0] : undefined;
            const selected = answer?.selected;
            if (
              !answer ||
              answer.custom !== undefined ||
              selected?.length !== 1 ||
              (selected[0] !== "true" && selected[0] !== "false")
            ) {
              return { ok: false };
            }
            return { ok: true, value: selected[0] === "true" };
          },
          dialogOptions,
        );
      },
      input: (title, placeholder, dialogOptions) => {
        const id = "value";
        return this.ask<string | undefined>(
          sessionId,
          [
            {
              id,
              question: title,
              ...(placeholder === undefined ? {} : { detail: placeholder }),
              multiSelect: false,
            },
          ],
          undefined,
          (answers) => {
            const answer = answers.length === 1 && answers[0]?.id === id ? answers[0] : undefined;
            return answer && answer.selected.length === 0 && typeof answer.custom === "string"
              ? { ok: true, value: answer.custom }
              : { ok: false };
          },
          dialogOptions,
        );
      },
      notify() {},
      onTerminalInput() {
        return () => undefined;
      },
      setStatus() {},
      setWorkingMessage() {},
      setWorkingVisible() {},
      setWorkingIndicator() {},
      setHiddenThinkingLabel() {},
      setWidget() {},
      setFooter() {},
      setHeader() {},
      setTitle() {},
      async custom() {
        return undefined as never;
      },
      pasteToEditor() {},
      setEditorText() {},
      getEditorText() {
        return "";
      },
      async editor() {
        return undefined;
      },
      addAutocompleteProvider() {},
      setEditorComponent() {},
      getEditorComponent() {
        return undefined;
      },
      get theme() {
        return HEADLESS_THEME;
      },
      getAllThemes() {
        return [];
      },
      getTheme() {
        return undefined;
      },
      setTheme() {
        return { success: false, error: "unavailable" };
      },
      getToolsExpanded() {
        return false;
      },
      setToolsExpanded() {},
    };
  }

  /**
   * Generic approval channel for a future Pi policy hook. No policy hook is
   * fabricated here; callers must explicitly opt into this request method.
   */
  requestApproval(
    request: ApprovalRequest,
    options: ApprovalRequestOptions = {},
  ): Promise<ApprovalOutcome> {
    if (options.signal?.aborted) return Promise.resolve("cancelled");

    const rpcId = this.nextRpcId();
    return new Promise<ApprovalOutcome>((resolve) => {
      const entry: PendingApproval = {
        kind: "approval",
        rpcId,
        sessionId: request.sessionId,
        approvalId: request.approvalId,
        resolve,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      };
      const onAbort = () => this.claimApproval(entry, "cancelled");
      entry.onAbort = onAbort;
      this.pending.set(rpcId, entry);
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (validTimeout(options.timeout)) {
        entry.timeout = setTimeout(onAbort, options.timeout);
        entry.timeout.unref?.();
      }
      try {
        this.hub.publishMux({ type: "approval/requested", ...request }, { rpcId });
      } catch {
        this.claimApproval(entry, "unavailable");
      }
    });
  }

  respond(response: ClientResponse): RpcReceipt {
    const entry = this.pending.get(response.rpcId);
    if (!entry) return { accepted: false, reason: "not-pending" };

    if (entry.kind === "approval") {
      if (!response.result.ok) return { accepted: false, reason: "bad-response" };
      const value = response.result.value;
      if (
        !("approvalId" in value) ||
        value.sessionId !== entry.sessionId ||
        value.approvalId !== entry.approvalId
      ) {
        return { accepted: false, reason: "bad-response" };
      }
      return this.claimApproval(entry, value.outcome)
        ? { accepted: true }
        : { accepted: false, reason: "not-pending" };
    }

    if (!response.result.ok) {
      return this.claimQuestion(entry, entry.defaultValue, "cancelled")
        ? { accepted: true }
        : { accepted: false, reason: "not-pending" };
    }
    const value = response.result.value;
    if (!("answer" in value) || value.sessionId !== entry.sessionId) {
      return { accepted: false, reason: "bad-response" };
    }
    const parsed = entry.parseAnswer(value.answer.answers);
    if (!parsed.ok) return { accepted: false, reason: "bad-response" };
    return this.claimQuestion(entry, parsed.value, "answered")
      ? { accepted: true }
      : { accepted: false, reason: "not-pending" };
  }

  clearSession(sessionId: string): void {
    for (const entry of this.pending.values()) {
      if (entry.sessionId !== sessionId) continue;
      if (entry.kind === "question") {
        this.claimQuestion(entry, entry.defaultValue, "cancelled");
      } else {
        this.claimApproval(entry, "cancelled");
      }
    }
  }

  clear(): void {
    for (const entry of this.pending.values()) {
      if (entry.kind === "question") {
        this.claimQuestion(entry, entry.defaultValue, "cancelled");
      } else {
        this.claimApproval(entry, "cancelled");
      }
    }
  }
}

interface InteractiveRegistryGlobal {
  [key: symbol]: unknown;
}

export function getInteractiveResponseRegistry(): InteractiveResponseRegistry {
  const globalRegistry = globalThis as typeof globalThis & InteractiveRegistryGlobal;
  const existing = globalRegistry[INTERACTIVE_RESPONSE_REGISTRY_SYMBOL];
  if (existing) return existing as InteractiveResponseRegistry;

  const registry = new InteractiveResponseRegistry();
  globalRegistry[INTERACTIVE_RESPONSE_REGISTRY_SYMBOL] = registry;
  return registry;
}

export async function handleInteractiveResponsePost(
  request: Request,
  registry: InteractiveResponseRegistry = getInteractiveResponseRegistry(),
): Promise<Response> {
  const body = await readTrustedJsonPost(request, {
    onUnexpectedError: (error) => console.error("[workbench-pi] respond transport failed", error),
  });
  if (!body.ok) return body.response;

  const response = parseClientResponse(body.value);
  if (!response) {
    return Response.json({ accepted: false, reason: "bad-response" } satisfies RpcReceipt);
  }
  return Response.json(registry.respond(response));
}
