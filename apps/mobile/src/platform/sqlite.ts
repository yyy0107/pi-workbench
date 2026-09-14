import type { SQLiteDatabase } from "expo-sqlite";
import {
  parseRemoteConversationPageV1,
  parseRemoteOperationRequestV1,
  parseRemoteOperationResultV1,
  remoteUtf8ByteLength,
} from "@workbench/remote-control-contracts/codecs";
import type {
  RemoteConversationPageV1,
  RemoteMachineSummaryV1,
  RemoteOperationRequestV1,
  RemoteOperationResultV1,
  RemoteRunStateV1,
  RemoteSessionSummaryV1,
} from "@workbench/remote-control-contracts/protocol";
import type { DirectConnectionProfile } from "@workbench/remote-control-client/profiles";
import type { MobileProjectionPersistencePort } from "../state/projection-store.ts";
import type {
  MobileSessionStorePersistencePort,
  MobileStoredSessionLocalState,
} from "../state/session-store.ts";

const DATABASE_NAME = "workbench-remote-v1.db";
const SCHEMA_VERSION = 6;
const MAXIMUM_CACHED_CONVERSATIONS = 20;
const MAXIMUM_CONVERSATION_BYTES = 192 * 1024;
const MAXIMUM_DRAFT_BYTES = 64 * 1024;
const MAXIMUM_OPERATION_BYTES = 256 * 1024;

type DatabasePort = Pick<
  SQLiteDatabase,
  | "closeAsync"
  | "execAsync"
  | "getAllAsync"
  | "getFirstAsync"
  | "runAsync"
  | "withExclusiveTransactionAsync"
>;

interface SQLiteModule {
  openDatabaseAsync(name: string, options?: object): Promise<DatabasePort>;
}

const MIGRATION_V1 = `
CREATE TABLE IF NOT EXISTS installation_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS secure_item_index (
  item_key TEXT PRIMARY KEY CHECK (length(item_key) BETWEEN 1 AND 512)
);
CREATE TABLE IF NOT EXISTS machines (
  machine_id TEXT PRIMARY KEY,
  projection_json TEXT NOT NULL CHECK (length(projection_json) <= 262144),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session_projections (
  machine_id TEXT NOT NULL REFERENCES machines(machine_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  projection_json TEXT NOT NULL CHECK (length(projection_json) <= 262144),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (machine_id, session_id)
);
CREATE TABLE IF NOT EXISTS drafts (
  machine_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  text TEXT NOT NULL CHECK (length(text) <= 65536),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (machine_id, session_id)
);
PRAGMA user_version = 1;`;

const MIGRATION_V2 = `
CREATE TABLE IF NOT EXISTS conversation_cache (
  machine_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  page_json TEXT NOT NULL CHECK (length(page_json) <= 196608),
  updated_at TEXT NOT NULL,
  last_accessed_at TEXT NOT NULL,
  PRIMARY KEY (machine_id, session_id)
);
CREATE INDEX IF NOT EXISTS conversation_cache_lru
  ON conversation_cache(last_accessed_at DESC, machine_id, session_id);
CREATE TABLE IF NOT EXISTS pending_operations (
  machine_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  request_json TEXT NOT NULL CHECK (length(request_json) <= 262144),
  status TEXT NOT NULL CHECK (status IN ('sending', 'accepted', 'awaiting-projection', 'outcome-unknown')),
  result_json TEXT CHECK (result_json IS NULL OR length(result_json) <= 262144),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (machine_id, operation_id)
);
CREATE INDEX IF NOT EXISTS pending_operations_session
  ON pending_operations(machine_id, session_id, updated_at);
PRAGMA user_version = 2;`;

const MIGRATION_V3 = `
CREATE TABLE IF NOT EXISTS session_local_state (
  machine_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  read_marker TEXT,
  unread INTEGER NOT NULL CHECK (unread IN (0, 1)),
  run_state TEXT NOT NULL CHECK (
    run_state IN ('idle', 'queued', 'running', 'waiting-for-input', 'stopping', 'completed', 'stopped', 'failed')
  ),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (machine_id, session_id)
);
CREATE INDEX IF NOT EXISTS session_local_state_lru
  ON session_local_state(machine_id, updated_at DESC, session_id);
PRAGMA user_version = 3;`;

