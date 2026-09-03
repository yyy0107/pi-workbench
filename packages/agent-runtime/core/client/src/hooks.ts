"use client";

import type {
  ConversationNode,
  ConversationSnapshot,
} from "@workbench/agent-runtime-contracts/conversation";
import type { CurrentSessionSnapshot, ThreadListSnapshot } from "@workbench/agent-runtime-core";

import { useHostSnapshot } from "./bind-snapshot-selector";
import { useRuntimeContext, useSessionContext } from "./runtime-context";

const identity = <T>(value: T): T => value;

/** Read the stable Runtime object selected by the application composition root. */
export function useAgentRuntime() {
  return useRuntimeContext();
}

/** Read the stable Session object installed by the nearest SessionProvider. */
export function useConversationSession() {
  return useSessionContext();
}

export function useThreadList(): ThreadListSnapshot;
export function useThreadList<Selection>(
  selector: (snapshot: ThreadListSnapshot) => Selection,
  isEqual?: (left: Selection, right: Selection) => boolean,
): Selection;
export function useThreadList<Selection>(
  selector: (snapshot: ThreadListSnapshot) => Selection = identity as (
    snapshot: ThreadListSnapshot,
  ) => Selection,
  isEqual?: (left: Selection, right: Selection) => boolean,
): Selection {
  return useHostSnapshot(useAgentRuntime().threads, selector, isEqual);
}

/** Subscribe to the current stable Session identity and draft status. */
export function useCurrentSession(): CurrentSessionSnapshot {
  return useHostSnapshot(useAgentRuntime().current, identity);
}

export function useSessionState(): ConversationSnapshot;
export function useSessionState<Selection>(
  selector: (snapshot: ConversationSnapshot) => Selection,
  isEqual?: (left: Selection, right: Selection) => boolean,
): Selection;
export function useSessionState<Selection>(
  selector: (snapshot: ConversationSnapshot) => Selection = identity as (
    snapshot: ConversationSnapshot,
  ) => Selection,
  isEqual?: (left: Selection, right: Selection) => boolean,
): Selection {
  return useHostSnapshot(useConversationSession().snapshot, selector, isEqual);
}

export function useConversationNode(nodeKey: string): ConversationNode | undefined;
export function useConversationNode<Selection>(
  nodeKey: string,
  selector: (node: ConversationNode | undefined) => Selection,
  isEqual?: (left: Selection, right: Selection) => boolean,
): Selection;
export function useConversationNode<Selection>(
  nodeKey: string,
  selector: (node: ConversationNode | undefined) => Selection = identity as (
    node: ConversationNode | undefined,
  ) => Selection,
  isEqual?: (left: Selection, right: Selection) => boolean,
): Selection {
  return useHostSnapshot(useConversationSession().node(nodeKey), selector, isEqual);
}
