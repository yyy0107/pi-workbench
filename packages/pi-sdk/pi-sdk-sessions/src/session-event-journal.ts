import type { SessionEvent } from "@workbench/pi-rpc-contracts/rpc";

export const SESSION_EVENT_CUSTOM_TYPE = "workbench.session-event.v1";
export const SESSION_EVENT_JOURNAL_CUSTOM_TYPE = "workbench.session-event-journal.v1";
export const SESSION_CLIENT_MUTATION_CUSTOM_TYPE = "workbench.client-mutation.v1";

const JOURNAL_VERSION = 1;

interface SessionJournalEntry {
  id?: string;
  type: string;
  customType?: string;
  data?: unknown;
}

export interface SessionEventJournalStore {
  getBranch(): SessionJournalEntry[];
  appendCustomEntry(customType: string, data?: unknown): string;
}

export interface SessionEventJournalInitialization {
  events: SessionEvent[];
  /**
   * Persistence failures are reported without escaping into the active agent event loop.
   * `events` is always the last prefix whose append call completed successfully.
   */
  error?: unknown;
}

interface StoredSessionEvent {
  version: typeof JOURNAL_VERSION;
  event: SessionEvent;
}

interface SessionEventJournalMarker {
  version: typeof JOURNAL_VERSION;
  legacyMessageCount: number;
}

export interface SessionClientMutationIdentity {
  readonly operationId: string;
  readonly messageId: string;
}

export type SessionClientMutationLookup = "absent" | "match" | "conflict";

interface StoredSessionClientMutation {
  readonly version: typeof JOURNAL_VERSION;
  readonly operationId: string;
  readonly messageId: string;
}

const CLIENT_MUTATION_IDENTIFIER = /^[\x21-\x7e]{1,128}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function plainJsonClone<Value>(value: Value): Value {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("Session events must be JSON serializable.");
  }
  return JSON.parse(serialized) as Value;
}

function normalizeSessionEvent(value: unknown, seq?: number): SessionEvent {
  const cloned = plainJsonClone(value);
  if (
    !isRecord(cloned) ||
    typeof cloned.type !== "string" ||
    !cloned.type ||
    !Number.isInteger(seq ?? cloned.seq) ||
    (seq ?? (cloned.seq as number)) < 0 ||
    typeof cloned.time !== "number" ||
    !Number.isFinite(cloned.time) ||
    !Object.hasOwn(cloned, "data")
  ) {
    throw new TypeError("The stored session event is invalid.");
  }
  return {
    ...(cloned as unknown as SessionEvent),
    seq: seq ?? (cloned.seq as number),
  };
}

function storedEvent(value: unknown): SessionEvent | undefined {
  if (!isRecord(value) || value.version !== JOURNAL_VERSION || !("event" in value)) {
    return undefined;
  }
  try {
    return normalizeSessionEvent(value.event);
  } catch {
    return undefined;
  }
}

function storedClientMutation(value: unknown): StoredSessionClientMutation | undefined {
  if (
    !isRecord(value) ||
    value.version !== JOURNAL_VERSION ||
    typeof value.operationId !== "string" ||
    typeof value.messageId !== "string" ||
    !CLIENT_MUTATION_IDENTIFIER.test(value.operationId) ||
    !CLIENT_MUTATION_IDENTIFIER.test(value.messageId)
  ) {
    return undefined;
  }
  return {
    version: JOURNAL_VERSION,
    operationId: value.operationId,
    messageId: value.messageId,
  };
}

function validateClientMutation(identity: SessionClientMutationIdentity): void {
  if (
    !CLIENT_MUTATION_IDENTIFIER.test(identity.operationId) ||
    !CLIENT_MUTATION_IDENTIFIER.test(identity.messageId)
  ) {
    throw new TypeError("Client mutation identifiers must be 1-128 printable ASCII characters.");
  }
}

export function findSessionClientMutation(
  store: SessionEventJournalStore,
  identity: SessionClientMutationIdentity,
): SessionClientMutationLookup {
  validateClientMutation(identity);
  for (const entry of store.getBranch()) {
    if (entry.type !== "custom" || entry.customType !== SESSION_CLIENT_MUTATION_CUSTOM_TYPE) {
      continue;
    }
    const stored = storedClientMutation(entry.data);
    if (!stored) continue;
    if (stored.operationId === identity.operationId && stored.messageId === identity.messageId) {
      return "match";
    }
    if (stored.operationId === identity.operationId || stored.messageId === identity.messageId) {
      return "conflict";
    }
  }
  return "absent";
}

