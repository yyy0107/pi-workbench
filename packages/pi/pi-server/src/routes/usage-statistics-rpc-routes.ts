import { handleRpcPost, type RpcRouteGroup } from "@workbench/api/server";
import {
  rpcObject,
  rpcOptional,
  rpcBoolean,
  rpcRefine,
  rpcString,
} from "@workbench/api/validation";
import type { UsageStatisticsReader } from "@workbench/pi-session-server/usage";

const payload = rpcObject({
  preferCached: rpcOptional(rpcBoolean),
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
  readonly readUsage: UsageStatisticsReader;
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
