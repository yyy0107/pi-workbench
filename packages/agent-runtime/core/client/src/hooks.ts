"use client";

import type {
  ConversationNode,
  ConversationSnapshot,
} from "@workbench/agent-runtime-contracts/conversation";
import { useMemo, useSyncExternalStore } from "react";
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

/** Subscribe to every node in the current conversation while preserving the stable node objects. */
export function useConversationNodes(): readonly ConversationNode[] {
  const session = useConversationSession();
  const nodeKeys = useSessionState((snapshot) => snapshot.nodeKeys);
  const keySignature = JSON.stringify(nodeKeys);
  const stableKeys = useMemo(() => JSON.parse(keySignature) as string[], [keySignature]);
  const subscribe = useMemo(
    () => (listener: () => void) => {
      const unsubscribers = stableKeys.map((key) => session.node(key).subscribe(listener));
      return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
    },
    [session, stableKeys],
  );
  const getSnapshot = useMemo(() => {
    let current: readonly ConversationNode[] = [];
    return () => {
      const next = stableKeys.flatMap((key) => {
        const node = session.node(key).getSnapshot();
        return node ? [node] : [];
      });
      if (next.length === current.length && next.every((node, index) => node === current[index])) {
        return current;
      }
      current = Object.freeze(next);
      return current;
    };
  }, [session, stableKeys]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
