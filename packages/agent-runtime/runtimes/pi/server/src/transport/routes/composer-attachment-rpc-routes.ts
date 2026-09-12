import {
  MANAGED_FILE_MAX_BYTES,
  MANAGED_IMAGE_MEDIA_TYPES,
  PASTED_TEXT_MAX_BYTES,
  type ComposerAttachmentService,
  type CreateManagedFileAttachmentRequest,
  type CreateManagedImageAttachmentRequest,
  type CreatePastedTextAttachmentRequest,
  type ReadManagedFileAttachmentRequest,
  type ReadManagedImageAttachmentRequest,
  type ReadPastedTextAttachmentRequest,
} from "@workbench/agent-runtime-contracts/composer-attachments";
import { INLINE_IMAGE_LIMITS } from "@workbench/agent-runtime-pi-protocol/attachments";
import {
  handleRpcPost,
  rpcEnum,
  rpcObject,
  rpcString,
  rpcInteger,
  rpcOptional,
  rpcBusinessError,
  type RpcRouteGroup,
} from "@workbench/host-server/rpc";
import { ComposerAttachmentError } from "../../attachments/composer-text-attachments";

export function createComposerAttachmentRpcRoutes(
  service: ComposerAttachmentService,
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
        case "composer.attachments.createImage":
          return handleRpcPost(request, {
            method,
            maxRequestBodyBytes:
              Math.ceil(INLINE_IMAGE_LIMITS.maxDecodedBytesPerImage / 3) * 4 + 8192,
            payload: rpcObject({
              id,
              name: rpcString({ minLength: 1, maxLength: 4096 }),
              mediaType: rpcEnum(MANAGED_IMAGE_MEDIA_TYPES),
              data: rpcString({
                minLength: 1,
                maxLength: Math.ceil(INLINE_IMAGE_LIMITS.maxDecodedBytesPerImage / 3) * 4,
              }),
            }),
            handler: (input: CreateManagedImageAttachmentRequest) =>
              invoke(() => service.createImage(input)),
          });
        case "composer.attachments.createFile":
          return handleRpcPost(request, {
            method,
            maxRequestBodyBytes: Math.ceil(MANAGED_FILE_MAX_BYTES / 3) * 4 + 8192,
            payload: rpcObject({
              id,
              name: rpcString({ minLength: 1, maxLength: 255 }),
              mediaType: rpcString({ minLength: 3, maxLength: 255 }),
              data: rpcString({
                minLength: 0,
                maxLength: Math.ceil(MANAGED_FILE_MAX_BYTES / 3) * 4,
              }),
            }),
            handler: (input: CreateManagedFileAttachmentRequest) =>
              invoke(() => service.createFile(input)),
          });
        case "composer.attachments.readImage":
          return handleRpcPost(request, {
            method,
            payload: rpcObject({ id }),
            handler: (input: ReadManagedImageAttachmentRequest) =>
              invoke(() => service.readImage(input)),
          });
        case "composer.attachments.readFile":
          return handleRpcPost(request, {
            method,
            payload: rpcObject({ id }),
            handler: (input: ReadManagedFileAttachmentRequest) =>
              invoke(() => service.readFile(input)),
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
