import { handlePiRpcPost } from "@/workbench/server/pi/installed-pi-server";

export const runtime = "nodejs";

interface RpcRouteContext {
  params: Promise<{ rpc: string }>;
}

export async function POST(request: Request, context: RpcRouteContext) {
  const { rpc } = await context.params;
  return handlePiRpcPost(request, rpc);
}

export function OPTIONS() {
  return new Response("Not Found", { status: 404 });
}
