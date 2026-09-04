export interface RuntimeHttpRouterDependencies {
  readonly handleRpcPost: (request: Request, method: string) => Promise<Response>;
  readonly handleWorkspaceFileContentRequest: (request: Request) => Response | Promise<Response>;
  readonly handlePiRequest: (request: Request) => Promise<Response>;
}

/** Application-owned ingress: public services and Pi legacy/export routes share one listener. */
export function createRuntimeHttpRouter({
  handleRpcPost,
  handleWorkspaceFileContentRequest,
  handlePiRequest,
}: RuntimeHttpRouterDependencies): (request: Request) => Promise<Response> {
  return async (request) => {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/api/workspace.files.content") {
      if (request.method === "OPTIONS")
        return new Response(null, { status: 204, headers: { Allow: "GET, HEAD, OPTIONS" } });
      if (request.method !== "GET" && request.method !== "HEAD")
        return new Response(null, { status: 405 });
      return handleWorkspaceFileContentRequest(request);
    }
    if (pathname === "/api/session.export") return handlePiRequest(request);
    const match = /^\/api\/([^/]+)$/u.exec(pathname);
    if (match) {
      if (request.method === "OPTIONS") return new Response("Not Found", { status: 404 });
      if (request.method !== "POST") return new Response(null, { status: 405 });
      let method: string;
      try {
        method = decodeURIComponent(match[1]!);
      } catch {
        return new Response("Bad Request", { status: 400 });
      }
      return handleRpcPost(request, method);
    }
    return handlePiRequest(request);
  };
}
