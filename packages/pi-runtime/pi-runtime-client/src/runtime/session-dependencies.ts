import type { PromptFeedbackClaim } from "@workbench/agent-runtime-client/prompt-feedback";
import type { PiEvent, PiRunTiming, PiSessionSummary } from "@workbench/pi-rpc-contracts/messages";
import type { PiRpcCallOptions } from "@workbench/pi-rpc-client/api";
import type {
  SessionSelectModelPayload,
  SessionSelectModelValue,
} from "@workbench/pi-rpc-contracts/rpc";

/** The finite installation/session boundary consumed by one browser-side Pi session. */
export interface PiClientSessionDependencies {
  readonly rpcOptions: Readonly<Pick<PiRpcCallOptions, "invalidation" | "transport">>;
  readonly events: {
    ensure(sessionId: string, listener: (event: PiEvent) => void): Promise<void>;
    close(sessionId: string): void;
    scheduleClose(sessionId: string): void;
  };
  ensureRemote(): Promise<PiSessionSummary>;
  selectModel(payload: SessionSelectModelPayload): Promise<SessionSelectModelValue>;
  waitForModelSelection(sessionId: string): Promise<void>;
  isRunning(sessionId: string): boolean;
  updateRunning(sessionId: string, running: boolean, timing?: PiRunTiming): void;
  notePrompt(sessionId: string, text: string, running: boolean): void;
  refreshCatalog(): Promise<void>;
  title(sessionId: string): string | undefined;
  fork(input: {
    readonly sessionId: string;
    readonly atSeq: number;
    readonly sourceTitle: string;
  }): Promise<{ readonly sessionId: string; readonly title: string }>;
  readonly feedback: {
    claim(localId: string, remoteId?: string): PromptFeedbackClaim | undefined;
    commit(claim: PromptFeedbackClaim | undefined): void;
    release(claim: PromptFeedbackClaim | undefined): void;
  };
}
