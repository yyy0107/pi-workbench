import { parseRemoteOperationRequestV1 } from "@workbench/remote-control-contracts/codecs";
import type {
  RemoteCursor,
  RemoteOperationRequestV1,
  RemoteOperationResultV1,
} from "@workbench/remote-control-contracts/protocol";

export type MobileRemoteOperationStatus =
  | "sending"
  | "accepted"
  | "awaiting-projection"
  | "outcome-unknown";

export interface MobileRemoteOperation {
  readonly operationId: string;
  readonly request: RemoteOperationRequestV1;
  readonly status: MobileRemoteOperationStatus;
  readonly result?: RemoteOperationResultV1;
  readonly appliedCursor?: RemoteCursor;
}

export function isRemoteOperationExpired(
  operation: Pick<MobileRemoteOperation, "request">,
  now: Date,
): boolean {
  return (
    !Number.isFinite(now.getTime()) || Date.parse(operation.request.expiresAt) <= now.getTime()
  );
}

export function recreateRemoteOperationForExplicitRetry(input: {
  readonly operation: MobileRemoteOperation;
  readonly operationId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}): MobileRemoteOperation {
  if (!parseRemoteOperationRequestV1(input.operation.request)) {
    throw new Error("operation_request_invalid");
  }
  return createOperation({
    operationId: input.operationId,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    command: input.operation.request.command,
  });
}

export function createTextSendOperation(input: {
  readonly operationId: string;
  readonly sessionId: string;
  readonly text: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}): MobileRemoteOperation {
  const request: RemoteOperationRequestV1 = {
    type: "operation.request",
    operationId: input.operationId,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    command: { type: "session.send", sessionId: input.sessionId, text: input.text },
  };
  if (!parseRemoteOperationRequestV1(request)) throw new Error("operation_request_invalid");
  return Object.freeze({ operationId: input.operationId, request, status: "sending" });
}

export function createStopOperation(input: {
  readonly operationId: string;
  readonly sessionId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}): MobileRemoteOperation {
  return createOperation({
    ...input,
    command: { type: "session.stop", sessionId: input.sessionId },
  });
}

export function createQuestionAnswerOperation(input: {
  readonly operationId: string;
  readonly sessionId: string;
  readonly interactionId: string;
  readonly interactionRevision: string;
  readonly answers: Extract<
    RemoteOperationRequestV1["command"],
    { type: "interaction.answerQuestion" }
  >["answers"];
  readonly issuedAt: string;
  readonly expiresAt: string;
}): MobileRemoteOperation {
  return createOperation({
    ...input,
    command: {
      type: "interaction.answerQuestion",
      sessionId: input.sessionId,
      interactionId: input.interactionId,
      interactionRevision: input.interactionRevision,
      answers: input.answers,
    },
  });
}

export function createSessionCreateOperation(input: {
  readonly operationId: string;
  readonly workspaceId?: string;
  readonly title?: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}): MobileRemoteOperation {
  return createOperation({
    ...input,
    command: {
      type: "session.create",
      ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
      ...(input.title === undefined ? {} : { title: input.title }),
    },
  });
}

export function createSessionRenameOperation(input: {
  readonly operationId: string;
  readonly sessionId: string;
  readonly title: string;
  readonly expectedEntityRevision?: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}): MobileRemoteOperation {
  return createOperation({
    ...input,
    command: {
      type: "session.rename",
      sessionId: input.sessionId,
      title: input.title,
      ...(input.expectedEntityRevision === undefined
        ? {}
        : { expectedEntityRevision: input.expectedEntityRevision }),
    },
  });
}

export function createSessionPinnedOperation(input: {
  readonly operationId: string;
  readonly sessionId: string;
  readonly pinned: boolean;
  readonly expectedEntityRevision?: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}): MobileRemoteOperation {
  return createOperation({
    ...input,
    command: {
      type: "session.setPinned",
      sessionId: input.sessionId,
      pinned: input.pinned,
      ...(input.expectedEntityRevision === undefined
        ? {}
        : { expectedEntityRevision: input.expectedEntityRevision }),
    },
  });
}

export function createSessionArchiveOperation(input: {
  readonly operationId: string;
  readonly sessionId: string;
  readonly expectedEntityRevision?: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}): MobileRemoteOperation {
  return createOperation({
    ...input,
    command: {
      type: "session.setArchived",
      sessionId: input.sessionId,
      archived: true,
      ...(input.expectedEntityRevision === undefined
        ? {}
        : { expectedEntityRevision: input.expectedEntityRevision }),
    },
  });
}

function createOperation(input: {
  readonly operationId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly command: RemoteOperationRequestV1["command"];
}): MobileRemoteOperation {
  const request: RemoteOperationRequestV1 = {
    type: "operation.request",
    operationId: input.operationId,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    command: input.command,
  };
  if (!parseRemoteOperationRequestV1(request)) throw new Error("operation_request_invalid");
  return Object.freeze({ operationId: input.operationId, request, status: "sending" });
}
