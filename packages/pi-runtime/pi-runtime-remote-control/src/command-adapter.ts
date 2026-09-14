import { createHash } from "node:crypto";

import {
  archivePiWorkspaceSession,
  cancelPiRpcSession,
  createPiRpcSession,
  fetchPiRpcSessionHistory,
  listPiArchivedWorkspaceSessions,
  listPiRpcSessions,
  listPiWorkspaces,
  promptPiRpcSession,
  renamePiRpcSession,
  respondPiRpc,
  setPiWorkspaceSessionPinned,
  type PiHttpTransport,
} from "@workbench/pi-rpc-client/api";
import { canonicalJson } from "@workbench/remote-control-contracts/codecs";
import type {
  RemoteCommandV1,
  RemoteConversationPageV1,
  RemoteCursor,
  RemoteOperationResultValueV1,
  RemoteSessionSummaryV1,
} from "@workbench/remote-control-contracts/protocol";

import { projectRemoteConversationPage } from "./conversation-projection.ts";
import { projectRemoteSessionCatalog } from "./session-catalog.ts";
import { projectRemoteWorkspaceCatalog } from "./workspace-projection.ts";

export type RemoteUserStory2Command = Extract<
  RemoteCommandV1,
  { readonly type: "session.send" | "session.stop" | "interaction.answerQuestion" }
>;

export type RemoteCommandAdapterErrorCode =
  | "command_not_available"
  | "interaction_not_pending"
  | "local_rejected"
  | "internal";

export class RemoteCommandAdapterError extends Error {
  readonly code: RemoteCommandAdapterErrorCode;

  constructor(code: RemoteCommandAdapterErrorCode) {
    super(`Remote command failed: ${code}`);
    this.name = "RemoteCommandAdapterError";
    this.code = code;
  }
}

export interface RemoteManagedSessionState {
  readonly sessionId: string;
  readonly title?: string;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly entityRevision: string;
}

export interface RemoteManagedWorkspace {
  readonly workspaceId: string;
  readonly displayName: string;
}

export interface RemoteCommandRuntimePort {
  history(input: {
    readonly sessionId: string;
    readonly beforeSeq?: number;
    readonly maxMessages: number;
  }): Promise<{ readonly events: readonly unknown[]; readonly hasMore: boolean }>;
  prompt(
    input: {
      readonly sessionId: string;
      readonly mode: "queue";
      readonly content: [{ readonly type: "text"; readonly text: string }];
      readonly clientMutation: Readonly<{ operationId: string; messageId: string }>;
    },
    rpcId: string,
  ): Promise<{
    readonly accepted: true;
    readonly queued: boolean;
    readonly messageId?: string;
  }>;
  cancel(input: { readonly sessionId: string }): Promise<{ readonly accepted: true }>;
  answerQuestion(input: {
    readonly type: "client-response";
    readonly rpcId: string;
    readonly result: {
      readonly ok: true;
      readonly value: {
        readonly sessionId: string;
        readonly answer: {
          readonly answers: {
            readonly id: string;
            readonly selected: string[];
            readonly custom?: string;
          }[];
        };
      };
    };
  }): Promise<
    | { readonly accepted: true }
    | { readonly accepted: false; readonly reason: "not-pending" | "bad-response" }
  >;
  listWorkspaces?(): Promise<readonly RemoteManagedWorkspace[]>;
  getSessionState?(sessionId: string): Promise<RemoteManagedSessionState | undefined>;
  createSession?(input: {
    readonly workspaceId?: string;
    readonly requestedSessionId: string;
  }): Promise<{ readonly sessionId: string }>;
  renameSession?(input: {
    readonly sessionId: string;
    readonly title: string;
  }): Promise<RemoteManagedSessionState>;
  setSessionPinned?(input: {
    readonly sessionId: string;
    readonly pinned: boolean;
  }): Promise<RemoteManagedSessionState>;
  archiveSession?(input: { readonly sessionId: string }): Promise<RemoteManagedSessionState>;
  readSessionCatalog?(): Promise<readonly RemoteSessionSummaryV1[]>;
}

function projectionRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function projectedTitle(item: {
  readonly sessionId: string;
  readonly projections?: { readonly values: Readonly<Record<string, unknown>> };
}): string | undefined {
  const projection = projectionRecord(item.projections?.values["workbench.piSessionSummary"]);
  return typeof projection?.name === "string" && projection.name.length > 0
    ? projection.name
    : undefined;
}