const MIGRATION_V4 = `
PRAGMA user_version = 4;`;

const MIGRATION_V5 = `
CREATE TABLE IF NOT EXISTS projection_cursor (
  machine_id TEXT PRIMARY KEY,
  epoch TEXT NOT NULL CHECK (length(epoch) BETWEEN 1 AND 128),
  offset_value TEXT NOT NULL CHECK (length(offset_value) BETWEEN 1 AND 20),
  stale INTEGER NOT NULL CHECK (stale IN (0, 1)),
  updated_at TEXT NOT NULL
);
PRAGMA user_version = 5;`;

const MIGRATION_V6 = `
DROP TABLE IF EXISTS notification_registration_state;
DROP TABLE IF EXISTS notification_hint_dedupe;
CREATE TABLE IF NOT EXISTS direct_connection_profiles (
  machine_id TEXT PRIMARY KEY CHECK (length(machine_id) BETWEEN 1 AND 128),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 256),
  desktop_key_id TEXT NOT NULL CHECK (length(desktop_key_id) BETWEEN 1 AND 128),
  desktop_public_key TEXT NOT NULL CHECK (length(desktop_public_key) BETWEEN 1 AND 4096),
  desktop_fingerprint TEXT NOT NULL CHECK (length(desktop_fingerprint) BETWEEN 1 AND 256),
  device_id TEXT NOT NULL CHECK (length(device_id) BETWEEN 1 AND 128),
  authorization_revision TEXT NOT NULL CHECK (length(authorization_revision) BETWEEN 1 AND 128),
  preferred_endpoint_id TEXT NOT NULL CHECK (length(preferred_endpoint_id) BETWEEN 1 AND 512),
  protocol_min INTEGER NOT NULL,
  protocol_max INTEGER NOT NULL,
  connection_state TEXT NOT NULL CHECK (connection_state IN (
    'offline', 'connecting', 'pairing', 'authenticating', 'synchronizing', 'ready',
    'reconnecting', 'suspended', 'incompatible', 'identity-mismatch', 'revoked'
  )),
  last_seen_at TEXT
) STRICT;
CREATE TABLE IF NOT EXISTS direct_profile_endpoints (
  machine_id TEXT NOT NULL REFERENCES direct_connection_profiles(machine_id) ON DELETE CASCADE,
  endpoint_id TEXT NOT NULL CHECK (length(endpoint_id) BETWEEN 1 AND 512),
  kind TEXT NOT NULL CHECK (kind IN ('local-network', 'tailscale')),
  host TEXT NOT NULL CHECK (length(host) BETWEEN 1 AND 253),
  port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
  priority INTEGER NOT NULL CHECK (priority BETWEEN 0 AND 7),
  approved_at TEXT NOT NULL,
  last_succeeded_at TEXT,
  PRIMARY KEY (machine_id, endpoint_id),
  UNIQUE (machine_id, priority)
) STRICT;
CREATE INDEX IF NOT EXISTS direct_profile_endpoint_priority
  ON direct_profile_endpoints(machine_id, priority, endpoint_id);
PRAGMA user_version = 6;`;

export type MobilePersistedOperationStatus =
  | "sending"
  | "accepted"
  | "awaiting-projection"
  | "outcome-unknown";

export interface MobilePersistedOperation {
  readonly machineId: string;
  readonly sessionId: string;
  readonly operationId: string;
  readonly request: RemoteOperationRequestV1;
  readonly status: MobilePersistedOperationStatus;
  readonly result?: RemoteOperationResultV1;
  readonly updatedAt: string;
}

function validPersistedOperation(value: MobilePersistedOperation): boolean {
  return (
    value.request.operationId === value.operationId &&
    parseRemoteOperationRequestV1(value.request) !== undefined &&
    (value.result === undefined ||
      (value.result.operationId === value.operationId &&
        parseRemoteOperationResultV1(value.result) !== undefined))
  );
}

