import type { PiAssistantMessage, PiEvent } from "../../contracts";
import { applySessionMessageDelta, copyPiAssistantMessage } from "../../session-message-reducer";
import type {
  SessionMessageSnapshotPayload,
  SessionMessageUpdatePayload,
} from "../../stream-contracts";

export type SessionMessageApplyResult =
  | { kind: "event"; event: PiEvent }
  | { kind: "ignored" }
  | { kind: "gap" };

interface ActiveMessageState {
  streamId?: string;
  startSeq: number;
  revision: number;
  synchronized: boolean;
  message: PiAssistantMessage;
  toolCallJson: Map<number, string>;
  time: number;
}

function messageFromMetadata(payload: SessionMessageUpdatePayload): PiAssistantMessage {
  return { ...payload.message, role: "assistant", content: [] };
}

function toolCallJsonFromSnapshot(value: Record<string, string> | undefined): Map<number, string> {
  const result = new Map<number, string>();
  for (const [rawIndex, json] of Object.entries(value ?? {})) {
    const index = Number(rawIndex);
    if (Number.isInteger(index) && index >= 0 && typeof json === "string") result.set(index, json);
  }
  return result;
}

function transientEvent(state: ActiveMessageState, kind: "delta" | "snapshot"): PiEvent {
  return {
    type: "message_update",
    message: state.message,
    eventTime: state.time,
    transientKind: kind,
    transientStreamId: state.streamId,
    transientRevision: state.revision,
    transientMessageStartSeq: state.startSeq,
  };
}

/** Materializes compact assistant frames while keeping durable sequencing outside this state. */
export class SessionMessageAccumulator {
  private state: ActiveMessageState | undefined;

  get streamId(): string | undefined {
    return this.state?.streamId;
  }

  start(message: PiAssistantMessage, startSeq: number, time: number): void {
    this.state = {
      startSeq,
      revision: 0,
      synchronized: true,
      message: copyPiAssistantMessage(message),
      toolCallJson: new Map(),
      time,
    };
  }

  applySnapshot(payload: SessionMessageSnapshotPayload): SessionMessageApplyResult {
    if (
      this.state?.streamId === payload.streamId &&
      this.state.startSeq === payload.startSeq &&
      payload.revision <= this.state.revision
    ) {
      return { kind: "ignored" };
    }
    this.state = {
      streamId: payload.streamId,
      startSeq: payload.startSeq,
      revision: payload.revision,
      synchronized: true,
      message: copyPiAssistantMessage(payload.message),
      toolCallJson: toolCallJsonFromSnapshot(payload.toolCallJson),
      time: payload.time,
    };
    return { kind: "event", event: transientEvent(this.state, "snapshot") };
  }

  applyUpdate(payload: SessionMessageUpdatePayload): SessionMessageApplyResult {
    let state = this.state;
    if (!state) {
      if (payload.revision !== 1) return { kind: "gap" };
      state = {
        streamId: payload.streamId,
        startSeq: payload.startSeq,
        revision: 0,
        synchronized: true,
        message: messageFromMetadata(payload),
        toolCallJson: new Map(),
        time: payload.time,
      };
      this.state = state;
    } else if (state.streamId === undefined) {
      if (state.startSeq !== payload.startSeq || payload.revision !== 1) {
        state.synchronized = false;
        return { kind: "gap" };
      }
      state.streamId = payload.streamId;
    } else if (state.streamId !== payload.streamId || state.startSeq !== payload.startSeq) {
      return { kind: "ignored" };
    }

    if (!state.synchronized) return { kind: "ignored" };
    if (payload.revision <= state.revision) return { kind: "ignored" };
    if (payload.revision !== state.revision + 1) {
      state.synchronized = false;
      return { kind: "gap" };
    }

    state.message = {
      ...state.message,
      ...payload.message,
      role: "assistant",
      content: state.message.content,
    };
    const nextMessage = applySessionMessageDelta(state.message, state.toolCallJson, payload.update);
    if (!nextMessage) {
      state.synchronized = false;
      return { kind: "gap" };
    }
    state.message = nextMessage;
    state.revision = payload.revision;
    state.time = payload.time;
    return { kind: "event", event: transientEvent(state, "delta") };
  }

  currentEvent(): PiEvent | undefined {
    const state = this.state;
    return state?.streamId && state.synchronized ? transientEvent(state, "snapshot") : undefined;
  }

  reset(): void {
    this.state = undefined;
  }
}
