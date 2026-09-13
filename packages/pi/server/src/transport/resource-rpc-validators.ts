import type { PiResourceRequest } from "@workbench/agent-runtime-pi-protocol/rpc";
import {
  rpcLiteral,
  rpcObject,
  rpcOptional,
  rpcRefine,
  rpcString,
  rpcUnion,
  type RpcOptionalValidator,
  type RpcValidator,
} from "@workbench/host-server/rpc";

const nonEmptyString = rpcString({ minLength: 1 });

export const resourceNameValidator = rpcString({
  minLength: 1,
  maxLength: 512,
  trim: true,
});

export const resourceRelativeDirectoryPathValidator = rpcString({ maxLength: 16_384 });

export const resourceRelativeFilePathValidator = rpcString({
  minLength: 1,
  maxLength: 16_384,
});

export const resourceCatalogTarget = rpcUnion([
  rpcObject({ scope: rpcLiteral("user") }),
  rpcObject({ scope: rpcLiteral("project"), workspaceId: nonEmptyString }),
]);

const resourceRequestFields = {
  sessionId: rpcOptional(nonEmptyString),
  target: rpcOptional(resourceCatalogTarget),
};

/** Accepts either a legacy Session identity or an application-level resource target, never both. */
export function resourceRequestPayload<Value extends PiResourceRequest>(
  shape: Record<string, RpcValidator<unknown> | RpcOptionalValidator<unknown>>,
): RpcValidator<Value> {
  const validator = rpcObject({ ...resourceRequestFields, ...shape });
  return rpcRefine(
    validator,
    (value) =>
      Boolean((value as { sessionId?: string }).sessionId) !==
      Boolean((value as { target?: unknown }).target),
    { message: "Expected exactly one of sessionId or target." },
  ) as RpcValidator<Value>;
}

export const resourceListPayload = resourceRequestPayload<PiResourceRequest>({});
