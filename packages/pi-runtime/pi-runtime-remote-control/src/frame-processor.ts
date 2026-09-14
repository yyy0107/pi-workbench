import {
  parseRemoteControlRequestV1,
  parseRemoteControlResponseV1,
  parseRemoteOperationRequestV1,
  parseRemoteOperationResultV1,
  remoteUtf8ByteLength,
} from "@workbench/remote-control-contracts/codecs";
import type {
  RemoteAction,
  RemoteControlRequestV1,
  RemoteControlResponseV1,
  RemoteControlResponseValueV1,
  RemoteErrorCodeV1,
  RemoteEventPayloadV1,
  RemoteEventV1,
  RemoteOperationRequestV1,
  RemoteOperationResultV1,
  RemoteSealedContentType,
  RemoteSessionSummaryV1,
} from "@workbench/remote-control-contracts/protocol";

import type { createRemoteCommandAdapter } from "./command-adapter.ts";
import { projectRemoteConversationPage } from "./conversation-projection.ts";
import type { createRemoteOperationLedger } from "./operation-ledger.ts";
import { createRemoteOperationService } from "./operation-service.ts";
import { createRemoteProjection } from "./projection.ts";
import { createRemoteSnapshotService } from "./snapshot-service.ts";

type RemoteCommandAdapter = ReturnType<typeof createRemoteCommandAdapter>;
type RemoteOperationLedger = ReturnType<typeof createRemoteOperationLedger>;

const MAXIMUM_REPLAY_EVENTS = 1_000;

const ERROR_CODES = new Set<RemoteErrorCodeV1>([
  "authentication_failed",
  "authorization_revision_changed",
  "protocol_version_mismatch",
  "device_not_paired",
  "device_revoked",
  "scope_denied",
  "machine_offline",
  "machine_lease_changed",
  "operation_expired",
  "operation_id_conflict",
  "operation_not_found",
  "entity_revision_conflict",
  "interaction_not_pending",
  "interaction_expired",
  "cursor_expired",
  "cursor_gap",
  "epoch_changed",
  "snapshot_required",
  "payload_too_large",
  "rate_limited",
  "slow_consumer",
  "invalid_frame",
  "internal",
]);

function errorCode(error: unknown): RemoteErrorCodeV1 {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { readonly code?: unknown }).code;
    if (typeof code === "string" && ERROR_CODES.has(code as RemoteErrorCodeV1)) {
      return code as RemoteErrorCodeV1;
    }
  }
  if (error instanceof Error && ERROR_CODES.has(error.message as RemoteErrorCodeV1)) {
    return error.message as RemoteErrorCodeV1;
  }
  return "internal";
}

function operationResult(
  operationId: string,
  state: RemoteOperationResultV1["state"],
  code?: RemoteErrorCodeV1,
): RemoteOperationResultV1 {
  const value: RemoteOperationResultV1 = {
    type: "operation.result",
    operationId,
    state,
    ...(code === undefined ? {} : { code }),
  };
  if (!parseRemoteOperationResultV1(value)) throw new Error("operation_result_invalid");
  return Object.freeze(value);
}

function sameSession(left: RemoteSessionSummaryV1, right: RemoteSessionSummaryV1): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export interface DesktopRemoteFrameProcessorOptions {
  readonly machineId: string;
  readonly epoch: string;
  readonly clock: { now(): Date };
  readonly id: () => string;
  readonly authorizations: {
    get(deviceId: string):
      | {
          readonly deviceId: string;
          readonly allowedActions: readonly RemoteAction[];
          readonly state: "active" | "revoked";
          readonly revision: string;
        }
      | undefined;
    authorize(input: { readonly deviceId: string; readonly action: RemoteAction }): {
      readonly deviceId: string;
      readonly allowedActions: readonly RemoteAction[];
      readonly state: "active" | "revoked";
      readonly revision: string;
    };
    list(): readonly {
      readonly deviceId: string;
      readonly allowedActions: readonly RemoteAction[];
      readonly state: "active" | "revoked";
      readonly revision: string;
    }[];
  };
  readonly ledger: RemoteOperationLedger;
  readonly commands: RemoteCommandAdapter;
  readonly readSessionCatalog: () => Promise<readonly RemoteSessionSummaryV1[]>;
  readonly onOperationAccepted?: (request: RemoteOperationRequestV1) => void | Promise<void>;
  readonly sendPlaintext: (
    deviceId: string,
    contentType: RemoteSealedContentType,
    plaintext: object,
  ) => void | Promise<void>;
}

