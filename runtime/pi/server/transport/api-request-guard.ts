import { inspectConfiguredApiRequestTrust } from "./local-api-request-trust";

export function rejectUntrustedApiRequest(
  request: { headers: Headers },
  options: { loopbackOnly?: boolean } = {},
): Response | undefined {
  const trust = inspectConfiguredApiRequestTrust(request);
  if (trust.trusted && (!options.loopbackOnly || trust.loopback)) return undefined;
  return new Response("Forbidden", { status: 403 });
}