export function appendSessionClientMutation(
  store: SessionEventJournalStore,
  identity: SessionClientMutationIdentity,
): string {
  validateClientMutation(identity);
  return store.appendCustomEntry(SESSION_CLIENT_MUTATION_CUSTOM_TYPE, {
    version: JOURNAL_VERSION,
    operationId: identity.operationId,
    messageId: identity.messageId,
  } satisfies StoredSessionClientMutation);
}

function hasJournalMarker(entries: readonly SessionJournalEntry[]): boolean {
  return entries.some((entry) => {
    if (entry.type !== "custom" || entry.customType !== SESSION_EVENT_JOURNAL_CUSTOM_TYPE) {
      return false;
    }
    const data = entry.data;
    return (
      isRecord(data) &&
      data.version === JOURNAL_VERSION &&
      Number.isInteger(data.legacyMessageCount) &&
      (data.legacyMessageCount as number) >= 0
    );
  });
}

function sameEvent(left: SessionEvent, right: SessionEvent): boolean {
  const { entryId: _leftEntryId, ...leftEvent } = left;
  const { entryId: _rightEntryId, ...rightEvent } = right;
  return JSON.stringify(leftEvent) === JSON.stringify(rightEvent);
}

export function createCanonicalSessionEvent(
  source: { type: string; sequence?: number; [key: string]: unknown },
  seq: number,
  time: number,
): SessionEvent {
  if (!Number.isInteger(seq) || seq < 0) {
    throw new RangeError("Session event sequence must be a non-negative integer.");
  }
  if (!Number.isFinite(time)) throw new RangeError("Session event time must be finite.");

  const cloned = plainJsonClone(source);
  if (!isRecord(cloned) || typeof cloned.type !== "string" || !cloned.type) {
    throw new TypeError("Session event type must be a non-empty string.");
  }
  const { type, sequence: _sequence, ...data } = cloned;
  return normalizeSessionEvent({ type, seq, time, data });
}

export function readSessionEventJournal(store: SessionEventJournalStore): SessionEvent[] {
  const events: SessionEvent[] = [];
  for (const entry of store.getBranch()) {
    if (entry.type !== "custom" || entry.customType !== SESSION_EVENT_CUSTOM_TYPE) continue;
    const event = storedEvent(entry.data);
    // A corrupt, duplicate, or interrupted entry must not shift later sequence numbers.
    if (!event || event.seq !== events.length) continue;
    events.push(entry.id ? { ...event, entryId: entry.id } : event);
  }
  return events;
}

export function appendSessionEventJournal(
  store: SessionEventJournalStore,
  event: SessionEvent,
): SessionEvent {
  const normalized = normalizeSessionEvent(event);
  const { entryId: _entryId, ...persistedEvent } = normalized;
  const data: StoredSessionEvent = { version: JOURNAL_VERSION, event: persistedEvent };
  const entryId = store.appendCustomEntry(SESSION_EVENT_CUSTOM_TYPE, data);
  return { ...normalized, entryId };
}

/**
 * Initializes the durable journal. Legacy messages are copied once, using stable timestamps and
 * sequence numbers supplied by the caller. A missing completion marker is treated as an
 * interrupted migration and resumed from the valid prefix.
 */
export function initializeSessionEventJournal(
  store: SessionEventJournalStore,
  legacyEvents: readonly SessionEvent[],
): SessionEventJournalInitialization {
  const branch = store.getBranch();
  const events = readSessionEventJournal(store);
  if (hasJournalMarker(branch)) return { events };

  let normalizedLegacy: SessionEvent[];
  try {
    normalizedLegacy = legacyEvents.map((event, seq) => normalizeSessionEvent(event, seq));
  } catch (error) {
    return { events, error };
  }

  const existingIsMigrationPrefix = events.every(
    (event, index) => index < normalizedLegacy.length && sameEvent(event, normalizedLegacy[index]!),
  );
  const migrationStart = existingIsMigrationPrefix ? events.length : 0;

  for (let index = migrationStart; index < normalizedLegacy.length; index += 1) {
    const event = normalizeSessionEvent(normalizedLegacy[index], events.length);
    try {
      events.push(appendSessionEventJournal(store, event));
    } catch (error) {
      return { events, error };
    }
  }

  const marker: SessionEventJournalMarker = {
    version: JOURNAL_VERSION,
    legacyMessageCount: normalizedLegacy.length,
  };
  try {
    store.appendCustomEntry(SESSION_EVENT_JOURNAL_CUSTOM_TYPE, marker);
  } catch (error) {
    return { events, error };
  }
  return { events };
}
