import type {
  PromptListPayload,
  PromptDescribePayload,
  PromptSavePayload,
  PromptRemovePayload,
  PromptSetEnabledPayload,
  PromptExpandPayload,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import type { CommandCatalogProtocol } from "../../commands/command-service";
import type { PromptCatalogProtocol } from "../../prompts/prompt-service";
import { resourceCatalogTarget, resourceListPayload } from "../resource-rpc-validators";
import {
  handleRpcPost,
  rpcObject,
  rpcString,
  rpcOptional,
  rpcBoolean,
  type RpcValidator,
} from "@workbench/host-server/rpc";
import type { RpcRouteGroup } from "@workbench/host-server/rpc";

export interface ResourceCatalogRpcRoutesDependencies {
  readonly commands: CommandCatalogProtocol;
  readonly prompts: PromptCatalogProtocol;
  readonly projectDomainError: (error: unknown) => never;
}

const promptListPayload = rpcObject({
  target: resourceCatalogTarget,
}) as RpcValidator<PromptListPayload>;

const promptIdentity = {
  target: resourceCatalogTarget,
  id: rpcString({ minLength: 64, maxLength: 64 }),
};
const promptDescribePayload = rpcObject(promptIdentity) as RpcValidator<PromptDescribePayload>;
const promptSavePayload = rpcObject({
  target: resourceCatalogTarget,
  id: rpcOptional(promptIdentity.id),
  version: rpcOptional(rpcString({ minLength: 64, maxLength: 64 })),
  name: rpcString({ minLength: 1, maxLength: 100 }),
  content: rpcString({ minLength: 1, maxLength: 256 * 1024 }),
}) as RpcValidator<PromptSavePayload>;
const promptRemovePayload = rpcObject({
  ...promptIdentity,
  version: rpcString({ minLength: 64, maxLength: 64 }),
}) as RpcValidator<PromptRemovePayload>;
const promptEnabledPayload = rpcObject({
  ...promptIdentity,
  enabled: rpcBoolean,
}) as RpcValidator<PromptSetEnabledPayload>;
const promptExpandPayload = rpcObject({
  ...promptIdentity,
  arguments: rpcString({ maxLength: 64 * 1024 }),
}) as RpcValidator<PromptExpandPayload>;

async function invokeCatalog<Value>(
  operation: () => Promise<Value>,
  projectDomainError: ResourceCatalogRpcRoutesDependencies["projectDomainError"],
): Promise<Value> {
  try {
    return await operation();
  } catch (error) {
    projectDomainError(error);
  }
}

export function createResourceCatalogRpcRoutes({
  commands,
  prompts,
  projectDomainError,
}: ResourceCatalogRpcRoutesDependencies): RpcRouteGroup {
  return {
    handle(request, method) {
      switch (method) {
        case "command.list":
          return handleRpcPost(request, {
            method,
            payload: resourceListPayload,
            handler: (payload) => invokeCatalog(() => commands.list(payload), projectDomainError),
          });
        case "prompt.list":
          return handleRpcPost(request, {
            method,
            payload: promptListPayload,
            handler: (payload) => invokeCatalog(() => prompts.list(payload), projectDomainError),
          });
        case "prompt.describe":
          return handleRpcPost(request, {
            method,
            payload: promptDescribePayload,

            handler: (payload) =>
              invokeCatalog(() => prompts.describe(payload), projectDomainError),
          });
        case "prompt.save":
          return handleRpcPost(request, {
            method,
            payload: promptSavePayload,
            loopbackOnly: true,
            handler: (payload) => invokeCatalog(() => prompts.save(payload), projectDomainError),
          });
        case "prompt.remove":
          return handleRpcPost(request, {
            method,
            payload: promptRemovePayload,
            loopbackOnly: true,
            handler: (payload) => invokeCatalog(() => prompts.remove(payload), projectDomainError),
          });
        case "prompt.setEnabled":
          return handleRpcPost(request, {
            method,
            payload: promptEnabledPayload,
            loopbackOnly: true,
            handler: (payload) =>
              invokeCatalog(() => prompts.setEnabled(payload), projectDomainError),
          });
        case "prompt.expand":
          return handleRpcPost(request, {
            method,
            payload: promptExpandPayload,

            handler: (payload) => invokeCatalog(() => prompts.expand(payload), projectDomainError),
          });
        default:
          return undefined;
      }
    },
  };
}
