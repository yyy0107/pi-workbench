import { SessionManager } from "@earendil-works/pi-coding-agent";

import type {
  ExternalSessionImportPayload,
  ExternalSessionImportValue,
  ExternalSessionSource,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import type {
  ExternalSessionScanSnapshot,
  ExternalSessionImporter,
  ExternalSessionSourceSnapshot,
} from "./external-session-types";
import { ClaudeCodeSessionImporter } from "./claude-code-session-importer";
import { CodexSessionImporter } from "./codex-session-importer";
import { CursorSessionImporter } from "./cursor-session-importer";
import { hasAssistantMessage, importedSessionId, workspaceIssue } from "./source-utils";
import { registerImportedSessionManager } from "../sessions/session-registry";
import { getWorkspaceStore } from "../workspaces/workspace-registry";

export type ExternalSessionImportSelection = ExternalSessionImportPayload["sessions"][number];

export type ExternalSessionImportSkipReason =
  ExternalSessionImportValue["skipped"][number]["reason"];

export type ExternalSessionImportResult = ExternalSessionImportValue;

const MAX_IMPORT_SELECTIONS = 200;

export class ExternalSessionImportService {
  private readonly importers: ReadonlyMap<ExternalSessionSource, ExternalSessionImporter>;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(
    importers: readonly ExternalSessionImporter[] = [
      new CodexSessionImporter(),
      new ClaudeCodeSessionImporter(),
      new CursorSessionImporter(),
    ],
  ) {
    this.importers = new Map(importers.map((importer) => [importer.source, importer]));
  }

  private async sourceSnapshot(
    importer: ExternalSessionImporter,
  ): Promise<ExternalSessionSourceSnapshot> {
    try {
      return await importer.scan();
    } catch (error) {
      console.error(`[workbench-pi] Failed to scan ${importer.source} sessions.`, error);
      return { source: importer.source, status: "error", sessions: [] };
    }
  }

  async scan(): Promise<ExternalSessionScanSnapshot> {
    const [sources, persisted] = await Promise.all([
      Promise.all([...this.importers.values()].map((importer) => this.sourceSnapshot(importer))),
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
      const importer = this.importers.get(selection.source);
      if (!importer) {
        skipped.push({ ...selection, reason: "source-unavailable" });
        continue;
      }
      try {
        const loaded = await importer.load(selection.sourceSessionId);
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

export type ExternalSessionImportProtocol = Pick<ExternalSessionImportService, "scan" | "import">;

let service: ExternalSessionImportService | undefined;

export function getExternalSessionImportService(): ExternalSessionImportService {
  service ??= new ExternalSessionImportService();
  return service;
}
