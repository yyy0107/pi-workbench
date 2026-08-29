import type { ExternalStoreThreadListAdapter } from "@assistant-ui/react";

/** Project one explicitly bound Pi session as assistant-ui's current thread. */
export function createBoundPiThreadListAdapter(
  localId: string,
  remoteId?: string,
): ExternalStoreThreadListAdapter {
  return {
    threadId: localId,
    threads: [
      {
        id: localId,
        status: "regular",
        ...(remoteId === undefined ? {} : { remoteId }),
      },
    ],
    archivedThreads: [],
  };
}
