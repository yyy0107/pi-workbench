"use client";

import type { RpcReceipt } from "@workbench/agent-runtime-pi-protocol/rpc";

import { usePiSessionManager } from "../runtime/context";
import type { PiInteractionResponse, PiPendingInteraction } from "../runtime/manager";

export type { PiInteractionResponse, PiPendingInteraction } from "../runtime/manager";

export interface PiInteractionClient {
  subscribe(listener: () => void): () => void;
  getSnapshot(): unknown;
  getPendingInteractions(sessionId?: string): readonly PiPendingInteraction[];
  respondInteraction(rpcId: string, response: PiInteractionResponse): Promise<RpcReceipt>;
}

export function usePiInteractionClient(): PiInteractionClient {
  const manager = usePiSessionManager();
  return manager;
}
