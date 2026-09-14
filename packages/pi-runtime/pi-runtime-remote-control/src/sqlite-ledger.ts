import { chmodSync, closeSync, openSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import type { RemoteOperationResultV1 } from "@workbench/remote-control-contracts/protocol";

import {
  createRemoteOperationLedger,
  type RemoteOperationDomainIdentity,
  type RemoteOperationLedgerRecord,
  type RemoteOperationLedgerStorePort,
} from "./operation-ledger.ts";

interface LedgerRow {
  machine_id: string;
  device_id: string;
  operation_id: string;
  command_type: RemoteOperationLedgerRecord["commandType"];
  command_digest: string;
  domain_identity_json: string | null;
  state: RemoteOperationLedgerRecord["state"];
  result_json: string | null;
  accepted_at: string;
  finished_at: string | null;
}

function fromRow(row: LedgerRow | undefined): RemoteOperationLedgerRecord | undefined {
  if (!row) return undefined;
  return {
    machineId: row.machine_id,
    deviceId: row.device_id,
    operationId: row.operation_id,
    commandType: row.command_type,
    commandDigest: row.command_digest,
    ...(row.domain_identity_json
      ? { domainIdentity: JSON.parse(row.domain_identity_json) as RemoteOperationDomainIdentity }
      : {}),
    state: row.state,
    ...(row.result_json ? { result: JSON.parse(row.result_json) as RemoteOperationResultV1 } : {}),
    acceptedAt: row.accepted_at,
    ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
  };
}

function transaction<T>(database: DatabaseSync, operation: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const value = operation();
    database.exec("COMMIT");
    return value;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function openStore(filename: string): RemoteOperationLedgerStorePort {
  closeSync(openSync(filename, "a", 0o600));
  chmodSync(filename, 0o600);
  const database = new DatabaseSync(filename);
  database.exec("PRAGMA journal_mode = DELETE; PRAGMA secure_delete = ON;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS remote_operation (
      machine_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      command_type TEXT NOT NULL,
      command_digest TEXT NOT NULL,
      domain_identity_json TEXT,
      state TEXT NOT NULL CHECK (state IN ('accepted', 'succeeded', 'rejected', 'expired')),
      result_json TEXT,
      accepted_at TEXT NOT NULL,
      finished_at TEXT,
      PRIMARY KEY (machine_id, device_id, operation_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS remote_operation_incomplete
      ON remote_operation(machine_id, accepted_at)
      WHERE state = 'accepted';
    CREATE INDEX IF NOT EXISTS remote_operation_completed
      ON remote_operation(machine_id, finished_at DESC)
      WHERE state != 'accepted';
  `);
  chmodSync(filename, 0o600);

  const selectOne = database.prepare(`
    SELECT machine_id, device_id, operation_id, command_type, command_digest,
           domain_identity_json, state, result_json, accepted_at, finished_at
      FROM remote_operation
     WHERE machine_id = ? AND device_id = ? AND operation_id = ?
  `);
  const selectIncomplete = database.prepare(`
    SELECT machine_id, device_id, operation_id, command_type, command_digest,
           domain_identity_json, state, result_json, accepted_at, finished_at
      FROM remote_operation
     WHERE machine_id = ? AND state = 'accepted'
     ORDER BY accepted_at, device_id, operation_id
  `);
  const selectCompleted = database.prepare(`
    SELECT machine_id, device_id, operation_id, command_type, command_digest,
           domain_identity_json, state, result_json, accepted_at, finished_at
      FROM remote_operation
     WHERE machine_id = ? AND state != 'accepted'
     ORDER BY finished_at DESC, device_id, operation_id
  `);
  const insert = database.prepare(`
    INSERT OR IGNORE INTO remote_operation (
      machine_id, device_id, operation_id, command_type, command_digest,
      domain_identity_json, state, accepted_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'accepted', ?)
  `);
  const updateResult = database.prepare(`
    UPDATE remote_operation
       SET state = ?, result_json = ?, finished_at = ?
     WHERE machine_id = ? AND device_id = ? AND operation_id = ? AND state = 'accepted'
  `);
  const prune = database.prepare(`
    DELETE FROM remote_operation
     WHERE machine_id = ?
       AND state != 'accepted'
       AND finished_at < ?
       AND rowid NOT IN (
         SELECT rowid
           FROM remote_operation
          WHERE machine_id = ? AND state != 'accepted'
          ORDER BY finished_at DESC, rowid DESC
          LIMIT ?
       )
  `);

  return {
    async get(input) {
      return fromRow(
        selectOne.get(input.machineId, input.deviceId, input.operationId) as LedgerRow | undefined,
      );
    },
    async insertAccepted(record) {
      return transaction(database, () =>
        Boolean(
          insert.run(
            record.machineId,
            record.deviceId,
            record.operationId,
            record.commandType,
            record.commandDigest,
            record.domainIdentity ? JSON.stringify(record.domainIdentity) : null,
            record.acceptedAt,
          ).changes,
        ),
      );
    },
    async finish(input) {
      transaction(database, () => {
        const changed = updateResult.run(
          input.result.state,
          JSON.stringify(input.result),
          input.finishedAt,
          input.machineId,
          input.deviceId,
          input.operationId,
        ).changes;
        if (changed === 0) {
          const current = selectOne.get(input.machineId, input.deviceId, input.operationId) as
            | LedgerRow
            | undefined;
          if (!current || current.result_json !== JSON.stringify(input.result)) {
            throw new Error("operation_result_conflict");
          }
        }
      });
      return fromRow(
        selectOne.get(input.machineId, input.deviceId, input.operationId) as LedgerRow | undefined,
      );
    },
    async listIncomplete(machineId) {
      return (selectIncomplete.all(machineId) as unknown as LedgerRow[])
        .map(fromRow)
        .filter((value): value is RemoteOperationLedgerRecord => value !== undefined);
    },
    async listCompleted(machineId) {
      return (selectCompleted.all(machineId) as unknown as LedgerRow[])
        .map(fromRow)
        .filter((value): value is RemoteOperationLedgerRecord => value !== undefined);
    },
    async prune(input) {
      return Number(
        transaction(
          database,
          () =>
            prune.run(
              input.machineId,
              input.completedBefore,
              input.machineId,
              input.retainMostRecent,
            ).changes,
        ),
      );
    },
    close() {
      database.close();
      chmodSync(filename, 0o600);
    },
  };
}

export async function openSqliteRemoteOperationLedger(options: {
  readonly filename: string;
  readonly machineId: string;
  readonly clock: { now(): Date };
}) {
  return createRemoteOperationLedger({
    machineId: options.machineId,
    clock: options.clock,
    store: openStore(options.filename),
  });
}
