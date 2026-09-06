"use client";

import type {
  ConversationNode,
  ConversationSnapshot,
} from "@workbench/agent-runtime-contracts/conversation";
import { useMemo, useSyncExternalStore } from "react";
import type { CurrentSessionSnapshot, ThreadListSnapshot } from "@workbench/agent-runtime-core";

import { useHostSnapshot } from "./bind-snapshot-selector";
import { createConversationNodeSelection } from "./conversation-node-selection";
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

export interface ConversationNodeSelectionOptions<T> {
  readonly nodeKeys?: readonly string[];
  readonly select: (node: ConversationNode) => T;
  readonly isEqual?: (previous: T, next: T) => boolean;
}

/** Select node fields without rerendering consumers when only unselected content changes. */
export function useConversationNodes(): readonly ConversationNode[];
export function useConversationNodes<T>(options: ConversationNodeSelectionOptions<T>): readonly T[];
export function useConversationNodes<T = ConversationNode>(
  options?: ConversationNodeSelectionOptions<T>,
): readonly T[] {
  const session = useConversationSession();
  const nodeKeys = useSessionState((snapshot) => options?.nodeKeys ?? snapshot.nodeKeys);
  const select = options?.select ?? (identity as (node: ConversationNode) => T);
  const isEqual = options?.isEqual ?? Object.is;
  const keySignature = JSON.stringify(nodeKeys);
  const stableKeys = useMemo(() => JSON.parse(keySignature) as string[], [keySignature]);
  const selection = useMemo(
    () =>
      createConversationNodeSelection(
        stableKeys.map((key) => session.node(key)),
        select,
        isEqual,
      ),
    [session, stableKeys, select, isEqual],
  );
  return useSyncExternalStore(selection.subscribe, selection.getSnapshot, selection.getSnapshot);
}