function boundedJson(value: unknown, maximumBytes: number): string {
  const encoded = JSON.stringify(value);
  if (remoteUtf8ByteLength(encoded) > maximumBytes) throw new Error("mobile_cache_value_too_large");
  return encoded;
}

export async function openMobileDatabase(options: {
  readonly loadModule?: () => Promise<SQLiteModule>;
}) {
  const loadModule = options.loadModule ?? (() => import("expo-sqlite") as Promise<SQLiteModule>);
  const database = await (
    await loadModule()
  ).openDatabaseAsync(DATABASE_NAME, {
    useNewConnection: true,
  });
  await database.execAsync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const version = await database.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  const current = Number(version?.user_version ?? 0);
  if (!Number.isSafeInteger(current) || current < 0 || current > SCHEMA_VERSION) {
    await database.closeAsync();
    throw new Error("mobile_database_version_invalid");
  }
  if (current < 1)
    await database.withExclusiveTransactionAsync((transaction) =>
      transaction.execAsync(MIGRATION_V1),
    );
  if (current < 2)
    await database.withExclusiveTransactionAsync((transaction) =>
      transaction.execAsync(MIGRATION_V2),
    );
  if (current < 3)
    await database.withExclusiveTransactionAsync((transaction) =>
      transaction.execAsync(MIGRATION_V3),
    );
  if (current < 4)
    await database.withExclusiveTransactionAsync((transaction) =>
      transaction.execAsync(MIGRATION_V4),
    );
  if (current < 5)
    await database.withExclusiveTransactionAsync((transaction) =>
      transaction.execAsync(MIGRATION_V5),
    );
  if (current < 6)
    await database.withExclusiveTransactionAsync((transaction) =>
      transaction.execAsync(MIGRATION_V6),
    );

  return {
    sentinel: {
      async exists(): Promise<boolean> {
        return Boolean(
          await database.getFirstAsync<{ singleton: number }>(
            "SELECT singleton FROM installation_state WHERE singleton = ? LIMIT 1",
            [1],
          ),
        );
      },
      async create(): Promise<void> {
        await database.runAsync(
          "INSERT OR IGNORE INTO installation_state(singleton, created_at) VALUES (?, ?)",
          [1, new Date().toISOString()],
        );
      },
    },
    secureItemIndex: {
      async list(): Promise<readonly string[]> {
        const rows = await database.getAllAsync<{ item_key: string }>(
          "SELECT item_key FROM secure_item_index ORDER BY item_key",
        );
        return rows.map((row) => row.item_key);
      },
      async add(key: string): Promise<void> {
        await database.runAsync("INSERT OR IGNORE INTO secure_item_index(item_key) VALUES (?)", [
          key,
        ]);
      },
      async remove(key: string): Promise<void> {
        await database.runAsync("DELETE FROM secure_item_index WHERE item_key = ?", [key]);
      },
      async clear(): Promise<void> {
        await database.runAsync("DELETE FROM secure_item_index", []);
      },
    },
    directProfiles: {
      async list(): Promise<readonly DirectConnectionProfile[]> {
        const rows = await database.getAllAsync<{
          machine_id: string;
          display_name: string;
          desktop_key_id: string;
          desktop_public_key: string;
          desktop_fingerprint: string;
          device_id: string;
          authorization_revision: string;
          preferred_endpoint_id: string;
          protocol_min: number;
          protocol_max: number;
          connection_state: DirectConnectionProfile["connectionState"];
          last_seen_at: string | null;
        }>(
          `SELECT machine_id, display_name, desktop_key_id, desktop_public_key,
                  desktop_fingerprint, device_id, authorization_revision,
                  preferred_endpoint_id, protocol_min, protocol_max,
                  connection_state, last_seen_at
             FROM direct_connection_profiles
            ORDER BY COALESCE(last_seen_at, '') DESC, machine_id
            LIMIT 100`,
        );
        const values: DirectConnectionProfile[] = [];
        for (const row of rows) {
          const endpoints = await database.getAllAsync<{
            endpoint_id: string;
            kind: "local-network" | "tailscale";
            host: string;
            port: number;
            priority: number;
            approved_at: string;
            last_succeeded_at: string | null;
          }>(
            `SELECT endpoint_id, kind, host, port, priority, approved_at, last_succeeded_at
               FROM direct_profile_endpoints
              WHERE machine_id = ?
              ORDER BY priority, endpoint_id`,
            [row.machine_id],
          );
          values.push({
            machineId: row.machine_id,
            displayName: row.display_name,
            desktopEncryptionKeyId: row.desktop_key_id,
            desktopEncryptionPublicKey: row.desktop_public_key,
            desktopFingerprint: row.desktop_fingerprint,
            deviceId: row.device_id,
            authorizationRevision: row.authorization_revision,
            preferredEndpointId: row.preferred_endpoint_id,
            protocolRange: { min: row.protocol_min, max: row.protocol_max },
            connectionState: row.connection_state,
            ...(row.last_seen_at ? { lastSeenAt: row.last_seen_at } : {}),
            endpoints: endpoints.map((endpoint) => ({
              endpointId: endpoint.endpoint_id,
              kind: endpoint.kind,
              host: endpoint.host,
              port: endpoint.port,
              priority: endpoint.priority,
              approvedAt: endpoint.approved_at,
              ...(endpoint.last_succeeded_at
                ? { lastSucceededAt: endpoint.last_succeeded_at }
                : {}),
            })),
          });
        }
        return values;
      },
      async save(profile: DirectConnectionProfile): Promise<void> {
        if (profile.endpoints.length < 1 || profile.endpoints.length > 8) {
          throw new Error("connection_profile_invalid");
        }
        await database.withExclusiveTransactionAsync(async (transaction) => {
          await transaction.runAsync(
            `INSERT INTO direct_connection_profiles(
               machine_id, display_name, desktop_key_id, desktop_public_key,
               desktop_fingerprint, device_id, authorization_revision,
               preferred_endpoint_id, protocol_min, protocol_max, connection_state, last_seen_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(machine_id) DO UPDATE SET
               display_name = excluded.display_name,
               desktop_key_id = excluded.desktop_key_id,
               desktop_public_key = excluded.desktop_public_key,
               desktop_fingerprint = excluded.desktop_fingerprint,
               device_id = excluded.device_id,
               authorization_revision = excluded.authorization_revision,
               preferred_endpoint_id = excluded.preferred_endpoint_id,
               protocol_min = excluded.protocol_min,
               protocol_max = excluded.protocol_max,
               connection_state = excluded.connection_state,
               last_seen_at = excluded.last_seen_at`,
            [
              profile.machineId,
              profile.displayName,
              profile.desktopEncryptionKeyId,
              profile.desktopEncryptionPublicKey,
              profile.desktopFingerprint,
              profile.deviceId,
              profile.authorizationRevision,
              profile.preferredEndpointId,
              profile.protocolRange.min,
              profile.protocolRange.max,
              profile.connectionState,
              profile.lastSeenAt ?? null,
            ],
          );
          await transaction.runAsync("DELETE FROM direct_profile_endpoints WHERE machine_id = ?", [
            profile.machineId,
          ]);
          for (const endpoint of profile.endpoints) {
            await transaction.runAsync(
              `INSERT INTO direct_profile_endpoints(
                 machine_id, endpoint_id, kind, host, port, priority,
                 approved_at, last_succeeded_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                profile.machineId,
                endpoint.endpointId,
                endpoint.kind,
                endpoint.host,
                endpoint.port,
                endpoint.priority,
                endpoint.approvedAt,
                endpoint.lastSucceededAt ?? null,
              ],
            );
          }
        });
      },
      async remove(machineId: string): Promise<void> {
        await database.runAsync("DELETE FROM direct_connection_profiles WHERE machine_id = ?", [
          machineId,
        ]);
      },
    },
    projection: {
      async loadMachines(): Promise<readonly RemoteMachineSummaryV1[]> {
        const rows = await database.getAllAsync<{ projection_json: string }>(
          "SELECT projection_json FROM machines ORDER BY updated_at DESC, machine_id LIMIT 100",
        );
        return rows.map((row) => JSON.parse(row.projection_json) as RemoteMachineSummaryV1);
      },
      async replaceMachines(items: readonly RemoteMachineSummaryV1[]): Promise<void> {
        await database.withExclusiveTransactionAsync(async (transaction) => {
          const keep = new Set(items.map((item) => item.machineId));
          const existing = await transaction.getAllAsync<{ machine_id: string }>(
            "SELECT machine_id FROM machines",
          );
          for (const machine of items) {
            await transaction.runAsync(
              `INSERT INTO machines(machine_id, projection_json, updated_at) VALUES (?, ?, ?)
               ON CONFLICT(machine_id) DO UPDATE SET projection_json = excluded.projection_json,
                 updated_at = excluded.updated_at`,
              [machine.machineId, JSON.stringify(machine), machine.lastSeenAt],
            );
          }
          for (const row of existing) {
            if (!keep.has(row.machine_id)) {
              await transaction.runAsync("DELETE FROM machines WHERE machine_id = ?", [
                row.machine_id,
              ]);
            }
          }
        });
      },
      async loadSessions(machineId: string): Promise<readonly RemoteSessionSummaryV1[]> {
        const rows = await database.getAllAsync<{ projection_json: string }>(
          `SELECT projection_json FROM session_projections WHERE machine_id = ?
           ORDER BY updated_at DESC, session_id LIMIT 200`,
          [machineId],
        );
        return rows.map((row) => JSON.parse(row.projection_json) as RemoteSessionSummaryV1);
      },
      async replaceSessions(
        machineId: string,
        items: readonly RemoteSessionSummaryV1[],
      ): Promise<void> {
        if (items.length > 200) throw new Error("session_catalog_invalid");
        await database.withExclusiveTransactionAsync(async (transaction) => {
          await transaction.runAsync("DELETE FROM session_projections WHERE machine_id = ?", [
            machineId,
          ]);
          for (const session of items) {
            await transaction.runAsync(
              `INSERT INTO session_projections(
                 machine_id, session_id, projection_json, updated_at
               ) VALUES (?, ?, ?, ?)`,
              [machineId, session.sessionId, JSON.stringify(session), session.updatedAt],
            );
          }
        });
      },
      async clearMachine(machineId: string): Promise<void> {
        await database.withExclusiveTransactionAsync(async (transaction) => {
          await transaction.runAsync("DELETE FROM session_projections WHERE machine_id = ?", [
            machineId,
          ]);
          await transaction.runAsync("DELETE FROM machines WHERE machine_id = ?", [machineId]);
          await transaction.runAsync("DELETE FROM drafts WHERE machine_id = ?", [machineId]);
          await transaction.runAsync("DELETE FROM conversation_cache WHERE machine_id = ?", [
            machineId,
          ]);
          await transaction.runAsync("DELETE FROM pending_operations WHERE machine_id = ?", [
            machineId,
          ]);
          await transaction.runAsync("DELETE FROM session_local_state WHERE machine_id = ?", [
            machineId,
          ]);
          await transaction.runAsync("DELETE FROM projection_cursor WHERE machine_id = ?", [
            machineId,
          ]);
        });
      },
      async clearAll(): Promise<void> {
        await database.withExclusiveTransactionAsync(async (transaction) => {
          await transaction.runAsync("DELETE FROM session_projections", []);
          await transaction.runAsync("DELETE FROM machines", []);
          await transaction.runAsync("DELETE FROM drafts", []);
          await transaction.runAsync("DELETE FROM conversation_cache", []);
          await transaction.runAsync("DELETE FROM pending_operations", []);
          await transaction.runAsync("DELETE FROM session_local_state", []);
          await transaction.runAsync("DELETE FROM projection_cursor", []);
          await transaction.runAsync("DELETE FROM direct_connection_profiles", []);
        });
      },
    },
    conversation: {
      async load(
        machineId: string,
        sessionId: string,
      ): Promise<RemoteConversationPageV1 | undefined> {
        const row = await database.getFirstAsync<{ page_json: string }>(
          `SELECT page_json FROM conversation_cache
           WHERE machine_id = ? AND session_id = ? LIMIT 1`,
          [machineId, sessionId],
        );
        if (!row) return undefined;
        const parsed = parseRemoteConversationPageV1(JSON.parse(row.page_json) as unknown);
        if (!parsed || parsed.sessionId !== sessionId)
          throw new Error("conversation_cache_invalid");
        await database.runAsync(
          `UPDATE conversation_cache SET last_accessed_at = ?
           WHERE machine_id = ? AND session_id = ?`,
          [new Date().toISOString(), machineId, sessionId],
        );
        return parsed;
      },
      async save(machineId: string, page: RemoteConversationPageV1): Promise<void> {
        const parsed = parseRemoteConversationPageV1(page);
        if (!parsed || parsed.sessionId !== page.sessionId)
          throw new Error("conversation_cache_invalid");
        const encoded = boundedJson(parsed, MAXIMUM_CONVERSATION_BYTES);
        const now = new Date().toISOString();
        await database.withExclusiveTransactionAsync(async (transaction) => {
          await transaction.runAsync(
            `INSERT INTO conversation_cache(
               machine_id, session_id, page_json, updated_at, last_accessed_at
             ) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(machine_id, session_id) DO UPDATE SET
               page_json = excluded.page_json,
               updated_at = excluded.updated_at,
               last_accessed_at = excluded.last_accessed_at`,
            [machineId, parsed.sessionId, encoded, now, now],
          );
          await transaction.runAsync(
            `DELETE FROM conversation_cache WHERE rowid IN (
               SELECT rowid FROM conversation_cache
               ORDER BY last_accessed_at DESC, machine_id, session_id
               LIMIT -1 OFFSET ?
             )`,
            [MAXIMUM_CACHED_CONVERSATIONS],
          );
        });
      },
      async loadDraft(machineId: string, sessionId: string): Promise<string> {
        const row = await database.getFirstAsync<{ text: string }>(
          "SELECT text FROM drafts WHERE machine_id = ? AND session_id = ? LIMIT 1",
          [machineId, sessionId],
        );
        return row?.text ?? "";
      },
      async saveDraft(machineId: string, sessionId: string, text: string): Promise<void> {
        if (remoteUtf8ByteLength(text) > MAXIMUM_DRAFT_BYTES) throw new Error("draft_too_large");
        if (!text) {
          await database.runAsync("DELETE FROM drafts WHERE machine_id = ? AND session_id = ?", [
            machineId,
            sessionId,
          ]);
          return;
        }
        await database.runAsync(
          `INSERT INTO drafts(machine_id, session_id, text, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(machine_id, session_id) DO UPDATE SET
             text = excluded.text, updated_at = excluded.updated_at`,
          [machineId, sessionId, text, new Date().toISOString()],
        );
      },
      async listOperations(
        machineId: string,
        sessionId: string,
      ): Promise<readonly MobilePersistedOperation[]> {
        const rows = await database.getAllAsync<{
          machine_id: string;
          session_id: string;
          operation_id: string;
          request_json: string;
          status: MobilePersistedOperationStatus;
          result_json: string | null;
          updated_at: string;
        }>(
          `SELECT machine_id, session_id, operation_id, request_json, status, result_json, updated_at
           FROM pending_operations WHERE machine_id = ? AND session_id = ?
           ORDER BY updated_at, operation_id LIMIT 100`,
          [machineId, sessionId],
        );
        return rows.map((row) => {
          const value: MobilePersistedOperation = {
            machineId: row.machine_id,
            sessionId: row.session_id,
            operationId: row.operation_id,
            request: JSON.parse(row.request_json) as RemoteOperationRequestV1,
            status: row.status,
            ...(row.result_json
              ? { result: JSON.parse(row.result_json) as RemoteOperationResultV1 }
              : {}),
            updatedAt: row.updated_at,
          };
          if (!validPersistedOperation(value)) throw new Error("pending_operation_cache_invalid");
          return value;
        });
      },
      async saveOperation(value: MobilePersistedOperation): Promise<void> {
        if (!validPersistedOperation(value)) throw new Error("pending_operation_cache_invalid");
        const requestJson = boundedJson(value.request, MAXIMUM_OPERATION_BYTES);
        const resultJson = value.result ? boundedJson(value.result, MAXIMUM_OPERATION_BYTES) : null;
        await database.runAsync(
          `INSERT INTO pending_operations(
             machine_id, session_id, operation_id, request_json, status, result_json, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(machine_id, operation_id) DO UPDATE SET
             session_id = excluded.session_id,
             request_json = excluded.request_json,
             status = excluded.status,
             result_json = excluded.result_json,
             updated_at = excluded.updated_at`,
          [
            value.machineId,
            value.sessionId,
            value.operationId,
            requestJson,
            value.status,
            resultJson,
            value.updatedAt,
          ],
        );
      },
      async removeOperation(machineId: string, operationId: string): Promise<void> {
        await database.runAsync(
          "DELETE FROM pending_operations WHERE machine_id = ? AND operation_id = ?",
          [machineId, operationId],
        );
      },
    },
    sessions: {
      loadCatalog: (machineId: string) =>
        database
          .getAllAsync<{ projection_json: string }>(
            `SELECT projection_json FROM session_projections WHERE machine_id = ?
             ORDER BY updated_at DESC, session_id LIMIT 200`,
            [machineId],
          )
          .then((rows) =>
            rows.map(
              ({ projection_json }) => JSON.parse(projection_json) as RemoteSessionSummaryV1,
            ),
          ),
      async replaceCatalog(
        machineId: string,
        items: readonly RemoteSessionSummaryV1[],
      ): Promise<void> {
        if (items.length > 200) throw new Error("session_catalog_invalid");
        await database.withExclusiveTransactionAsync(async (transaction) => {
          await transaction.runAsync("DELETE FROM session_projections WHERE machine_id = ?", [
            machineId,
          ]);
          for (const session of items) {
            await transaction.runAsync(
              `INSERT INTO session_projections(
                 machine_id, session_id, projection_json, updated_at
               ) VALUES (?, ?, ?, ?)`,
              [machineId, session.sessionId, JSON.stringify(session), session.updatedAt],
            );
          }
        });
      },
      async loadLocalStates(machineId: string): Promise<readonly MobileStoredSessionLocalState[]> {
        const rows = await database.getAllAsync<{
          machine_id: string;
          session_id: string;
          draft: string;
          read_marker: string | null;
          unread: number;
          run_state: RemoteRunStateV1;
          updated_at: string;
        }>(
          `WITH ids AS (
             SELECT machine_id, session_id FROM drafts WHERE machine_id = ?
             UNION
             SELECT machine_id, session_id FROM session_local_state WHERE machine_id = ?
           )
           SELECT ids.machine_id, ids.session_id, COALESCE(drafts.text, '') AS draft,
             session_local_state.read_marker,
             COALESCE(session_local_state.unread, 0) AS unread,
             COALESCE(session_local_state.run_state, 'idle') AS run_state,
             COALESCE(session_local_state.updated_at, drafts.updated_at) AS updated_at
           FROM ids
           LEFT JOIN drafts USING (machine_id, session_id)
           LEFT JOIN session_local_state USING (machine_id, session_id)
           ORDER BY updated_at DESC, ids.session_id LIMIT 200`,
          [machineId, machineId],
        );
        return rows.map((row) => ({
          machineId: row.machine_id,
          sessionId: row.session_id,
          draft: row.draft,
          ...(row.read_marker === null ? {} : { readMarker: row.read_marker }),
          unread: row.unread === 1,
          runState: row.run_state,
          updatedAt: row.updated_at,
        }));
      },
      async saveLocalState(value: MobileStoredSessionLocalState): Promise<void> {
        if (remoteUtf8ByteLength(value.draft) > MAXIMUM_DRAFT_BYTES) {
          throw new Error("draft_too_large");
        }
        await database.withExclusiveTransactionAsync(async (transaction) => {
          if (value.draft) {
            await transaction.runAsync(
              `INSERT INTO drafts(machine_id, session_id, text, updated_at) VALUES (?, ?, ?, ?)
               ON CONFLICT(machine_id, session_id) DO UPDATE SET
                 text = excluded.text, updated_at = excluded.updated_at`,
              [value.machineId, value.sessionId, value.draft, value.updatedAt],
            );
          } else {
            await transaction.runAsync(
              "DELETE FROM drafts WHERE machine_id = ? AND session_id = ?",
              [value.machineId, value.sessionId],
            );
          }
          await transaction.runAsync(
            `INSERT INTO session_local_state(
               machine_id, session_id, read_marker, unread, run_state, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(machine_id, session_id) DO UPDATE SET
               read_marker = excluded.read_marker,
               unread = excluded.unread,
               run_state = excluded.run_state,
               updated_at = excluded.updated_at`,
            [
              value.machineId,
              value.sessionId,
              value.readMarker ?? null,
              value.unread ? 1 : 0,
              value.runState,
              value.updatedAt,
            ],
          );
          await transaction.runAsync(
            `DELETE FROM session_local_state WHERE rowid IN (
               SELECT rowid FROM session_local_state WHERE machine_id = ?
               ORDER BY updated_at DESC, session_id LIMIT -1 OFFSET 200
             )`,
            [value.machineId],
          );
          await transaction.runAsync(
            `DELETE FROM drafts WHERE machine_id = ? AND session_id NOT IN (
               SELECT session_id FROM session_local_state WHERE machine_id = ?
             )`,
            [value.machineId, value.machineId],
          );
        });
      },
      async clearMachine(machineId: string): Promise<void> {
        await database.withExclusiveTransactionAsync(async (transaction) => {
          await transaction.runAsync("DELETE FROM session_projections WHERE machine_id = ?", [
            machineId,
          ]);
          await transaction.runAsync("DELETE FROM drafts WHERE machine_id = ?", [machineId]);
          await transaction.runAsync("DELETE FROM session_local_state WHERE machine_id = ?", [
            machineId,
          ]);
        });
      },
    } satisfies MobileSessionStorePersistencePort,
    projectionSync: {
      async load(machineId: string) {
        const cursor = await database.getFirstAsync<{
          epoch: string;
          offset_value: string;
          stale: number;
        }>(
          `SELECT epoch, offset_value, stale FROM projection_cursor
           WHERE machine_id = ? LIMIT 1`,
          [machineId],
        );
        if (!cursor) return undefined;
        const sessions = await database.getAllAsync<{ projection_json: string }>(
          `SELECT projection_json FROM session_projections WHERE machine_id = ?
           ORDER BY updated_at DESC, session_id LIMIT 200`,
          [machineId],
        );
        return {
          sessions: sessions.map(
            ({ projection_json }) => JSON.parse(projection_json) as RemoteSessionSummaryV1,
          ),
          cursor: { epoch: cursor.epoch, offset: cursor.offset_value },
          stale: cursor.stale === 1,
        };
      },
      async replace(machineId, value) {
        await database.withExclusiveTransactionAsync(async (transaction) => {
          await transaction.runAsync("DELETE FROM session_projections WHERE machine_id = ?", [
            machineId,
          ]);
          for (const session of value.sessions) {
            await transaction.runAsync(
              `INSERT INTO session_projections(
                 machine_id, session_id, projection_json, updated_at
               ) VALUES (?, ?, ?, ?)`,
              [machineId, session.sessionId, boundedJson(session, 256 * 1024), session.updatedAt],
            );
          }
          await transaction.runAsync(
            `INSERT INTO projection_cursor(machine_id, epoch, offset_value, stale, updated_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(machine_id) DO UPDATE SET
               epoch = excluded.epoch,
               offset_value = excluded.offset_value,
               stale = excluded.stale,
               updated_at = excluded.updated_at`,
            [
              machineId,
              value.cursor.epoch,
              value.cursor.offset,
              value.stale ? 1 : 0,
              new Date().toISOString(),
            ],
          );
        });
      },
      async markStale(machineId) {
        await database.runAsync(
          "UPDATE projection_cursor SET stale = 1, updated_at = ? WHERE machine_id = ?",
          [new Date().toISOString(), machineId],
        );
      },
    } satisfies MobileProjectionPersistencePort,
    close: () => database.closeAsync(),
  };
}
