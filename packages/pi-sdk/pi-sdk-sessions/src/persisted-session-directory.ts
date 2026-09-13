import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import type { PiSessionSummary } from "@workbench/pi-rpc-contracts/messages";

import type { PersistedSessionRegistryState } from "./session-registry-state";

/** Owns mutations and coherent snapshots of the cold Pi JSONL session directory. */
export class PersistedSessionDirectory {
  private readonly state: PersistedSessionRegistryState;

  constructor(state: PersistedSessionRegistryState) {
    this.state = state;
  }

  info(id: string): SessionInfo | undefined {
    return this.state.sessions.get(id);
  }

  cache(info: SessionInfo | undefined, summary: PiSessionSummary): void {
    this.state.summaries.set(summary.id, summary);
    if (info) this.state.sessions.set(info.id, info);
  }

  remove(id: string): SessionInfo | undefined {
    return this.state.remove(id);
  }
}
