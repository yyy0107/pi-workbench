import {
  parseRemoteConversationPageV1,
  parseRemoteOperationRequestV1,
  parseRemoteOperationResultV1,
} from "@workbench/remote-control-contracts/codecs";
import type {
  RemoteConversationPageV1,
  RemoteOperationRequestV1,
  RemoteOperationResultV1,
} from "@workbench/remote-control-contracts/protocol";

import type {
  MobilePersistedOperation,
  MobilePersistedOperationStatus,
} from "../platform/sqlite.ts";

export interface MobileConversationCachePort {
  load(machineId: string, sessionId: string): Promise<RemoteConversationPageV1 | undefined>;
  save(machineId: string, page: RemoteConversationPageV1): Promise<void>;
  loadDraft(machineId: string, sessionId: string): Promise<string>;
  saveDraft(machineId: string, sessionId: string, text: string): Promise<void>;
  listOperations(
    machineId: string,
    sessionId: string,
  ): Promise<readonly MobilePersistedOperation[]>;
  saveOperation(value: MobilePersistedOperation): Promise<void>;
  removeOperation(machineId: string, operationId: string): Promise<void>;
}

export function createMobileConversationStore(options: {
  readonly cache: MobileConversationCachePort;
  readonly clock: { now(): Date };
}) {
  return {
    async load(machineId: string, sessionId: string) {
      const [page, draft, operations] = await Promise.all([
        options.cache.load(machineId, sessionId),
        options.cache.loadDraft(machineId, sessionId),
        options.cache.listOperations(machineId, sessionId),
      ]);
      if (page && (!parseRemoteConversationPageV1(page) || page.sessionId !== sessionId)) {
        throw new Error("conversation_cache_invalid");
      }
      return Object.freeze({ page, draft, operations: Object.freeze([...operations]) });
    },
    savePage(machineId: string, page: RemoteConversationPageV1) {
      if (!parseRemoteConversationPageV1(page)) throw new Error("conversation_cache_invalid");
      return options.cache.save(machineId, page);
    },
    saveDraft(machineId: string, sessionId: string, text: string) {
      return options.cache.saveDraft(machineId, sessionId, text);
    },
    saveOperation(input: {
      readonly machineId: string;
      readonly sessionId: string;
      readonly request: RemoteOperationRequestV1;
      readonly status: MobilePersistedOperationStatus;
      readonly result?: RemoteOperationResultV1;
    }) {
      if (
        !parseRemoteOperationRequestV1(input.request) ||
        (input.result &&
          (!parseRemoteOperationResultV1(input.result) ||
            input.result.operationId !== input.request.operationId))
      ) {
        throw new Error("pending_operation_cache_invalid");
      }
      return options.cache.saveOperation({
        ...input,
        operationId: input.request.operationId,
        updatedAt: options.clock.now().toISOString(),
      });
    },
    removeOperation(machineId: string, operationId: string) {
      return options.cache.removeOperation(machineId, operationId);
    },
  };
}
