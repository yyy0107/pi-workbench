import { createHash } from "node:crypto";

import {
  canonicalJson,
  parseRemoteOperationRequestV1,
  parseRemoteOperationResultV1,
} from "@workbench/remote-control-contracts/codecs";
import type {
  RemoteOperationRequestV1,
  RemoteOperationResultV1,
} from "@workbench/remote-control-contracts/protocol";

export type RemoteOperationDomainIdentity =
  | { readonly type: "message"; readonly sessionId: string; readonly messageId: string }
  | { readonly type: "session"; readonly sessionId: string }
  | { readonly type: "interaction"; readonly interactionId: string };

export interface RemoteOperationLedgerRecord {
  readonly machineId: string;
  readonly deviceId: string;
  readonly operationId: string;
  readonly commandType: RemoteOperationRequestV1["command"]["type"];
  readonly commandDigest: string;
  readonly domainIdentity?: RemoteOperationDomainIdentity;
  readonly state: RemoteOperationResultV1["state"];
  readonly result?: RemoteOperationResultV1;
  readonly acceptedAt: string;
  readonly finishedAt?: string;
}

export interface RemoteOperationLedgerStorePort {
  get(input: {
    readonly machineId: string;
    readonly deviceId: string;
    readonly operationId: string;
  }): Promise<RemoteOperationLedgerRecord | undefined>;
  insertAccepted(record: RemoteOperationLedgerRecord): Promise<boolean>;
  finish(input: {
    readonly machineId: string;
    readonly deviceId: string;
    readonly operationId: string;
    readonly result: RemoteOperationResultV1;
    readonly finishedAt: string;
  }): Promise<RemoteOperationLedgerRecord | undefined>;
  listIncomplete(machineId: string): Promise<readonly RemoteOperationLedgerRecord[]>;
  listCompleted(machineId: string): Promise<readonly RemoteOperationLedgerRecord[]>;
  prune(input: {
    readonly machineId: string;
    readonly completedBefore: string;
    readonly retainMostRecent: number;
  }): Promise<number>;
  close(): void;
}

function commandDigest(request: RemoteOperationRequestV1): string {
  const normalized = canonicalJson({
    issuedAt: request.issuedAt,
    expiresAt: request.expiresAt,
    command: request.command,
  });
  return createHash("sha256").update(normalized).digest("hex");
}

function isTerminal(result: RemoteOperationResultV1): boolean {
  return (
    parseRemoteOperationResultV1(result) !== undefined &&
    (result.state === "succeeded" || result.state === "rejected" || result.state === "expired")
  );
}

function isIdentifier(value: string): boolean {
  return /^[\x21-\x7e]{1,128}$/u.test(value);
}

function validDomainIdentity(value: RemoteOperationDomainIdentity | undefined): boolean {
  if (!value) return true;
  if (value.type === "message") {
    return isIdentifier(value.sessionId) && isIdentifier(value.messageId);
  }
  return value.type === "session"
    ? isIdentifier(value.sessionId)
    : value.type === "interaction" && isIdentifier(value.interactionId);
}

export function createRemoteOperationLedger(options: {
  readonly machineId: string;
  readonly clock: { now(): Date };
  readonly store: RemoteOperationLedgerStorePort;
}) {
  const key = (deviceId: string, operationId: string) => ({
    machineId: options.machineId,
    deviceId,
    operationId,
  });

  return {
    async begin(input: {
      readonly deviceId: string;
      readonly request: RemoteOperationRequestV1;
      readonly domainIdentity?: RemoteOperationDomainIdentity;
    }) {
      if (
        !isIdentifier(input.deviceId) ||
        !parseRemoteOperationRequestV1(input.request) ||
        !validDomainIdentity(input.domainIdentity)
      ) {
        throw new Error("operation_identity_invalid");
      }
      const digest = commandDigest(input.request);
      const existing = await options.store.get(key(input.deviceId, input.request.operationId));
      if (existing) {
        return existing.commandDigest === digest
          ? ({ kind: "replay", record: existing } as const)
          : ({ kind: "conflict", code: "operation_id_conflict" } as const);
      }
      const record: RemoteOperationLedgerRecord = {
        ...key(input.deviceId, input.request.operationId),
        commandType: input.request.command.type,
        commandDigest: digest,
        ...(input.domainIdentity ? { domainIdentity: input.domainIdentity } : {}),
        state: "accepted",
        acceptedAt: options.clock.now().toISOString(),
      };
      if (await options.store.insertAccepted(record)) {
        return { kind: "created", record } as const;
      }
      const raced = await options.store.get(key(input.deviceId, input.request.operationId));
      if (!raced) throw new Error("operation_ledger_insert_failed");
      return raced.commandDigest === digest
        ? ({ kind: "replay", record: raced } as const)
        : ({ kind: "conflict", code: "operation_id_conflict" } as const);
    },
    get(input: { readonly deviceId: string; readonly operationId: string }) {
      return options.store.get(key(input.deviceId, input.operationId));
    },
    async finish(input: {
      readonly deviceId: string;
      readonly operationId: string;
      readonly result: RemoteOperationResultV1;
    }) {
      if (input.result.operationId !== input.operationId || !isTerminal(input.result)) {
        throw new Error("operation_result_invalid");
      }
      const record = await options.store.finish({
        ...key(input.deviceId, input.operationId),
        result: input.result,
        finishedAt: options.clock.now().toISOString(),
      });
      if (!record) throw new Error("operation_not_found");
      return record;
    },
    async reconcileIncomplete(
      reconcile: (
        record: RemoteOperationLedgerRecord,
      ) => Promise<RemoteOperationResultV1 | undefined>,
    ) {
      let reconciled = 0;
      for (const record of await options.store.listIncomplete(options.machineId)) {
        const result = await reconcile(record);
        if (!result) continue;
        await this.finish({
          deviceId: record.deviceId,
          operationId: record.operationId,
          result,
        });
        reconciled += 1;
      }
      return reconciled;
    },
    listCompleted() {
      return options.store.listCompleted(options.machineId);
    },
    prune() {
      const completedBefore = new Date(
        options.clock.now().getTime() - 7 * 24 * 60 * 60 * 1_000,
      ).toISOString();
      return options.store.prune({
        machineId: options.machineId,
        completedBefore,
        retainMostRecent: 10_000,
      });
    },
    close() {
      options.store.close();
    },
  };
}
