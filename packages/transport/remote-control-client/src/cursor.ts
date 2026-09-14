import { parseRemoteCursor } from "@workbench/remote-control-contracts/codecs";
import type { RemoteCursor } from "@workbench/remote-control-contracts/protocol";

export type RemoteCursorRelation = "duplicate" | "exact-next" | "gap" | "epoch-changed";

export function classifyRemoteCursor(
  current: RemoteCursor | undefined,
  incoming: RemoteCursor,
): RemoteCursorRelation {
  const parsed = parseRemoteCursor(incoming);
  if (!parsed) throw new Error("cursor_invalid");
  if (!current) return BigInt(parsed.offset) === BigInt(1) ? "exact-next" : "gap";
  const parsedCurrent = parseRemoteCursor(current);
  if (!parsedCurrent) throw new Error("cursor_invalid");
  if (parsedCurrent.epoch !== parsed.epoch) return "epoch-changed";
  const currentOffset = BigInt(parsedCurrent.offset);
  const incomingOffset = BigInt(parsed.offset);
  if (incomingOffset <= currentOffset) return "duplicate";
  return incomingOffset === currentOffset + BigInt(1) ? "exact-next" : "gap";
}
