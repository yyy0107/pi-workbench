import type { AttachmentUnderstandingUpdatePayload as ImageUnderstandingUpdatePayload } from "@workbench/attachment-understanding-contracts/settings";
import type { ImageUnderstandingSettingsProtocol } from "./settings-store";
import {
  handleRpcPost,
  rpcEnum,
  rpcInteger,
  rpcLiteral,
  rpcObject,
  rpcOptional,
  rpcString,
  rpcUnion,
  type RpcValidator,
} from "@workbench/host-server/rpc";
import type { RpcRouteGroup } from "@workbench/host-server/rpc";

export interface ImageUnderstandingSettingsRpcRoutesDependencies {
  readonly getStore: () => ImageUnderstandingSettingsProtocol;
  readonly projectDomainError: (error: unknown) => never;
}

const emptyPayload = rpcObject({});
const imageUnderstandingCredential = rpcOptional(
  rpcUnion([rpcString({ maxLength: 16_384 }), rpcLiteral(null)]),
);
const imageUnderstandingUpdatePayload = rpcObject({
  expectedRevision: rpcOptional(rpcInteger({ minimum: 0 })),
  patch: rpcObject({
    routing: rpcOptional(rpcEnum(["auto", "always-preprocess", "native-only", "disabled"])),
    engine: rpcOptional(rpcEnum(["ocr", "multimodal"])),
    ocrProvider: rpcOptional(rpcEnum(["glm-ocr", "paddleocr"])),
    glm: rpcOptional(
      rpcObject({
        endpoint: rpcOptional(rpcString({ maxLength: 2_048 })),
        model: rpcOptional(rpcString({ maxLength: 256 })),
        apiKey: imageUnderstandingCredential,
      }),
    ),
    paddle: rpcOptional(
      rpcObject({
        endpoint: rpcOptional(rpcString({ maxLength: 2_048 })),
        model: rpcOptional(rpcString({ maxLength: 256 })),
        apiKey: imageUnderstandingCredential,
        pollIntervalMs: rpcOptional(rpcInteger({ minimum: 100, maximum: 60_000 })),
        pollTimeoutMs: rpcOptional(rpcInteger({ minimum: 1_000, maximum: 3_600_000 })),
      }),
    ),
    ocrAdapter: rpcOptional(
      rpcObject({
        preset: rpcOptional(
          rpcEnum(["glm-ocr", "paddleocr-vl-1.6", "pp-ocrv6", "pp-structure-v3", "custom"]),
        ),
        source: rpcOptional(rpcString({ maxLength: 100_000 })),
        endpoint: rpcOptional(rpcString({ maxLength: 2_048 })),
        model: rpcOptional(rpcString({ maxLength: 256 })),
        apiKey: imageUnderstandingCredential,
        pollIntervalMs: rpcOptional(rpcInteger({ minimum: 100, maximum: 60_000 })),
        pollTimeoutMs: rpcOptional(rpcInteger({ minimum: 1_000, maximum: 3_600_000 })),
      }),
    ),
    multimodal: rpcOptional(
      rpcObject({
        provider: rpcOptional(rpcString({ maxLength: 256 })),
        model: rpcOptional(rpcString({ maxLength: 256 })),
      }),
    ),
  }),
}) as RpcValidator<ImageUnderstandingUpdatePayload>;

async function invokeStore<Value>(
  operation: () => Promise<Value>,
  projectDomainError: ImageUnderstandingSettingsRpcRoutesDependencies["projectDomainError"],
): Promise<Value> {
  try {
    return await operation();
  } catch (error) {
    projectDomainError(error);
  }
}

export function createImageUnderstandingSettingsRpcRoutes({
  getStore,
  projectDomainError,
}: ImageUnderstandingSettingsRpcRoutesDependencies): RpcRouteGroup {
  return {
    handle(request, method) {
      switch (method) {
        case "imageUnderstanding.describe":
          return handleRpcPost(request, {
            method,
            payload: emptyPayload,
            loopbackOnly: true,
            handler: () => invokeStore(() => getStore().describe(), projectDomainError),
          });
        case "imageUnderstanding.update":
          return handleRpcPost(request, {
            method,
            payload: imageUnderstandingUpdatePayload,
            loopbackOnly: true,
            handler: (payload) => invokeStore(() => getStore().update(payload), projectDomainError),
          });
        default:
          return undefined;
      }
    },
  };
}