export function createDesktopRemoteFrameProcessor(options: DesktopRemoteFrameProcessorOptions) {
  const projection = createRemoteProjection({
    epoch: options.epoch,
    clock: options.clock,
    id: options.id,
  });
  let initialized = false;
  let catalogRefresh: Promise<readonly RemoteSessionSummaryV1[]> | undefined;

  const currentAuthorization = (deviceId: string) => {
    const authorization = options.authorizations.get(deviceId);
    if (!authorization)
      throw Object.assign(new Error("device_not_paired"), { code: "device_not_paired" });
    if (authorization.state !== "active") {
      throw Object.assign(new Error("device_revoked"), { code: "device_revoked" });
    }
    return authorization;
  };

  const authority = (deviceId: string, action?: RemoteAction) => {
    const authorization =
      action === undefined
        ? currentAuthorization(deviceId)
        : options.authorizations.authorize({ deviceId, action });
    return Object.freeze({
      machineId: options.machineId,
      deviceId,
      authorizationRevision: authorization.revision,
    });
  };

  const reauthorize = (input: ReturnType<typeof authority>, action: RemoteAction) => {
    if (input.machineId !== options.machineId) {
      throw Object.assign(new Error("scope_denied"), { code: "scope_denied" });
    }
    const authorization = options.authorizations.authorize({
      deviceId: input.deviceId,
      action,
    });
    if (authorization.revision !== input.authorizationRevision) {
      throw Object.assign(new Error("authorization_revision_changed"), {
        code: "authorization_revision_changed",
      });
    }
  };

  const sendToDevice = async (
    deviceId: string,
    contentType: RemoteSealedContentType,
    plaintext: object,
  ): Promise<void> => {
    currentAuthorization(deviceId);
    await options.sendPlaintext(deviceId, contentType, plaintext);
  };

  const broadcastEvent = async (event: RemoteEventV1): Promise<void> => {
    snapshot.buffer(event);
    const recipients = options.authorizations
      .list()
      .filter(
        (authorization) =>
          authorization.state === "active" &&
          authorization.allowedActions.includes("sessions.read"),
      );
    await Promise.allSettled(
      recipients.map((authorization) => sendToDevice(authorization.deviceId, "event", event)),
    );
  };

  const synchronizeCatalog = async (publishChanges: boolean) => {
    if (catalogRefresh) return catalogRefresh;
    catalogRefresh = (async () => {
      const next = Object.freeze([...(await options.readSessionCatalog())]);
      const current = projection.snapshot().sessions;
      if (!initialized) {
        projection.replaceSnapshot(next);
        initialized = true;
        return next;
      }
      const currentById = new Map(current.map((session) => [session.sessionId, session]));
      const nextById = new Map(next.map((session) => [session.sessionId, session]));
      if (!publishChanges) {
        projection.replaceSnapshot(next);
        return next;
      }
      for (const session of next) {
        const previous = currentById.get(session.sessionId);
        if (!previous || !sameSession(previous, session)) {
          await broadcastEvent(projection.upsertSession(session));
        }
      }
      for (const session of current) {
        if (!nextById.has(session.sessionId)) {
          await broadcastEvent(projection.removeSession(session.sessionId));
        }
      }
      return projection.snapshot().sessions;
    })().finally(() => {
      catalogRefresh = undefined;
    });
    return catalogRefresh;
  };

  const snapshot = createRemoteSnapshotService({
    id: options.id,
    currentCursor: projection.currentCursor,
    readSessions: () => synchronizeCatalog(true),
  });

  const operationService = createRemoteOperationService({
    clock: options.clock,
    ledger: options.ledger,
    authorization: {
      authorize: ({ authority: value, action }) => reauthorize(value, action),
    },
    interactions: {
      async get(interactionId) {
        for (const session of projection.snapshot().sessions) {
          const page = await options.commands
            .readRemoteHistory({
              sessionId: session.sessionId,
              projectionCursor: projection.currentCursor(),
            })
            .catch(() => undefined);
          const interaction = page?.items.find(
            (item) => item.type === "ordinary-question" && item.interactionId === interactionId,
          );
          if (interaction?.type === "ordinary-question") return interaction;
        }
        return undefined;
      },
    },
    commands: options.commands,
    publisher: {
      publish: ({ deviceId, result }) => sendToDevice(deviceId, "result", result),
    },
    observer: {
      accepted: ({ request }) => options.onOperationAccepted?.(request),
    },
    currentCursor: projection.currentCursor,
  });

  const sendControlResponse = (
    deviceId: string,
    requestId: string,
    response:
      | { readonly value: RemoteControlResponseValueV1 }
      | { readonly error: RemoteErrorCodeV1 },
  ) => {
    const value: RemoteControlResponseV1 =
      "value" in response
        ? { type: "control.response", requestId, value: response.value }
        : {
            type: "control.response",
            requestId,
            error: { type: "remote.error", version: 1, code: response.error },
          };
    if (!parseRemoteControlResponseV1(value)) throw new Error("control_response_invalid");
    return sendToDevice(deviceId, "result", value);
  };

  const statusResults = async (deviceId: string, operationIds: readonly string[]) =>
    Promise.all(
      operationIds.map(async (operationId) => {
        const record = await options.ledger.get({ deviceId, operationId });
        return (
          record?.result ??
          operationResult(
            operationId,
            record?.state ?? "rejected",
            record ? undefined : "operation_not_found",
          )
        );
      }),
    );

  const processControl = async (deviceId: string, request: RemoteControlRequestV1) => {
    const readAuthority = authority(deviceId, "sessions.read");
    if (options.clock.now().getTime() >= Date.parse(request.expiresAt)) {
      throw Object.assign(new Error("operation_expired"), { code: "operation_expired" });
    }
    switch (request.query.type) {
      case "session.catalog.read": {
        const sessions = await synchronizeCatalog(true);
        reauthorize(readAuthority, "sessions.read");
        await sendControlResponse(deviceId, request.requestId, {
          value: {
            type: "session.catalog",
            sessions,
            projectionCursor: projection.currentCursor(),
          },
        });
        return;
      }
      case "conversation.history.read": {
        const page = await options.commands.readRemoteHistory({
          sessionId: request.query.sessionId,
          ...(request.query.historyCursor === undefined
            ? {}
            : { historyCursor: request.query.historyCursor }),
          projectionCursor: projection.currentCursor(),
        });
        reauthorize(readAuthority, "sessions.read");
        await sendControlResponse(deviceId, request.requestId, {
          value: { type: "conversation.history", page },
        });
        return;
      }
      case "operations.status": {
        const results = await statusResults(deviceId, request.query.operationIds);
        reauthorize(readAuthority, "sessions.read");
        await sendControlResponse(deviceId, request.requestId, {
          value: { type: "operations.status", results },
        });
        return;
      }
      case "sync.recover": {
        for (const result of await statusResults(deviceId, request.query.unresolvedOperationIds)) {
          await sendToDevice(deviceId, "result", result);
        }
        const replay = request.query.cursor
          ? projection.replayAfter(request.query.cursor)
          : undefined;
        if (
          replay?.kind === "events" &&
          replay.events.length <= MAXIMUM_REPLAY_EVENTS &&
          remoteUtf8ByteLength(JSON.stringify(replay.events)) <= 192 * 1024
        ) {
          reauthorize(readAuthority, "sessions.read");
          await sendControlResponse(deviceId, request.requestId, {
            value: {
              type: "sync.replay",
              events: replay.events,
              currentCursor: replay.currentCursor,
            },
          });
          return;
        }
        const created = await snapshot.create();
        reauthorize(readAuthority, "sessions.read");
        await sendControlResponse(deviceId, request.requestId, {
          value: { type: "sync.snapshot", snapshotId: created.complete.snapshotId },
        });
        for (const chunk of created.chunks) {
          await sendToDevice(deviceId, "snapshot-chunk", chunk);
        }
        await sendToDevice(deviceId, "event", created.complete);
        for (const event of created.replay) await sendToDevice(deviceId, "event", event);
      }
    }
  };

  return {
    currentCursor: projection.currentCursor,
    snapshot: projection.snapshot,
    initialize: () => synchronizeCatalog(false),
    refreshCatalog: () => synchronizeCatalog(true),
    async publishEvent(payload: RemoteEventPayloadV1): Promise<RemoteEventV1> {
      const event = projection.appendEvent(payload);
      await broadcastEvent(event);
      return event;
    },
    async publishRunState(
      sessionId: string,
      runState: RemoteSessionSummaryV1["runState"],
    ): Promise<RemoteEventV1 | undefined> {
      if (!projection.snapshot().sessions.some((session) => session.sessionId === sessionId)) {
        await synchronizeCatalog(true);
      }
      if (!projection.snapshot().sessions.some((session) => session.sessionId === sessionId)) {
        return undefined;
      }
      const event = projection.changeRunState(sessionId, runState);
      await broadcastEvent(event);
      return event;
    },
    async publishConversationEntries(
      sessionId: string,
      entries: readonly unknown[],
    ): Promise<readonly RemoteEventV1[]> {
      const state = await options.commands.getSessionState(sessionId);
      if (!state) return Object.freeze([]);
      const marker = options.id();
      const page = projectRemoteConversationPage({
        sessionId,
        entries,
        historyCursor: marker,
        sessionRevision: state.entityRevision,
        projectionCursor: projection.currentCursor(),
      });
      const events: RemoteEventV1[] = [];
      for (const item of page.items) {
        const event = projection.appendEvent(
          item.type === "ordinary-question"
            ? { type: "interaction.upserted", interaction: item }
            : { type: "session.messageAppended", sessionId, item },
        );
        await broadcastEvent(event);
        events.push(event);
      }
      return Object.freeze(events);
    },
    async receivePlaintext(deviceId: string, plaintext: unknown): Promise<void> {
      currentAuthorization(deviceId);
      const operation = parseRemoteOperationRequestV1(plaintext);
      if (operation) {
        try {
          await operationService.execute({
            authority: authority(deviceId),
            request: operation,
          });
          await synchronizeCatalog(true);
        } catch (error) {
          await sendToDevice(
            deviceId,
            "result",
            operationResult(operation.operationId, "rejected", errorCode(error)),
          );
        }
        return;
      }
      const control = parseRemoteControlRequestV1(plaintext);
      if (!control) throw Object.assign(new Error("invalid_frame"), { code: "invalid_frame" });
      try {
        await processControl(deviceId, control);
      } catch (error) {
        await sendControlResponse(deviceId, control.requestId, {
          error: errorCode(error),
        });
      }
    },
  };
}
