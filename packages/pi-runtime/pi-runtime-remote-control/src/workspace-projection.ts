import { remoteUtf8ByteLength } from "@workbench/remote-control-contracts/codecs";

const IDENTIFIER = /^[\x21-\x7e]{1,128}$/u;
const MAXIMUM_WORKSPACES = 200;
const MAXIMUM_DISPLAY_NAME_BYTES = 512;
const MAXIMUM_CATALOG_BYTES = 64 * 1024;

export interface RemoteWorkspaceSummary {
  readonly workspaceId: string;
  readonly displayName: string;
  readonly isDefault: boolean;
}

export interface RemoteWorkspaceCatalog {
  readonly items: readonly RemoteWorkspaceSummary[];
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function displayName(source: Readonly<Record<string, unknown>>): string | undefined {
  const value =
    typeof source.displayName === "string"
      ? source.displayName
      : typeof source.title === "string"
        ? source.title
        : undefined;
  if (!value || remoteUtf8ByteLength(value) > MAXIMUM_DISPLAY_NAME_BYTES) return undefined;
  return value;
}

/** Projects only opaque identity and presentation; paths never cross the remote boundary. */
export function projectRemoteWorkspaceCatalog(input: {
  readonly workspaces: readonly unknown[];
  readonly defaultWorkspaceId?: string;
}): RemoteWorkspaceCatalog {
  const items: RemoteWorkspaceSummary[] = [];
  const seen = new Set<string>();
  for (const value of input.workspaces) {
    if (items.length >= MAXIMUM_WORKSPACES) break;
    const source = record(value);
    const workspaceId = source?.workspaceId;
    const name = source ? displayName(source) : undefined;
    if (
      typeof workspaceId !== "string" ||
      !IDENTIFIER.test(workspaceId) ||
      !name ||
      seen.has(workspaceId)
    ) {
      continue;
    }
    const candidate = {
      workspaceId,
      displayName: name,
      isDefault: workspaceId === input.defaultWorkspaceId,
    };
    if (
      remoteUtf8ByteLength(JSON.stringify({ items: [...items, candidate] })) > MAXIMUM_CATALOG_BYTES
    ) {
      break;
    }
    items.push(Object.freeze(candidate));
    seen.add(workspaceId);
  }
  return Object.freeze({ items: Object.freeze(items) });
}
