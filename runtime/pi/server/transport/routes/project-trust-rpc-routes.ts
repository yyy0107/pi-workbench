import type { ProjectTrustProtocol } from "../../trust/project-trust-service";
import {
  handleRpcPost,
  rpcBoolean,
  rpcObject,
  rpcString,
  type RpcValidator,
} from "../rpc-transport";
import type {
  ProjectTrustDescribePayload,
  ProjectTrustUpdatePayload,
} from "@/runtime/pi/contracts/rpc";
import type { RpcRouteGroup } from "./rpc-route-group";

export interface ProjectTrustRpcRoutesDependencies {
  readonly getService: () => ProjectTrustProtocol;
  readonly afterUpdate: () => void;
  readonly projectDomainError: (error: unknown) => never;
}

const nonEmptyString = rpcString({ minLength: 1 });
const projectTrustDescribePayload = rpcObject({
  path: nonEmptyString,
}) as RpcValidator<ProjectTrustDescribePayload>;
const projectTrustUpdatePayload = rpcObject({
  path: nonEmptyString,
  trusted: rpcBoolean,
}) as RpcValidator<ProjectTrustUpdatePayload>;

async function invokeService<Value>(
  operation: () => Value | Promise<Value>,
  projectDomainError: ProjectTrustRpcRoutesDependencies["projectDomainError"],
): Promise<Value> {
  try {
    return await operation();
  } catch (error) {
    projectDomainError(error);
  }
}

export function createProjectTrustRpcRoutes({
  getService,
  afterUpdate,
  projectDomainError,
}: ProjectTrustRpcRoutesDependencies): RpcRouteGroup {
  return {
    handle(request, method) {
      switch (method) {
        case "projectTrust.describe":
          return handleRpcPost(request, {
            method,
            payload: projectTrustDescribePayload,
            handler: (payload) =>
              invokeService(() => getService().describe(payload), projectDomainError),
          });
        case "projectTrust.update":
          return handleRpcPost(request, {
            method,
            payload: projectTrustUpdatePayload,
            handler: async (payload) => {
              const result = await invokeService(
                () => getService().update(payload),
                projectDomainError,
              );
              afterUpdate();
              return result;
            },
          });
        default:
          return undefined;
      }
    },
  };
}
