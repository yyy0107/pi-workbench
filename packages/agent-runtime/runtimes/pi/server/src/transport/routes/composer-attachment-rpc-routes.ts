import {
  PASTED_TEXT_MAX_BYTES,
  type ComposerTextAttachmentService,
  type CreatePastedTextAttachmentRequest,
  type ReadPastedTextAttachmentRequest,
} from "@workbench/agent-runtime-contracts/composer-attachments";
import {
  handleRpcPost,
  rpcObject,
  rpcString,
  rpcInteger,
  rpcOptional,
  rpcBusinessError,
  type RpcRouteGroup,
} from "@workbench/host-server/rpc";
import { ComposerAttachmentError } from "../../attachments/composer-text-attachments";

export function createComposerAttachmentRpcRoutes(
  service: ComposerTextAttachmentService,
): RpcRouteGroup {
  const id = rpcString({ minLength: 36, maxLength: 36 });
  const invoke = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ComposerAttachmentError)
        throw rpcBusinessError(error.code, error.message, {});
      throw rpcBusinessError("text-attachment-failed", "Text attachment operation failed.", {});
    }
  };
  return {
    handle(request, method) {
      switch (method) {
        case "composer.attachments.create":
          return handleRpcPost(request, {
            method,
            // JSON can escape one text byte as six ASCII bytes; include the RPC envelope.
            maxRequestBodyBytes: PASTED_TEXT_MAX_BYTES * 6 + 4096,
            payload: rpcObject({
              id,
              text: rpcString({ minLength: 1, maxLength: PASTED_TEXT_MAX_BYTES }),
            }),
            handler: (input: CreatePastedTextAttachmentRequest) =>
              invoke(() => service.create(input)),
          });
        case "composer.attachments.read":
          return handleRpcPost(request, {
            method,
            payload: rpcObject({
              id,
              offset: rpcOptional(rpcInteger({ minimum: 0, maximum: PASTED_TEXT_MAX_BYTES })),
            }),
            handler: (input: ReadPastedTextAttachmentRequest) => invoke(() => service.read(input)),
          });
        case "composer.attachments.discard":
          return handleRpcPost(request, {
            method,
            payload: rpcObject({ id }),
            handler: (input: { id: string }) =>
              invoke(async () => {
                await service.discard(input);
                return { discarded: true };
              }),
          });
        default:
          return undefined;
      }
    },
  };
}
