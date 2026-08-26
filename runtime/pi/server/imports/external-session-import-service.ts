import { SessionManager } from "@earendil-works/pi-coding-agent";

import type {
  ExternalSessionImportIssue,
  ExternalSessionScanSnapshot,
  ExternalSessionSource,
  ExternalSessionSourceAdapter,
  ExternalSessionSourceSnapshot,
} from "./external-session-types";
import { ClaudeCodeSessionAdapter } from "./claude-code-session-adapter";
import { CodexSessionAdapter } from "./codex-session-adapter";
import { CursorSessionAdapter } from "./cursor-session-adapter";
import { hasAssistantMessage, importedSessionId, workspaceIssue } from "./source-utils";
import { registerImportedSessionManager } from "../sessions/session-registry";
import { getWorkspaceStore } from "../workspaces/workspace-registry";

export interface ExternalSessionImportSelection {
  source: ExternalSessionSource;
  sourceSessionId: string;
}

export type ExternalSessionImportSkipReason =
  | ExternalSessionImportIssue
  | "already-imported"
  | "source-session-not-found"
  | "import-failed";

export interface ExternalSessionImportResult {
  imported: Array<{
    source: ExternalSessionSource;
    sourceSessionId: string;
    sessionId: string;
    workspaceId: string;
  }>;
  skipped: Array<{
    source: ExternalSessionSource;
    sourceSessionId: string;
    reason: ExternalSessionImportSkipReason;
  }>;
}

const MAX_IMPORT_SELECTIONS = 200;

export class ExternalSessionImportService {
  private readonly adapters: ReadonlyMap<ExternalSessionSource, ExternalSessionSourceAdapter>;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(
    adapters: readonly ExternalSessionSourceAdapter[] = [
      new CodexSessionAdapter(),
      new ClaudeCodeSessionAdapter(),
      new CursorSessionAdapter(),
    ],
  ) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.source, adapter]));
  }

  private async sourceSnapshot(
    adapter: ExternalSessionSourceAdapter,
  ): Promise<ExternalSessionSourceSnapshot> {
    try {
      return await adapter.scan();
    } catch (error) {
      console.error(`[workbench-pi] Failed to scan ${adapter.source} sessions.`, error);
      return { source: adapter.source, status: "error", sessions: [] };
    }
  }

  async scan(): Promise<ExternalSessionScanSnapshot> {
    const [sources, persisted] = await Promise.all([
      Promise.all([...this.adapters.values()].map((adapter) => this.sourceSnapshot(adapter))),
      SessionManager.listAll(),
    ]);
    const existing = new Set(persisted.map((session) => session.id));
    return {
      sources: sources.map((snapshot) => ({
        ...snapshot,
        sessions: snapshot.sessions.map((session) => {
          const alreadyImported = existing.has(
            importedSessionId(session.source, session.sourceSessionId),
          );
          return {
            ...session,
            alreadyImported,
            importable: session.importable && !alreadyImported,
            ...(alreadyImported ? { issue: undefined } : {}),
          };
        }),
      })),
    };
  }

  import(
    selections: readonly ExternalSessionImportSelection[],
  ): Promise<ExternalSessionImportResult> {
    const operation = this.mutationTail
      .catch(() => undefined)
      .then(() => this.importNow(selections));
    this.mutationTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async importNow(
    selections: readonly ExternalSessionImportSelection[],
  ): Promise<ExternalSessionImportResult> {
    if (selections.length > MAX_IMPORT_SELECTIONS) {
      throw new RangeError(`At most ${MAX_IMPORT_SELECTIONS} sessions can be imported at once.`);
    }
    const snapshot = await this.scan();
    const descriptors = new Map(
      snapshot.sources.flatMap((source) =>
        source.sessions.map(
          (session) => [`${session.source}\0${session.sourceSessionId}`, session] as const,
        ),
      ),
    );
    const imported: ExternalSessionImportResult["imported"] = [];
    const skipped: ExternalSessionImportResult["skipped"] = [];

    for (const selection of selections) {
      const descriptor = descriptors.get(`${selection.source}\0${selection.sourceSessionId}`);
      if (!descriptor) {
        skipped.push({ ...selection, reason: "source-session-not-found" });
        continue;
      }
      if (descriptor.alreadyImported) {
        skipped.push({ ...selection, reason: "already-imported" });
        continue;
      }
      if (!descriptor.importable) {
        skipped.push({ ...selection, reason: descriptor.issue ?? "conversation-unsupported" });
        continue;
      }
      const adapter = this.adapters.get(selection.source);
      if (!adapter) {
        skipped.push({ ...selection, reason: "source-unavailable" });
        continue;
      }
      try {
        const loaded = await adapter.load(selection.sourceSessionId);
        if (!loaded) {
          skipped.push({ ...selection, reason: "source-session-not-found" });
          continue;
        }
        const currentWorkspaceIssue = await workspaceIssue(loaded.descriptor.cwd);
        if (currentWorkspaceIssue) {
          skipped.push({ ...selection, reason: currentWorkspaceIssue });
          continue;
        }
        if (loaded.messages.length === 0 || !hasAssistantMessage(loaded.messages)) {
          skipped.push({ ...selection, reason: "conversation-empty" });
          continue;
        }
        const sessionId = importedSessionId(selection.source, selection.sourceSessionId);
        const manager = SessionManager.create(loaded.descriptor.cwd, undefined, { id: sessionId });
        if (loaded.model) manager.appendModelChange(loaded.model.provider, loaded.model.modelId);
        for (const message of loaded.messages) manager.appendMessage(message);
        manager.appendCustomEntry("workbench.external-session-import.v1", {
          version: 1,
          source: selection.source,
          sourceSessionId: selection.sourceSessionId,
          importedAt: new Date().toISOString(),
        });
        manager.appendSessionInfo(loaded.descriptor.title);
        registerImportedSessionManager(manager);
        const workspaceStore = getWorkspaceStore();
        const workspace = await workspaceStore.create({ path: loaded.descriptor.cwd });
        await workspaceStore.attachSession(workspace.workspace.workspaceId, sessionId);
        imported.push({
          ...selection,
          sessionId,
          workspaceId: workspace.workspace.workspaceId,
        });
      } catch (error) {
        console.error(
          `[workbench-pi] Failed to import ${selection.source} session ${selection.sourceSessionId}.`,
          error,
        );
        skipped.push({ ...selection, reason: "import-failed" });
      }
    }
    return { imported, skipped };
  }
}

let service: ExternalSessionImportService | undefined;

export function getExternalSessionImportService(): ExternalSessionImportService {
  service ??= new ExternalSessionImportService();
  return service;
}
