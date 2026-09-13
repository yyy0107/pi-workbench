interface ApiTrustRequest {
  headers: Headers;
}

export interface ApiRequestTrustOptions {
  trustedHosts?: readonly string[];
}

export interface ApiRequestTrustResult {
  trusted: boolean;
  loopback: boolean;
}

export function configuredApiTrustedHosts(): string[] {
  const hosts = (process.env.PI_WORKBENCH_TRUSTED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  for (const host of hosts) assertTrustedAuthority(host);
  return hosts;
}

interface ParsedAuthority {
  url: URL;
}

function parseAuthority(authority: string): ParsedAuthority | undefined {
  try {
    const parsed = new URL(`http://${authority}`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return undefined;
    }
    return { url: parsed };
  } catch {
    return undefined;
  }
}

/**
 * Preserve whether a configured authority declared a port even when WHATWG
 * URL parsing strips a scheme-default `:80` or `:443`. Parsing with both
 * special schemes makes their different defaults expose either spelling.
 */
function canonicalAuthority(authority: string, parsed: URL): string {
  const port = parsed.port || new URL(`https://${authority}`).port;
  return port ? `${parsed.hostname}:${port}` : parsed.hostname;
}

export function assertTrustedAuthority(authority: string): void {
  const parsed = parseAuthority(authority);
  if (parsed && canonicalAuthority(authority, parsed.url) === authority.toLowerCase()) return;
  throw new Error(
    `PI_WORKBENCH_TRUSTED_HOSTS entry ${JSON.stringify(authority)} is not a bare host[:port] authority`,
  );
}

function matchesTrustedHost(host: ParsedAuthority, trustedHost: string): boolean {
  const trusted = parseAuthority(trustedHost);
  if (!trusted) return false;
  return canonicalAuthority(trustedHost, trusted.url) === trusted.url.hostname
    ? trusted.url.hostname === host.url.hostname
    : trusted.url.host === host.url.host;
}

function parseOriginAuthority(origin: string): URL | undefined {
  try {
    const parsed = new URL(origin);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function inspectApiRequestTrust(
  request: ApiTrustRequest,
  options: ApiRequestTrustOptions = {},
): ApiRequestTrustResult {
  const host = request.headers.get("host");
  if (!host) return { trusted: false, loopback: false };

  const hostUrl = parseAuthority(host);
  if (!hostUrl) return { trusted: false, loopback: false };
  const loopback = isLoopbackHostname(hostUrl.url.hostname);
  const trusted =
    loopback || Boolean(options.trustedHosts?.some((item) => matchesTrustedHost(hostUrl, item)));
  if (!trusted) return { trusted: false, loopback };

  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    return { trusted: false, loopback };
  }

  const origin = request.headers.get("origin");
  if (!origin) return { trusted: true, loopback };

  const originAuthority = parseOriginAuthority(origin);
  return {
    trusted: Boolean(originAuthority && originAuthority.host === hostUrl.url.host),
    loopback,
  };
}

export function inspectConfiguredApiRequestTrust(request: ApiTrustRequest): ApiRequestTrustResult {
  return inspectApiRequestTrust(request, { trustedHosts: configuredApiTrustedHosts() });
}

function isLoopbackHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "[::1]") return true;

  const parts = hostname.split(".");
  return (
    parts.length === 4 &&
    parts[0] === "127" &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
}

/**
 * Protect native local APIs from DNS rebinding and cross-site browser calls.
 * Host is the external authority the browser contacted; request.url can be
 * rewritten internally by a framework or reverse proxy.
 */
export function isTrustedLocalApiRequest(request: ApiTrustRequest): boolean {
  const result = inspectApiRequestTrust(request);
  return result.trusted && result.loopback;
}
