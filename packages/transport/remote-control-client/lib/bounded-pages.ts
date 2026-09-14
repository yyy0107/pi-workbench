import type {
  RemoteConversationItemV1,
  RemoteCursor,
} from "@workbench/remote-control-contracts/protocol";

const MAXIMUM_RETAINED_ITEMS = 200;

export function remoteConversationItemIdentity(item: RemoteConversationItemV1): string {
  return item.type === "ordinary-question" ? item.interactionId : item.itemId;
}

export function mergeRemoteConversationItems(input: {
  readonly current: readonly RemoteConversationItemV1[];
  readonly page: readonly RemoteConversationItemV1[];
  readonly direction: "append" | "prepend";
}): readonly RemoteConversationItemV1[] {
  const ordered =
    input.direction === "prepend"
      ? [...input.page, ...input.current]
      : [...input.current, ...input.page];
  const byIdentity = new Map<string, RemoteConversationItemV1>();
  for (const item of ordered) byIdentity.set(remoteConversationItemIdentity(item), item);
  const merged = [...byIdentity.values()];
  return Object.freeze(
    input.direction === "prepend"
      ? merged.slice(0, MAXIMUM_RETAINED_ITEMS)
      : merged.slice(-MAXIMUM_RETAINED_ITEMS),
  );
}

export function cursorIncludes(current: RemoteCursor | undefined, expected: RemoteCursor): boolean {
  if (!current || current.epoch !== expected.epoch) return false;
  return BigInt(current.offset) >= BigInt(expected.offset);
}

export function newestCursor(
  current: RemoteCursor | undefined,
  candidate: RemoteCursor,
): RemoteCursor {
  if (!current || current.epoch !== candidate.epoch) return candidate;
  return BigInt(candidate.offset) > BigInt(current.offset) ? candidate : current;
}
