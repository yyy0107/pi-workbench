import {
  createSessionArchiveOperation,
  createSessionCreateOperation,
  createSessionPinnedOperation,
  createSessionRenameOperation,
} from "@workbench/remote-control-client/operations";
import { parseRemoteOperationResultV1 } from "@workbench/remote-control-contracts/codecs";
import type {
  RemoteOperationRequestV1,
  RemoteOperationResultV1,
  RemoteSessionSummaryV1,
} from "@workbench/remote-control-contracts/protocol";

const MAXIMUM_SESSIONS = 200;

export interface MobileSessionCatalogSnapshot {
  readonly machineId: string;
  readonly items: readonly RemoteSessionSummaryV1[];
  readonly stale: boolean;
  readonly canMutate: boolean;
  readonly errorCode?: string;
}

export interface MobileSessionCatalogCachePort {
  loadSessions(machineId: string): Promise<readonly RemoteSessionSummaryV1[]>;
  replaceSessions(machineId: string, items: readonly RemoteSessionSummaryV1[]): Promise<void>;
}

export interface MobileSessionCatalogRemotePort {
  read(machineId: string): Promise<readonly RemoteSessionSummaryV1[]>;
  submit?(input: {
    readonly machineId: string;
    readonly request: RemoteOperationRequestV1;
  }): Promise<RemoteOperationResultV1>;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[\x21-\x7e]{1,128}$/u.test(value);
}

function parseSession(value: unknown): RemoteSessionSummaryV1 | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const allowed = new Set([
    "sessionId",
    "workspace",
    "title",
    "updatedAt",
    "pinned",
    "archived",
    "attention",
    "runState",
    "entityRevision",
  ]);
  if (
    Object.keys(item).some((key) => !allowed.has(key)) ||
    !isIdentifier(item.sessionId) ||
    (item.title !== undefined &&
      (typeof item.title !== "string" || !item.title || byteLength(item.title) > 512)) ||
    typeof item.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(item.updatedAt)) ||
    typeof item.pinned !== "boolean" ||
    typeof item.archived !== "boolean" ||
    !isIdentifier(item.entityRevision) ||
    !["none", "unread", "input-needed", "failed"].includes(String(item.attention)) ||
    ![
      "idle",
      "queued",
      "running",
      "waiting-for-input",
      "stopping",
      "completed",
      "stopped",
      "failed",
    ].includes(String(item.runState))
  ) {
    return undefined;
  }
  if (item.workspace !== undefined) {
    if (!item.workspace || typeof item.workspace !== "object" || Array.isArray(item.workspace)) {
      return undefined;
    }
    const workspace = item.workspace as Record<string, unknown>;
    if (
      Object.keys(workspace).sort().join("|") !== "displayName|workspaceId" ||
      !isIdentifier(workspace.workspaceId) ||
      typeof workspace.displayName !== "string" ||
      byteLength(workspace.displayName) > 256
    ) {
      return undefined;
    }
  }
  return item as unknown as RemoteSessionSummaryV1;
}

export function sortRemoteSessions(
  items: readonly RemoteSessionSummaryV1[],
): readonly RemoteSessionSummaryV1[] {
  return Object.freeze(
    items
      .filter((item) => !item.archived)
      .slice(0, MAXIMUM_SESSIONS)
      .sort((left, right) => {
        if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
        const byRecent = right.updatedAt.localeCompare(left.updatedAt);
        return byRecent === 0 ? left.sessionId.localeCompare(right.sessionId) : byRecent;
      }),
  );
}

function validateSessions(items: readonly unknown[]): readonly RemoteSessionSummaryV1[] {
  if (items.length > MAXIMUM_SESSIONS) throw new Error("session_catalog_invalid");
  const parsed = items.map(parseSession);
  if (parsed.some((item) => !item)) throw new Error("session_catalog_invalid");
  const sessions = sortRemoteSessions(parsed as RemoteSessionSummaryV1[]);
  if (byteLength(JSON.stringify({ items: sessions })) > 192 * 1024) {
    throw new Error("session_catalog_invalid");
  }
  return sessions;
}

export function createMobileSessionCatalogFeature(options: {
  readonly cache: MobileSessionCatalogCachePort;
  readonly remote?: MobileSessionCatalogRemotePort;
  readonly clock?: { now(): Date };
  readonly createOperationId?: () => string;
}) {
  const operationTime = () => {
    const issuedAt = options.clock?.now() ?? new Date();
    return {
      operationId: options.createOperationId?.() ?? globalThis.crypto.randomUUID(),
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + 2 * 60 * 1_000).toISOString(),
    };
  };
  const submit = async (
    machineId: string,
    operation: ReturnType<typeof createSessionCreateOperation>,
  ) => {
    if (!options.remote?.submit) throw new Error("session_control_unavailable");
    const result = parseRemoteOperationResultV1(
      await options.remote.submit({ machineId, request: operation.request }),
    );
    if (!result || result.operationId !== operation.operationId) {
      throw new Error("operation_result_invalid");
    }
    if (result.state !== "succeeded") {
      throw Object.assign(new Error(result.code ?? "operation_outcome_unknown"), {
        code: result.code ?? "operation_outcome_unknown",
        result,
      });
    }
    return result;
  };
  return {
    async load(input: {
      readonly machineId: string;
      readonly machineReady: boolean;
    }): Promise<MobileSessionCatalogSnapshot> {
      const cached = validateSessions(await options.cache.loadSessions(input.machineId));
      if (!input.machineReady || !options.remote) {
        return Object.freeze({
          machineId: input.machineId,
          items: cached,
          stale: true,
          canMutate: false,
          errorCode: input.machineReady ? "session_catalog_unavailable" : "machine_offline",
        });
      }
      try {
        const items = validateSessions(await options.remote.read(input.machineId));
        await options.cache.replaceSessions(input.machineId, items);
        return Object.freeze({
          machineId: input.machineId,
          items,
          stale: false,
          canMutate: true,
        });
      } catch (error) {
        return Object.freeze({
          machineId: input.machineId,
          items: cached,
          stale: true,
          canMutate: false,
          errorCode: error instanceof Error ? error.message : "session_catalog_unavailable",
        });
      }
    },
    async create(input: {
      readonly machineId: string;
      readonly title?: string;
      readonly workspaceId?: string;
    }): Promise<string> {
      const result = await submit(
        input.machineId,
        createSessionCreateOperation({
          ...operationTime(),
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
        }),
      );
      if (result.value?.type !== "session-created") {
        throw new Error("operation_result_invalid");
      }
      return result.value.sessionId;
    },
    async rename(input: {
      readonly machineId: string;
      readonly sessionId: string;
      readonly title: string;
      readonly expectedEntityRevision: string;
    }): Promise<RemoteOperationResultV1> {
      return submit(
        input.machineId,
        createSessionRenameOperation({ ...operationTime(), ...input }),
      );
    },
    async setPinned(input: {
      readonly machineId: string;
      readonly sessionId: string;
      readonly pinned: boolean;
      readonly expectedEntityRevision: string;
    }): Promise<RemoteOperationResultV1> {
      return submit(
        input.machineId,
        createSessionPinnedOperation({ ...operationTime(), ...input }),
      );
    },
    async archive(input: {
      readonly machineId: string;
      readonly sessionId: string;
      readonly expectedEntityRevision: string;
    }): Promise<RemoteOperationResultV1> {
      return submit(
        input.machineId,
        createSessionArchiveOperation({ ...operationTime(), ...input }),
      );
    },
  };
}