function entityRevision(input: {
  readonly sessionId: string;
  readonly title?: string;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly updatedAt: number;
  readonly projectionSeq: number;
}): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

/**
 * Converts the public Pi RPC catalog shapes into the deliberately closed mobile projection.
 * Filesystem paths and every unknown Runtime field are discarded before the generic sanitizer runs.
 */
export function projectPiRpcRemoteSessionCatalog(input: {
  readonly sessionCatalog: Awaited<ReturnType<typeof listPiRpcSessions>>;
  readonly workspaceCatalog: Awaited<ReturnType<typeof listPiWorkspaces>>;
  readonly archivedCatalog: Awaited<ReturnType<typeof listPiArchivedWorkspaceSessions>>;
}): readonly RemoteSessionSummaryV1[] {
  const archived = new Set(input.archivedCatalog.sessionIds);
  const pinned = new Set(input.workspaceCatalog.pinnedSessionIds ?? []);
  const workspaceBySession = new Map<string, (typeof input.workspaceCatalog.items)[number]>();
  for (const workspace of input.workspaceCatalog.items) {
    for (const sessionId of workspace.sessionIds) workspaceBySession.set(sessionId, workspace);
  }
  const workspaces = input.workspaceCatalog.items.map((workspace) => ({
    workspaceId: workspace.workspaceId,
    displayName: workspace.title,
  }));
  const sessions = input.sessionCatalog.items.map((item) => {
    const workspace = workspaceBySession.get(item.sessionId);
    const title = projectedTitle(item);
    const archivedValue = archived.has(item.sessionId);
    const pinnedValue = pinned.has(item.sessionId);
    const updatedAt = new Date(item.updatedAt).toISOString();
    return {
      sessionId: item.sessionId,
      ...(workspace ? { workspaceId: workspace.workspaceId } : {}),
      ...(title === undefined ? {} : { title }),
      updatedAt,
      pinned: pinnedValue,
      archived: archivedValue,
      attention: item.waitingForUserInput ? ("input-needed" as const) : ("none" as const),
      runState: item.waitingForUserInput
        ? ("waiting-for-input" as const)
        : item.running
          ? ("running" as const)
          : ("idle" as const),
      entityRevision: entityRevision({
        sessionId: item.sessionId,
        ...(title === undefined ? {} : { title }),
        pinned: pinnedValue,
        archived: archivedValue,
        updatedAt: item.updatedAt,
        projectionSeq: item.projections?.asOfSeq ?? -1,
      }),
    };
  });
  return projectRemoteSessionCatalog({ sessions, workspaces }).items;
}

export function createPiRpcRemoteCommandRuntime(
  transport: PiHttpTransport,
): RemoteCommandRuntimePort {
  const readCatalogInputs = async () => {
    const [sessionCatalog, workspaceCatalog, archivedCatalog] = await Promise.all([
      listPiRpcSessions({}, { transport }),
      listPiWorkspaces({ transport }),
      listPiArchivedWorkspaceSessions({ transport }),
    ]);
    return { sessionCatalog, workspaceCatalog, archivedCatalog };
  };
  const getSessionState = async (sessionId: string) => {
    const { sessionCatalog, workspaceCatalog, archivedCatalog } = await readCatalogInputs();
    const item = sessionCatalog.items.find((candidate) => candidate.sessionId === sessionId);
    if (!item) return undefined;
    const title = projectedTitle(item);
    const pinned = workspaceCatalog.pinnedSessionIds?.includes(sessionId) === true;
    const archived = archivedCatalog.sessionIds.includes(sessionId);
    return Object.freeze({
      sessionId,
      ...(title === undefined ? {} : { title }),
      pinned,
      archived,
      entityRevision: entityRevision({
        sessionId,
        ...(title === undefined ? {} : { title }),
        pinned,
        archived,
        updatedAt: item.updatedAt,
        projectionSeq: item.projections?.asOfSeq ?? -1,
      }),
    });
  };
  const requireState = async (sessionId: string) => {
    const state = await getSessionState(sessionId);
    if (!state) {
      throw Object.assign(new Error("operation_not_found"), { code: "operation_not_found" });
    }
    return state;
  };
  return {
    history: (input) => fetchPiRpcSessionHistory(input, { transport }),
    prompt: (input, rpcId) => promptPiRpcSession(input, rpcId, { transport }),
    cancel: (input) => cancelPiRpcSession(input, { transport }),
    answerQuestion: (input) => respondPiRpc(input, { transport }),
    async listWorkspaces() {
      const workspaces = await listPiWorkspaces({ transport });
      return projectRemoteWorkspaceCatalog({ workspaces: workspaces.items }).items.map(
        ({ workspaceId, displayName }) => ({ workspaceId, displayName }),
      );
    },
    createSession: (input) =>
      createPiRpcSession(
        {
          ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
          sessionId: input.requestedSessionId,
        },
        { transport },
      ),
    async renameSession(input) {
      await renamePiRpcSession(input, { transport });
      return requireState(input.sessionId);
    },
    async setSessionPinned(input) {
      await setPiWorkspaceSessionPinned(input.sessionId, input.pinned, { transport });
      return requireState(input.sessionId);
    },
    async archiveSession(input) {
      await archivePiWorkspaceSession(input.sessionId, { transport });
      return requireState(input.sessionId);
    },
    getSessionState,
    async readSessionCatalog() {
      return projectPiRpcRemoteSessionCatalog(await readCatalogInputs());
    },
  };
}

