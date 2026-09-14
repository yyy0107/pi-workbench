import {
  parseRemoteOperationRequestV1,
  parseRemoteOperationResultV1,
} from "@workbench/remote-control-contracts/codecs";
import type {
  RemoteAction,
  RemoteCommandV1,
  RemoteErrorCodeV1,
  RemoteOperationRequestV1,
  RemoteOperationResultV1,
} from "@workbench/remote-control-contracts/protocol";

import {
  createRemoteOperationLedger,
  type RemoteOperationDomainIdentity,
  type RemoteOperationLedgerRecord,
} from "./operation-ledger.ts";
import { RemoteCommandAdapterError, type createRemoteCommandAdapter } from "./command-adapter.ts";

type RemoteOperationLedger = ReturnType<typeof createRemoteOperationLedger>;
type RemoteCommandAdapter = ReturnType<typeof createRemoteCommandAdapter>;

export interface DesktopRemoteOperationAuthority {
  readonly machineId: string;
  readonly deviceId: string;
  readonly authorizationRevision: string;
}

export interface PendingRemoteOrdinaryInteraction {
  readonly interactionId: string;
  readonly sessionId: string;
  readonly revision: string;
  readonly expiresAt: string;
}

export interface RemoteOperationAuthorizationPort {
  authorize(input: {
    readonly authority: DesktopRemoteOperationAuthority;
    readonly action: RemoteAction;
  }): void | Promise<void>;
}

export interface RemoteOperationInteractionPort {
  get(
    interactionId: string,
  ):
    | PendingRemoteOrdinaryInteraction
    | undefined
    | Promise<PendingRemoteOrdinaryInteraction | undefined>;
}

export interface RemoteOperationResultPublisherPort {
  /** The owner must seal this closed result before writing it to the paired-device connection. */
  publish(input: {
    readonly deviceId: string;
    readonly result: RemoteOperationResultV1;
  }): void | Promise<void>;
}

export interface RemoteOperationObserverPort {
  accepted(input: {
    readonly deviceId: string;
    readonly request: RemoteOperationRequestV1;
  }): void | Promise<void>;
}

const REMOTE_ERROR_CODES: ReadonlySet<RemoteErrorCodeV1> = new Set([
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

function commandAction(command: RemoteCommandV1): RemoteAction {
  switch (command.type) {
    case "session.create":
      return "sessions.create";
    case "session.send":
      return "sessions.send";
    case "session.stop":
      return "sessions.stop";
    case "session.rename":
    case "session.setPinned":
    case "session.setArchived":
      return "sessions.organize";
    case "interaction.answerQuestion":
      return "interactions.respond";
  }
}

function domainIdentity(
  request: RemoteOperationRequestV1,
): RemoteOperationDomainIdentity | undefined {
  switch (request.command.type) {
    case "session.send":
      return {
        type: "message",
        sessionId: request.command.sessionId,
        messageId: request.operationId,
      };
    case "session.stop":
    case "session.rename":
    case "session.setPinned":
    case "session.setArchived":
      return { type: "session", sessionId: request.command.sessionId };
    case "interaction.answerQuestion":
      return { type: "interaction", interactionId: request.command.interactionId };
    case "session.create":
      return { type: "session", sessionId: request.operationId };
  }
}

type RemoteOrganizationCommand = Extract<
  RemoteCommandV1,
  {
    readonly type: "session.rename" | "session.setPinned" | "session.setArchived";
  }
>;

function isOrganizationCommand(command: RemoteCommandV1): command is RemoteOrganizationCommand {
  return (
    command.type === "session.rename" ||
    command.type === "session.setPinned" ||
    command.type === "session.setArchived"
  );
}

function hasRequestedState(
  state: Awaited<ReturnType<RemoteCommandAdapter["getSessionState"]>>,
  command: RemoteOrganizationCommand,
): boolean {
  if (!state) return false;
  switch (command.type) {
    case "session.rename":
      return state.title === command.title;
    case "session.setPinned":
      return state.pinned === command.pinned;
    case "session.setArchived":
      return state.archived;
  }
}

function errorCode(error: unknown): RemoteErrorCodeV1 {
  if (error instanceof RemoteCommandAdapterError) {
    if (error.code === "interaction_not_pending") return "interaction_not_pending";
    if (error.code === "command_not_available") return "scope_denied";
    return "internal";
  }
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && REMOTE_ERROR_CODES.has(code as RemoteErrorCodeV1)) {
      return code as RemoteErrorCodeV1;
    }
  }
  if (error instanceof Error && REMOTE_ERROR_CODES.has(error.message as RemoteErrorCodeV1)) {
    return error.message as RemoteErrorCodeV1;
  }
  return "internal";
}

