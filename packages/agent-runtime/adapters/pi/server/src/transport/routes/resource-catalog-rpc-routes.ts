import type { PromptListPayload } from "@workbench/agent-runtime-pi-protocol/rpc";
import type { CommandCatalogProtocol } from "../../commands/command-service";
import type { PromptCatalogProtocol } from "../../prompts/prompt-service";
import { resourceCatalogTarget, resourceListPayload } from "../resource-rpc-validators";
import { handleRpcPost, rpcObject, type RpcValidator } from "../rpc-transport";
import type { RpcRouteGroup } from "./rpc-route-group";

export interface ResourceCatalogRpcRoutesDependencies {
  readonly commands: CommandCatalogProtocol;
  readonly prompts: PromptCatalogProtocol;
  readonly projectDomainError: (error: unknown) => never;
}

const promptListPayload = rpcObject({
  target: resourceCatalogTarget,
}) as RpcValidator<PromptListPayload>;

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
        default:
          return undefined;
      }
    },
  };
}