function unavailable(command: never): never {
  void command;
  throw new RemoteCommandAdapterError("command_not_available");
}

export function createRemoteCommandAdapter(options: {
  readonly runtime: RemoteCommandRuntimePort;
}) {
  return {
    async readHistory(input: {
      readonly sessionId: string;
      readonly beforeSeq?: number;
      readonly historyCursor: string;
      readonly nextCursor?: string;
      readonly sessionRevision: string;
      readonly projectionCursor: RemoteCursor;
    }): Promise<RemoteConversationPageV1> {
      const history = await options.runtime.history({
        sessionId: input.sessionId,
        ...(input.beforeSeq === undefined ? {} : { beforeSeq: input.beforeSeq }),
        maxMessages: 50,
      });
      return projectRemoteConversationPage({
        sessionId: input.sessionId,
        entries: history.events,
        historyCursor: input.historyCursor,
        ...(input.nextCursor === undefined ? {} : { nextCursor: input.nextCursor }),
        sessionRevision: input.sessionRevision,
        projectionCursor: input.projectionCursor,
      });
    },

    async readRemoteHistory(input: {
      readonly sessionId: string;
      readonly historyCursor?: string;
      readonly projectionCursor: RemoteCursor;
    }): Promise<RemoteConversationPageV1> {
      let beforeSeq: number | undefined;
      if (input.historyCursor !== undefined) {
        const match = /^before-(\d+)$/u.exec(input.historyCursor);
        if (!match) throw new RemoteCommandAdapterError("local_rejected");
        beforeSeq = Number(match[1]);
        if (!Number.isSafeInteger(beforeSeq) || beforeSeq < 1) {
          throw new RemoteCommandAdapterError("local_rejected");
        }
      }
      const [history, state] = await Promise.all([
        options.runtime.history({
          sessionId: input.sessionId,
          ...(beforeSeq === undefined ? {} : { beforeSeq }),
          maxMessages: 50,
        }),
        options.runtime.getSessionState?.(input.sessionId),
      ]);
      if (options.runtime.getSessionState && !state) {
        throw Object.assign(new Error("operation_not_found"), { code: "operation_not_found" });
      }
      const sequences = history.events
        .map((entry) => projectionRecord(entry)?.event)
        .map((event) => projectionRecord(event)?.seq)
        .filter((value): value is number => Number.isSafeInteger(value) && Number(value) > 0);
      const oldest = sequences.length > 0 ? Math.min(...sequences) : undefined;
      const historyCursor = input.historyCursor ?? "latest";
      return projectRemoteConversationPage({
        sessionId: input.sessionId,
        entries: history.events,
        historyCursor,
        ...(history.hasMore && oldest !== undefined ? { nextCursor: `before-${oldest}` } : {}),
        sessionRevision: state?.entityRevision ?? `history-${oldest ?? 0}`,
        projectionCursor: input.projectionCursor,
      });
    },

    getSessionState(sessionId: string): Promise<RemoteManagedSessionState | undefined> {
      if (!options.runtime.getSessionState) {
        throw new RemoteCommandAdapterError("command_not_available");
      }
      return options.runtime.getSessionState(sessionId);
    },

    async execute(input: {
      readonly operationId: string;
      readonly messageId?: string;
      readonly requestedSessionId?: string;
      readonly command: RemoteCommandV1;
    }): Promise<RemoteOperationResultValueV1 | undefined> {
      switch (input.command.type) {
        case "session.send": {
          if (!input.messageId) throw new RemoteCommandAdapterError("local_rejected");
          const admission = await options.runtime.prompt(
            {
              sessionId: input.command.sessionId,
              mode: "queue",
              content: [{ type: "text", text: input.command.text }],
              clientMutation: {
                operationId: input.operationId,
                messageId: input.messageId,
              },
            },
            input.operationId,
          );
          if (admission.messageId !== input.messageId) {
            throw new RemoteCommandAdapterError("local_rejected");
          }
          return {
            type: "message-accepted",
            sessionId: input.command.sessionId,
            messageId: input.messageId,
          };
        }
        case "session.stop":
          await options.runtime.cancel({ sessionId: input.command.sessionId });
          return undefined;
        case "interaction.answerQuestion": {
          const receipt = await options.runtime.answerQuestion({
            type: "client-response",
            rpcId: input.command.interactionId,
            result: {
              ok: true,
              value: {
                sessionId: input.command.sessionId,
                answer: {
                  answers: input.command.answers.map((answer) => ({
                    id: answer.questionId,
                    selected: [...(answer.optionIds ?? [])],
                    ...(answer.text === undefined ? {} : { custom: answer.text }),
                  })),
                },
              },
            },
          });
          if (!receipt.accepted) {
            throw new RemoteCommandAdapterError(
              receipt.reason === "not-pending" ? "interaction_not_pending" : "local_rejected",
            );
          }
          return { type: "interaction-resolved", interactionId: input.command.interactionId };
        }
        case "session.create": {
          const command = input.command;
          if (
            !input.requestedSessionId ||
            !options.runtime.createSession ||
            !options.runtime.listWorkspaces ||
            !options.runtime.renameSession
          ) {
            throw new RemoteCommandAdapterError("command_not_available");
          }
          if (command.workspaceId) {
            const workspaces = await options.runtime.listWorkspaces();
            if (!workspaces.some(({ workspaceId }) => workspaceId === command.workspaceId)) {
              throw new RemoteCommandAdapterError("local_rejected");
            }
          }
          const existing = options.runtime.getSessionState
            ? await options.runtime.getSessionState(input.requestedSessionId)
            : undefined;
          const created =
            existing === undefined
              ? await options.runtime.createSession({
                  ...(command.workspaceId === undefined
                    ? {}
                    : { workspaceId: command.workspaceId }),
                  requestedSessionId: input.requestedSessionId,
                })
              : { sessionId: existing.sessionId };
          if (created.sessionId !== input.requestedSessionId) {
            throw new RemoteCommandAdapterError("local_rejected");
          }
          if (command.title && existing?.title !== command.title) {
            await options.runtime.renameSession({
              sessionId: created.sessionId,
              title: command.title,
            });
          }
          return { type: "session-created", sessionId: created.sessionId };
        }
        case "session.rename": {
          if (!options.runtime.renameSession) {
            throw new RemoteCommandAdapterError("command_not_available");
          }
          const state = await options.runtime.renameSession({
            sessionId: input.command.sessionId,
            title: input.command.title,
          });
          return {
            type: "session-state",
            sessionId: state.sessionId,
            entityRevision: state.entityRevision,
          };
        }
        case "session.setPinned": {
          if (!options.runtime.setSessionPinned) {
            throw new RemoteCommandAdapterError("command_not_available");
          }
          const state = await options.runtime.setSessionPinned({
            sessionId: input.command.sessionId,
            pinned: input.command.pinned,
          });
          return {
            type: "session-state",
            sessionId: state.sessionId,
            entityRevision: state.entityRevision,
          };
        }
        case "session.setArchived": {
          if (!options.runtime.archiveSession) {
            throw new RemoteCommandAdapterError("command_not_available");
          }
          const state = await options.runtime.archiveSession({
            sessionId: input.command.sessionId,
          });
          return {
            type: "session-state",
            sessionId: state.sessionId,
            entityRevision: state.entityRevision,
          };
        }
        default:
          return unavailable(input.command);
      }
    },
  };
}
