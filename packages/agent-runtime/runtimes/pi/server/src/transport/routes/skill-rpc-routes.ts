import type {
  SkillDescribePayload,
  SkillFileReadPayload,
  SkillFilesListPayload,
  SkillSetEnabledPayload,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import type { SkillProtocol } from "../../skills/skill-service";
import {
  resourceListPayload,
  resourceNameValidator,
  resourceRelativeDirectoryPathValidator,
  resourceRelativeFilePathValidator,
  resourceRequestPayload,
} from "../resource-rpc-validators";
import { handleRpcPost, rpcBoolean, rpcOptional } from "@workbench/host-server/rpc";
import type { RpcRouteGroup } from "@workbench/host-server/rpc";

export interface SkillRpcRoutesDependencies {
  readonly service: SkillProtocol;
  readonly projectDomainError: (error: unknown) => never;
}

const skillDescribePayload = resourceRequestPayload<SkillDescribePayload>({
  name: resourceNameValidator,
});
const skillSetEnabledPayload = resourceRequestPayload<SkillSetEnabledPayload>({
  name: resourceNameValidator,
  enabled: rpcBoolean,
});
const skillFilesListPayload = resourceRequestPayload<SkillFilesListPayload>({
  name: resourceNameValidator,
  relativePath: rpcOptional(resourceRelativeDirectoryPathValidator),
});
const skillFileReadPayload = resourceRequestPayload<SkillFileReadPayload>({
  name: resourceNameValidator,
  relativePath: resourceRelativeFilePathValidator,
});

async function invokeService<Value>(
  operation: () => Promise<Value>,
  projectDomainError: SkillRpcRoutesDependencies["projectDomainError"],
): Promise<Value> {
  try {
    return await operation();
  } catch (error) {
    projectDomainError(error);
  }
}

export function createSkillRpcRoutes({
  service,
  projectDomainError,
}: SkillRpcRoutesDependencies): RpcRouteGroup {
  return {
    handle(request, method) {
      switch (method) {
        case "skill.list":
          return handleRpcPost(request, {
            method,
            payload: resourceListPayload,
            handler: (payload) => invokeService(() => service.list(payload), projectDomainError),
          });
        case "skill.describe":
          return handleRpcPost(request, {
            method,
            payload: skillDescribePayload,
            handler: (payload) =>
              invokeService(() => service.describe(payload), projectDomainError),
          });
        case "skill.setEnabled":
          return handleRpcPost(request, {
            method,
            payload: skillSetEnabledPayload,
            loopbackOnly: true,
            handler: (payload) =>
              invokeService(() => service.setEnabled(payload), projectDomainError),
          });
        case "skill.remove":
          return handleRpcPost(request, {
            method,
            payload: skillDescribePayload,
            loopbackOnly: true,
            handler: (payload) => invokeService(() => service.remove(payload), projectDomainError),
          });
        case "skill.files.list":
          return handleRpcPost(request, {
            method,
            payload: skillFilesListPayload,
            handler: (payload) =>
              invokeService(() => service.listFiles(payload), projectDomainError),
          });
        case "skill.files.read":
          return handleRpcPost(request, {
            method,
            payload: skillFileReadPayload,
            handler: (payload) =>
              invokeService(() => service.readFile(payload), projectDomainError),
          });
        default:
          return undefined;
      }
    },
  };
}
