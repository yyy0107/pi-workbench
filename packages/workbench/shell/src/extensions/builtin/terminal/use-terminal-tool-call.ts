import { useCallback, useSyncExternalStore } from "react";
import { useAgentRuntime, useThreadList } from "@workbench/agent-runtime-client";
import { findBashToolCall } from "./terminal-tool-transcript";
import type { TerminalTranscriptTarget } from "./terminal-target";

/** A retained terminal subscribes to its owner, independently of current navigation. */
export function useTerminalToolCall({
  piSessionId,
  threadId,
  toolCallId,
}: TerminalTranscriptTarget) {
  const runtime = useAgentRuntime();
  const owner = useThreadList((snapshot) =>
    snapshot.threads.find((thread) => thread.threadId === threadId),
  );
  const sessionId = piSessionId ?? owner?.threadId ?? threadId;
  const session = sessionId ? runtime.session(sessionId) : undefined;
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!session) return () => {};
      let nodeSubscriptions: (() => void)[] = [];
      const subscribeNodes = () => {
        nodeSubscriptions.forEach((dispose) => dispose());
        nodeSubscriptions = session.snapshot
          .getSnapshot()
          .nodeKeys.map((key) => session.node(key).subscribe(listener));
      };
      subscribeNodes();
      const disposeSnapshot = session.snapshot.subscribe(() => {
        subscribeNodes();
        listener();
      });
      return () => {
        disposeSnapshot();
        nodeSubscriptions.forEach((dispose) => dispose());
      };
    },
    [session],
  );
  const getSnapshot = useCallback(() => {
    if (!session) return undefined;
    return findBashToolCall(
      session.snapshot
        .getSnapshot()
        .nodeKeys.flatMap((key) => session.node(key).getSnapshot() ?? []),
      toolCallId,
    );
  }, [session, toolCallId]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
