export interface RpcRouteGroup {
  handle(request: Request, method: string): Promise<Response> | undefined;
}

/** Dispatches to the first domain route group that claims the RPC method. */
export function dispatchRpcRouteGroups(
  request: Request,
  method: string,
  groups: readonly RpcRouteGroup[],
): Promise<Response> | undefined {
  for (const group of groups) {
    const response = group.handle(request, method);
    if (response) return response;
  }
  return undefined;
}
