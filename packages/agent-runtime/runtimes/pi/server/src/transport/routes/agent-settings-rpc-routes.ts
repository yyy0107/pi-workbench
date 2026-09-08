import { RPC_REQUEST_BODY_LIMITS } from "../rpc-request-budgets";
import type { SettingsOpenDocumentValue } from "@workbench/agent-runtime-pi-protocol/rpc";
import type { AgentSettingsProtocol } from "../../settings/agent-settings-service";
import {
  scopedDescribePayload,
  scopedUpdatePayload,
  settingsUpdatePayload,
} from "../agent-settings-rpc-validators";
import { handleRpcPost, rpcBusinessError, rpcObject } from "@workbench/host-server/rpc";
import type { RpcRouteGroup } from "@workbench/host-server/rpc";

export interface AgentSettingsRpcRoutesDependencies {
  readonly service: AgentSettingsProtocol;
  readonly openDocument: (
    settingsFile: string,
    signal: AbortSignal,
  ) => Promise<SettingsOpenDocumentValue>;
  readonly projectDomainError: (error: unknown) => never;
}

const emptyPayload = rpcObject({});

function isAborted(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

async function invokeService<Value>(
  operation: () => Promise<Value>,
  projectDomainError: AgentSettingsRpcRoutesDependencies["projectDomainError"],
): Promise<Value> {
  try {
    return await operation();
  } catch (error) {
    projectDomainError(error);
  }
}

async function openSettingsDocument(
  service: AgentSettingsProtocol,
  openDocument: AgentSettingsRpcRoutesDependencies["openDocument"],
  signal: AbortSignal,
  projectDomainError: AgentSettingsRpcRoutesDependencies["projectDomainError"],
): Promise<SettingsOpenDocumentValue> {
  const settingsFile = await invokeService(() => service.prepareDocument(), projectDomainError);
  try {
    return await openDocument(settingsFile, signal);
  } catch (error) {
    if (isAborted(error, signal)) {
      throw rpcBusinessError("cancelled", "Opening settings was cancelled.", {});
    }
    throw rpcBusinessError(
      "internal",
      "The host could not open the settings document.",
      {},
      { cause: error },
    );
  }
}

export function createAgentSettingsRpcRoutes({
  service,
  openDocument,
  projectDomainError,
}: AgentSettingsRpcRoutesDependencies): RpcRouteGroup {
  return {
    handle(request, method) {
      switch (method) {
        // Separate methods ensure older Runtimes cannot discard a project target and save globally.
        case "settings.describeScoped":
          return handleRpcPost(request, {
            method,
            payload: scopedDescribePayload,
            loopbackOnly: true,
            handler: ({ target }) =>
              invokeService(() => service.describe(target), projectDomainError),
          });
        case "settings.updateScoped":
          return handleRpcPost(request, {
            method,
            payload: scopedUpdatePayload,
            maxRequestBodyBytes: RPC_REQUEST_BODY_LIMITS.agentSettingsUpdate,
            loopbackOnly: true,
            handler: (payload) => invokeService(() => service.update(payload), projectDomainError),
          });
        case "settings.describe":
          return handleRpcPost(request, {
            method,
            payload: emptyPayload,
            loopbackOnly: true,
            handler: () => invokeService(() => service.describe(), projectDomainError),
          });
        case "settings.openDocument":
          return handleRpcPost(request, {
            method,
            payload: emptyPayload,
            loopbackOnly: true,
            handler: (_payload, context) =>
              openSettingsDocument(service, openDocument, context.signal, projectDomainError),
          });
        case "settings.update":
          return handleRpcPost(request, {
            method,
            payload: settingsUpdatePayload,
            maxRequestBodyBytes: RPC_REQUEST_BODY_LIMITS.agentSettingsUpdate,
            loopbackOnly: true,
            handler: (payload) => invokeService(() => service.update(payload), projectDomainError),
          });
        default:
          return undefined;
      }
    },
  };
}
