import { SUPPORTED_LOCALES } from "@workbench/contracts/locale";
import type {
  SettingsOpenDocumentValue,
  WorkbenchSettingsUpdatePayload,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import type { WorkbenchSettingsProtocol } from "@workbench/agent-runtime-contracts/settings";
import {
  handleRpcPost,
  RPC_REQUEST_BODY_LIMITS,
  rpcBusinessError,
  rpcArray,
  rpcBoolean,
  rpcEnum,
  rpcLiteral,
  rpcNullable,
  rpcObject,
  rpcOptional,
  rpcRecord,
  rpcString,
  rpcUnion,
  rpcUnknown,
  type RpcValidator,
} from "../rpc-transport";
import type { RpcRouteGroup } from "./rpc-route-group";

export interface WorkbenchSettingsRpcRoutesDependencies {
  readonly getService: () => WorkbenchSettingsProtocol;
  readonly openDocument: (
    settingsFile: string,
    signal: AbortSignal,
  ) => Promise<SettingsOpenDocumentValue>;
  readonly projectDomainError: (error: unknown) => never;
}

const emptyPayload = rpcObject({});
const workbenchSettingsUpdatePayload = rpcObject({
  patch: rpcObject({
    appearance: rpcOptional(rpcNullable(rpcRecord(rpcUnknown))),
    backgroundImage: rpcOptional(
      rpcNullable(
        rpcObject({
          name: rpcString({ minLength: 1, maxLength: 1_024 }),
          mimeType: rpcString({ minLength: 1, maxLength: 256 }),
          data: rpcString({ minLength: 1, maxLength: 16 * 1024 * 1024 }),
        }),
      ),
    ),
    locale: rpcOptional(rpcNullable(rpcEnum(SUPPORTED_LOCALES))),
    modelSelector: rpcOptional(
      rpcNullable(
        rpcObject({
          modelId: rpcString({ minLength: 1, maxLength: 512 }),
          reasoningEffort: rpcOptional(rpcString({ minLength: 1, maxLength: 128 })),
        }),
      ),
    ),
    sidebarThreadOrderByScope: rpcOptional(
      rpcNullable(
        rpcRecord(rpcArray(rpcString({ minLength: 1, maxLength: 512 }), { maxLength: 10_000 })),
      ),
    ),
    sidebarThreadSortMode: rpcOptional(rpcNullable(rpcEnum(["priority", "recent", "manual"]))),
    toolboxPins: rpcOptional(
      rpcNullable(rpcArray(rpcString({ minLength: 1, maxLength: 512 }), { maxLength: 1_000 })),
    ),
    toolboxScope: rpcOptional(
      rpcNullable(
        rpcUnion([
          rpcObject({ kind: rpcLiteral("user") }),
          rpcObject({
            kind: rpcLiteral("project"),
            workspaceId: rpcString({ minLength: 1, maxLength: 512 }),
          }),
        ]),
      ),
    ),
    rightWorkspace: rpcOptional(rpcNullable(rpcRecord(rpcUnknown))),
    sidebarOpen: rpcOptional(rpcNullable(rpcBoolean)),
  }),
}) as RpcValidator<WorkbenchSettingsUpdatePayload>;

async function invokeService<Value>(
  operation: () => Promise<Value>,
  projectDomainError: WorkbenchSettingsRpcRoutesDependencies["projectDomainError"],
): Promise<Value> {
  try {
    return await operation();
  } catch (error) {
    projectDomainError(error);
  }
}

function isAborted(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

async function openSettingsDocument(
  service: WorkbenchSettingsProtocol,
  openDocument: WorkbenchSettingsRpcRoutesDependencies["openDocument"],
  signal: AbortSignal,
  projectDomainError: WorkbenchSettingsRpcRoutesDependencies["projectDomainError"],
): Promise<SettingsOpenDocumentValue> {
  const settingsFile = await invokeService(() => service.prepareDocument(), projectDomainError);
  try {
    return await openDocument(settingsFile, signal);
  } catch (error) {
    if (isAborted(error, signal)) {
      throw rpcBusinessError("cancelled", "Opening Workbench settings was cancelled.", {});
    }
    throw rpcBusinessError(
      "internal",
      "The host could not open the Workbench settings document.",
      {},
      { cause: error },
    );
  }
}

export function createWorkbenchSettingsRpcRoutes({
  getService,
  openDocument,
  projectDomainError,
}: WorkbenchSettingsRpcRoutesDependencies): RpcRouteGroup {
  return {
    handle(request, method) {
      switch (method) {
        case "workbenchSettings.describe":
          return handleRpcPost(request, {
            method,
            payload: emptyPayload,
            handler: () => invokeService(() => getService().describe(), projectDomainError),
          });
        case "workbenchSettings.openDocument":
          return handleRpcPost(request, {
            method,
            payload: emptyPayload,
            loopbackOnly: true,
            handler: (_payload, context) =>
              openSettingsDocument(getService(), openDocument, context.signal, projectDomainError),
          });
        case "workbenchSettings.update":
          return handleRpcPost(request, {
            method,
            payload: workbenchSettingsUpdatePayload,
            maxRequestBodyBytes: RPC_REQUEST_BODY_LIMITS.workbenchSettingsUpdate,
            handler: (payload) =>
              invokeService(() => getService().update(payload), projectDomainError),
          });
        default:
          return undefined;
      }
    },
  };
}
