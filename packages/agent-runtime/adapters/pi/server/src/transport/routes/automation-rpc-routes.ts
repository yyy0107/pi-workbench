import type { AutomationProtocol } from "@workbench/automation-contracts";

import {
  handleRpcPost,
  rpcBoolean,
  rpcInteger,
  rpcObject,
  rpcOptional,
  rpcString,
} from "../rpc-transport";
import type { RpcRouteGroup } from "./rpc-route-group";

export interface AutomationRpcRoutesDependencies {
  readonly service: AutomationProtocol;
  readonly projectDomainError: (error: unknown) => never;
}

const id = rpcString({
  minLength: 1,
  maxLength: 200,
  pattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/u,
});
const modelSelection = rpcObject({
  provider: rpcString({ minLength: 1, maxLength: 200 }),
  model: rpcString({ minLength: 1, maxLength: 512 }),
  reasoningEffort: rpcOptional(rpcString({ minLength: 1, maxLength: 200 })),
});
const schedule = rpcObject({
  cron: rpcString({ minLength: 1, maxLength: 512, trim: true }),
  timezone: rpcString({ minLength: 1, maxLength: 200, trim: true }),
  maxDurationSeconds: rpcOptional(rpcInteger({ minimum: 1 })),
});
const listPayload = rpcObject({ includeArchived: rpcOptional(rpcBoolean) });
const readPayload = rpcObject({ automationId: id });
const savePayload = rpcObject({
  automationId: rpcOptional(id),
  baseRevision: rpcOptional(rpcInteger({ minimum: 0 })),
  name: rpcString({ minLength: 1, maxLength: 240, trim: true }),
  prompt: rpcString({ minLength: 1, maxLength: 100_000, trim: true }),
  workspaceId: rpcString({ minLength: 1, maxLength: 200 }),
  model: rpcOptional(modelSelection),
  schedule,
  enabled: rpcBoolean,
});
const archivePayload = rpcObject({ automationId: id, archived: rpcBoolean });
const enabledPayload = rpcObject({ automationId: id, enabled: rpcBoolean });
const sessionsPayload = rpcObject({
  automationId: id,
  limit: rpcOptional(rpcInteger({ minimum: 1, maximum: 200 })),
});
const removeSessionPayload = rpcObject({ automationId: id, sessionId: id });

async function invoke<Value>(
  operation: () => Promise<Value>,
  projectDomainError: AutomationRpcRoutesDependencies["projectDomainError"],
): Promise<Value> {
  try {
    return await operation();
  } catch (error) {
    projectDomainError(error);
  }
}

export function createAutomationRpcRoutes({
  service,
  projectDomainError,
}: AutomationRpcRoutesDependencies): RpcRouteGroup {
  return {
    handle(request, method) {
      switch (method) {
        case "automation.list":
          return handleRpcPost(request, {
            method,
            payload: listPayload,
            handler: (payload) => invoke(() => service.list(payload), projectDomainError),
          });
        case "automation.read":
          return handleRpcPost(request, {
            method,
            payload: readPayload,
            handler: (payload) => invoke(() => service.read(payload), projectDomainError),
          });
        case "automation.save":
          return handleRpcPost(request, {
            method,
            payload: savePayload,
            handler: (payload) => invoke(() => service.save(payload), projectDomainError),
          });
        case "automation.archive":
          return handleRpcPost(request, {
            method,
            payload: archivePayload,
            handler: (payload) => invoke(() => service.archive(payload), projectDomainError),
          });
        case "automation.setEnabled":
          return handleRpcPost(request, {
            method,
            payload: enabledPayload,
            handler: (payload) => invoke(() => service.setEnabled(payload), projectDomainError),
          });
        case "automation.runNow":
          return handleRpcPost(request, {
            method,
            payload: readPayload,
            handler: (payload) => invoke(() => service.runNow(payload), projectDomainError),
          });
        case "automation.sessions":
          return handleRpcPost(request, {
            method,
            payload: sessionsPayload,
            handler: (payload) => invoke(() => service.sessions(payload), projectDomainError),
          });
        case "automation.removeSession":
          return handleRpcPost(request, {
            method,
            payload: removeSessionPayload,
            handler: (payload) => invoke(() => service.removeSession(payload), projectDomainError),
          });
        default:
          return undefined;
      }
    },
  };
}
