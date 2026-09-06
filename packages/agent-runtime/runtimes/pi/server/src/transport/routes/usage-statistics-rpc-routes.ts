import {
  handleRpcPost,
  rpcObject,
  rpcRefine,
  rpcString,
  type RpcRouteGroup,
} from "@workbench/host-server/rpc";
import type { readUsageStatistics } from "../../sessions/usage-statistics";

const payload = rpcObject({
  timeZone: rpcRefine(
    rpcString({ minLength: 1, maxLength: 100 }),
    (value) => {
      try {
        new Intl.DateTimeFormat(undefined, { timeZone: value });
        return true;
      } catch {
        return false;
      }
    },
    { message: "Invalid time zone." },
  ),
});

export function createUsageStatisticsRpcRoutes({
  readUsage,
}: {
  readonly readUsage: typeof readUsageStatistics;
}): RpcRouteGroup {
  return {
    handle(request, method) {
      if (method !== "usage.statistics") return undefined;
      return handleRpcPost(request, {
        method,
        payload,
        handler: (input) => readUsage(input, request.signal),
      });
    },
  };
}
