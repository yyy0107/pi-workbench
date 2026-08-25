import { realpathSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";

import type { SessionEvent } from "../../rpc-contracts";

const DEFAULT_MAX_COMPLETED_ENTRIES = 8;
const DEFAULT_MAX_COMPLETED_SOURCE_BYTES = 32 * 1024 * 1024;

interface FileFingerprint {
  size: number;
  mtimeMs: number;
}

interface CompletedEntry {
  fingerprint: FileFingerprint;
  sourceBytes: number;
  events: readonly SessionEvent[];
}

interface InFlightEntry {
  canonicalPath: string;
  invalidated: boolean;
  task: Promise<readonly SessionEvent[]>;
}

export interface ColdSessionEventCacheOptions {
  maxCompletedEntries?: number;
  maxCompletedSourceBytes?: number;
}

export type ColdSessionEventLoader = (
  canonicalPath: string,
) => Promise<readonly SessionEvent[]> | readonly SessionEvent[];

function sameFingerprint(left: FileFingerprint, right: FileFingerprint): boolean {
  return left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function fingerprintKey(fingerprint: FileFingerprint): string {
  return `${fingerprint.size}:${fingerprint.mtimeMs}`;
}

function canonicalPathForInvalidation(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

/**
 * A small FIFO cache for completed cold journal projections. In-flight loads are kept separately
 * so an unfinished or failed projection can never consume the completed-cache budget.
 */
export class ColdSessionEventCache {
  private readonly completed = new Map<string, CompletedEntry>();
  private readonly inFlight = new Map<string, InFlightEntry>();
  private readonly maxCompletedEntries: number;
  private readonly maxCompletedSourceBytes: number;
  private completedSourceBytes = 0;

  constructor(options: ColdSessionEventCacheOptions = {}) {
    this.maxCompletedEntries = options.maxCompletedEntries ?? DEFAULT_MAX_COMPLETED_ENTRIES;
    this.maxCompletedSourceBytes =
      options.maxCompletedSourceBytes ?? DEFAULT_MAX_COMPLETED_SOURCE_BYTES;
    if (!Number.isInteger(this.maxCompletedEntries) || this.maxCompletedEntries < 0) {
      throw new RangeError("maxCompletedEntries must be a non-negative integer.");
    }
    if (!Number.isFinite(this.maxCompletedSourceBytes) || this.maxCompletedSourceBytes < 0) {
      throw new RangeError("maxCompletedSourceBytes must be a non-negative number.");
    }
  }

  async load(filePath: string, loadEvents: ColdSessionEventLoader): Promise<SessionEvent[]> {
    const canonicalPath = await realpath(filePath);
    const beforeMetadata = await stat(canonicalPath);
    const before = { size: beforeMetadata.size, mtimeMs: beforeMetadata.mtimeMs };
    const completed = this.completed.get(canonicalPath);
    if (completed && sameFingerprint(completed.fingerprint, before)) {
      return [...completed.events];
    }
    if (completed) this.deleteCompleted(canonicalPath);

    const flightKey = `${canonicalPath}\u0000${fingerprintKey(before)}`;
    let flight = this.inFlight.get(flightKey);
    if (!flight) {
      flight = { canonicalPath, invalidated: false, task: undefined! };
      flight.task = (async () => {
        const events = [...(await loadEvents(canonicalPath))];
        const afterMetadata = await stat(canonicalPath);
        const after = { size: afterMetadata.size, mtimeMs: afterMetadata.mtimeMs };
        if (!flight.invalidated && sameFingerprint(before, after)) {
          this.storeCompleted(canonicalPath, after, events);
        }
        return events;
      })().finally(() => {
        if (this.inFlight.get(flightKey) === flight) this.inFlight.delete(flightKey);
      });
      this.inFlight.set(flightKey, flight);
    }
    return [...(await flight.task)];
  }

  invalidate(filePath: string): void {
    const canonicalPath = canonicalPathForInvalidation(filePath);
    this.deleteCompleted(canonicalPath);
    for (const flight of this.inFlight.values()) {
      if (flight.canonicalPath === canonicalPath) flight.invalidated = true;
    }
  }

  clear(): void {
    this.completed.clear();
    this.completedSourceBytes = 0;
    for (const flight of this.inFlight.values()) flight.invalidated = true;
  }

  private storeCompleted(
    canonicalPath: string,
    fingerprint: FileFingerprint,
    events: readonly SessionEvent[],
  ): void {
    this.deleteCompleted(canonicalPath);
    if (this.maxCompletedEntries === 0 || fingerprint.size > this.maxCompletedSourceBytes) {
      return;
    }
    while (
      this.completed.size >= this.maxCompletedEntries ||
      this.completedSourceBytes + fingerprint.size > this.maxCompletedSourceBytes
    ) {
      const oldestPath = this.completed.keys().next().value as string | undefined;
      if (oldestPath === undefined) return;
      this.deleteCompleted(oldestPath);
    }
    this.completed.set(canonicalPath, {
      fingerprint,
      sourceBytes: fingerprint.size,
      events,
    });
    this.completedSourceBytes += fingerprint.size;
  }

  private deleteCompleted(canonicalPath: string): void {
    const existing = this.completed.get(canonicalPath);
    if (!existing) return;
    this.completed.delete(canonicalPath);
    this.completedSourceBytes -= existing.sourceBytes;
  }
}
