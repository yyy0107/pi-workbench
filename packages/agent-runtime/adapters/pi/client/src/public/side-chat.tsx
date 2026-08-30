"use client";

import type {
  SessionScratchCreateValue,
  SessionScratchPromoteValue,
} from "@workbench/agent-runtime-pi-protocol/rpc";

import { PiBoundThreadRuntimeProvider } from "../assistant-ui/bound-thread-runtime-provider";
import { usePiSessionManager } from "../runtime/context";

export { PiBoundThreadRuntimeProvider };
export { usePiThreadStateSnapshot } from "../runtime/context";

export interface PiSideChatClient {
  createScratchSession(input: {
    sourceSessionId: string;
    atSeq?: number;
  }): Promise<SessionScratchCreateValue>;
  restoreScratchSession(scratch: SessionScratchCreateValue): boolean;
  releaseScratchSession(sessionId: string): Promise<void>;
  promoteScratchSession(input: {
    sessionId: string;
    title?: string;
  }): Promise<SessionScratchPromoteValue>;
}

export function usePiSideChatClient(): PiSideChatClient {
  const manager = usePiSessionManager();
  return manager;
}
