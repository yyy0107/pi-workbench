import type { ComposerQueueItem } from "@workbench/agent-runtime-contracts/conversation";

export function visibleComposerQueueItems(
  queueItems: readonly ComposerQueueItem[],
): readonly ComposerQueueItem[] {
  return queueItems.slice(0, 1);
}
