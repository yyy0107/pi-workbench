import { handleInteractiveResponsePost } from "../sessions/interactive-response-registry";
import { createDefaultPiRpcRouteGroups } from "./rpc-route-composition";
import { dispatchRpcRouteGroups, type RpcRouteGroup } from "./routes/rpc-route-group";

export type PiRpcPostHandler = (request: Request, method: string) => Promise<Response>;

export interface PiRpcRouterDependencies {
  readonly routeGroups: readonly RpcRouteGroup[];
  readonly respond: (request: Request) => Promise<Response>;
}

/** Creates a thin RPC dispatcher from an injected route graph and the exceptional respond handler. */
export function createPiRpcRouter({
  routeGroups,
  respond,
}: PiRpcRouterDependencies): PiRpcPostHandler {
  return async (request, method) => {
    const domainResponse = dispatchRpcRouteGroups(request, method, routeGroups);
    if (domainResponse) return domainResponse;
    if (method === "respond") return respond(request);
    return new Response("Not Found", { status: 404 });
  };
}

const defaultPiRpcRouter = createPiRpcRouter({
  routeGroups: createDefaultPiRpcRouteGroups(),
  respond: handleInteractiveResponsePost,
});

export function handlePiRpcPost(request: Request, method: string): Promise<Response> {
  return defaultPiRpcRouter(request, method);
}