function result(
  operationId: string,
  state: RemoteOperationResultV1["state"],
  options: Omit<RemoteOperationResultV1, "type" | "operationId" | "state"> = {},
): RemoteOperationResultV1 {
  const candidate = { type: "operation.result" as const, operationId, state, ...options };
  if (!parseRemoteOperationResultV1(candidate)) throw new Error("operation_result_invalid");
  return candidate;
}

export function createRemoteOperationService(options: {
  readonly clock: { now(): Date };
  readonly ledger: RemoteOperationLedger;
  readonly authorization: RemoteOperationAuthorizationPort;
  readonly interactions: RemoteOperationInteractionPort;
  readonly commands: RemoteCommandAdapter;
  readonly publisher: RemoteOperationResultPublisherPort;
  readonly observer?: RemoteOperationObserverPort;
  readonly currentCursor?: () =>
    | import("@workbench/remote-control-contracts/protocol").RemoteCursor
    | undefined;
  readonly reconcile?: (
    record: RemoteOperationLedgerRecord,
  ) => Promise<RemoteOperationResultV1 | undefined>;
}) {
  const sessionMutationTails = new Map<string, Promise<void>>();
  const publish = async (deviceId: string, value: RemoteOperationResultV1) => {
    await options.publisher.publish({ deviceId, result: value });
    return value;
  };

  const terminal = async (
    deviceId: string,
    operationId: string,
    value: RemoteOperationResultV1,
  ) => {
    await options.ledger.finish({ deviceId, operationId, result: value });
    return publish(deviceId, value);
  };

  const requireCurrentInteraction = async (
    command: Extract<RemoteCommandV1, { type: "interaction.answerQuestion" }>,
  ) => {
    const pending = await options.interactions.get(command.interactionId);
    if (
      !pending ||
      pending.sessionId !== command.sessionId ||
      pending.revision !== command.interactionRevision
    ) {
      throw Object.assign(new Error("interaction_not_pending"), {
        code: "interaction_not_pending",
      });
    }
    if (options.clock.now().getTime() >= Date.parse(pending.expiresAt)) {
      throw Object.assign(new Error("interaction_expired"), { code: "interaction_expired" });
    }
  };

  const serializeSessionMutation = async <T>(
    sessionId: string,
    operation: () => Promise<T>,
  ): Promise<T> => {
    const previous = sessionMutationTails.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    sessionMutationTails.set(sessionId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (sessionMutationTails.get(sessionId) === tail) sessionMutationTails.delete(sessionId);
    }
  };

  const execute = async (input: {
    readonly authority: DesktopRemoteOperationAuthority;
    readonly request: RemoteOperationRequestV1;
  }): Promise<RemoteOperationResultV1> => {
    if (!parseRemoteOperationRequestV1(input.request)) {
      throw Object.assign(new Error("invalid_frame"), { code: "invalid_frame" });
    }
    const action = commandAction(input.request.command);
    await options.authorization.authorize({ authority: input.authority, action });

    const identity = domainIdentity(input.request);
    const begun = await options.ledger.begin({
      deviceId: input.authority.deviceId,
      request: input.request,
      ...(identity === undefined ? {} : { domainIdentity: identity }),
    });
    if (begun.kind === "conflict") {
      return publish(
        input.authority.deviceId,
        result(input.request.operationId, "rejected", { code: begun.code }),
      );
    }
    if (begun.kind === "replay") {
      return publish(
        input.authority.deviceId,
        begun.record.result ?? result(input.request.operationId, "accepted"),
      );
    }

    if (options.clock.now().getTime() >= Date.parse(input.request.expiresAt)) {
      return terminal(
        input.authority.deviceId,
        input.request.operationId,
        result(input.request.operationId, "expired", { code: "operation_expired" }),
      );
    }

    if (input.request.command.type === "interaction.answerQuestion") {
      try {
        await requireCurrentInteraction(input.request.command);
      } catch (error) {
        const code = errorCode(error);
        return terminal(
          input.authority.deviceId,
          input.request.operationId,
          result(input.request.operationId, "rejected", { code }),
        );
      }
    }

    if (isOrganizationCommand(input.request.command)) {
      const state = await options.commands.getSessionState(input.request.command.sessionId);
      if (!state) {
        return terminal(
          input.authority.deviceId,
          input.request.operationId,
          result(input.request.operationId, "rejected", { code: "operation_not_found" }),
        );
      }
      if (
        !hasRequestedState(state, input.request.command) &&
        input.request.command.expectedEntityRevision !== undefined &&
        input.request.command.expectedEntityRevision !== state.entityRevision
      ) {
        return terminal(
          input.authority.deviceId,
          input.request.operationId,
          result(input.request.operationId, "rejected", {
            code: "entity_revision_conflict",
          }),
        );
      }
      if (hasRequestedState(state, input.request.command)) {
        await publish(input.authority.deviceId, result(input.request.operationId, "accepted"));
        const appliedCursor = options.currentCursor?.();
        return terminal(
          input.authority.deviceId,
          input.request.operationId,
          result(input.request.operationId, "succeeded", {
            value: {
              type: "session-state",
              sessionId: state.sessionId,
              entityRevision: state.entityRevision,
            },
            ...(appliedCursor === undefined ? {} : { appliedCursor }),
          }),
        );
      }
    }

    await publish(input.authority.deviceId, result(input.request.operationId, "accepted"));
    await options.observer?.accepted({
      deviceId: input.authority.deviceId,
      request: input.request,
    });

    let value: Awaited<ReturnType<RemoteCommandAdapter["execute"]>>;
    try {
      // Authorization, lease, revocation, and interaction state may change during local reads.
      await options.authorization.authorize({ authority: input.authority, action });
      if (input.request.command.type === "interaction.answerQuestion") {
        await requireCurrentInteraction(input.request.command);
      }
      value = await options.commands.execute({
        operationId: input.request.operationId,
        ...(begun.record.domainIdentity?.type === "message"
          ? { messageId: begun.record.domainIdentity.messageId }
          : {}),
        ...(input.request.command.type === "session.create" &&
        begun.record.domainIdentity?.type === "session"
          ? { requestedSessionId: begun.record.domainIdentity.sessionId }
          : {}),
        command: input.request.command,
      });
    } catch (error) {
      return terminal(
        input.authority.deviceId,
        input.request.operationId,
        result(input.request.operationId, "rejected", { code: errorCode(error) }),
      );
    }
    const appliedCursor = options.currentCursor?.();
    return terminal(
      input.authority.deviceId,
      input.request.operationId,
      result(input.request.operationId, "succeeded", {
        ...(value === undefined ? {} : { value }),
        ...(appliedCursor === undefined ? {} : { appliedCursor }),
      }),
    );
  };

  return {
    execute(input: {
      readonly authority: DesktopRemoteOperationAuthority;
      readonly request: RemoteOperationRequestV1;
    }): Promise<RemoteOperationResultV1> {
      return isOrganizationCommand(input.request.command)
        ? serializeSessionMutation(input.request.command.sessionId, () => execute(input))
        : execute(input);
    },
    reconcileIncomplete() {
      return options.ledger.reconcileIncomplete(options.reconcile ?? (async () => undefined));
    },
  };
}
