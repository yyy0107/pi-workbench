import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest, type RequestOptions as HttpsRequestOptions } from "node:https";
import { isIP } from "node:net";

import { ImageUnderstandingProviderError, type RecognizableAttachment } from "./contracts";

export type ImageUnderstandingFetch = typeof fetch;

export interface BoundedFetchOptions {
  fetch: ImageUnderstandingFetch;
  url: string;
  init?: RequestInit;
  signal?: AbortSignal;
  timeoutMs: number;
  maxResponseBytes: number;
  /** Optional provider-specific mapper for bounded, non-success response bodies. */
  mapErrorResponse?: (response: {
    status: number;
    text: string;
  }) => ImageUnderstandingProviderError | undefined;
}

export interface PublicAddress {
  address: string;
  family: 4 | 6;
}

export type PublicAddressResolver = (hostname: string) => Promise<readonly PublicAddress[]>;

export interface ResolvedPublicHttpsTarget {
  /** The validated provider URL. This is used for the request path only, never for DNS again. */
  url: string;
  /** Original hostname used for the HTTP Host header and TLS SNI/certificate validation. */
  hostname: string;
  /** A numeric, globally routable address selected from the single validated DNS answer set. */
  address: string;
  family: 4 | 6;
  port: number;
  authority: string;
  path: string;
}

export interface PublicHttpsResponse {
  status: number;
  headers: Headers;
  body: AsyncIterable<Uint8Array>;
  cancel: () => void;
}

export type PublicHttpsTransport = (
  target: ResolvedPublicHttpsTarget,
  signal: AbortSignal,
) => Promise<PublicHttpsResponse>;

export interface BoundedPublicHttpsOptions {
  url: string;
  field: string;
  signal?: AbortSignal;
  timeoutMs: number;
  maxResponseBytes: number;
  /** Maximum number of validated HTTPS redirects. Defaults to zero. */
  maxRedirects?: number;
  /** Test seam. Production callers must leave this unset. */
  resolver?: PublicAddressResolver;
  /** Test seam. Production callers must leave this unset. */
  transport?: PublicHttpsTransport;
}

export interface BoundedAllowedHttpsOptions {
  fetch: ImageUnderstandingFetch;
  url: string;
  field: string;
  allowedHostnameSuffixes: readonly string[];
  signal?: AbortSignal;
  timeoutMs: number;
  maxResponseBytes: number;
  /** Maximum number of independently validated HTTPS redirects. Defaults to zero. */
  maxRedirects?: number;
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function requirePositiveInteger(value: number, field: string): number {
  if (!positiveInteger(value)) {
    throw new TypeError(`${field} must be a positive integer.`);
  }
  return value;
}

export function requireHttpUrl(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${field} must be an HTTP URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(`${field} must be an HTTP URL.`);
  }
  if (url.username || url.password) {
    throw new TypeError(`${field} must not contain credentials.`);
  }
  return url.toString();
}

export function requireHttpsUrl(value: string, field: string): string {
  const url = requireHttpUrl(value, field);
  if (new URL(url).protocol !== "https:") {
    throw new TypeError(`${field} must use HTTPS.`);
  }
  return url;
}

function normalizedHostname(value: string): string {
  return value
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
}

function allowedHostname(hostname: string, suffixes: readonly string[]): boolean {
  return suffixes.some((candidate) => {
    const suffix = normalizedHostname(candidate).replace(/^\.+/, "");
    return suffix.length > 0 && (hostname === suffix || hostname.endsWith(`.${suffix}`));
  });
}

/** Returns true only for credential-free HTTPS URLs on port 443 in an explicit host namespace. */
export function matchesAllowedHttpsHostname(
  value: string,
  allowedHostnameSuffixes: readonly string[],
): boolean {
  try {
    const parsed = new URL(requireHttpsUrl(value, "url"));
    const hostname = normalizedHostname(parsed.hostname);
    return (
      isIP(hostname) === 0 &&
      (!parsed.port || parsed.port === "443") &&
      allowedHostname(hostname, allowedHostnameSuffixes)
    );
  } catch {
    return false;
  }
}

class AllowedHttpsUrlError extends TypeError {}

function requireAllowedHttpsUrl(
  value: string,
  field: string,
  allowedHostnameSuffixes: readonly string[],
): string {
  let normalized: string;
  try {
    normalized = requireHttpsUrl(value, field);
  } catch (error) {
    throw new AllowedHttpsUrlError(error instanceof Error ? error.message : `${field} is invalid.`);
  }
  const parsed = new URL(normalized);
  const hostname = normalizedHostname(parsed.hostname);
  if (
    isIP(hostname) !== 0 ||
    (parsed.port && parsed.port !== "443") ||
    !allowedHostname(hostname, allowedHostnameSuffixes)
  ) {
    throw new AllowedHttpsUrlError(`${field} must use an allowed HTTPS hostname.`);
  }
  parsed.hash = "";
  return parsed.toString();
}

function ipv4Number(address: string): number | undefined {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return undefined;
  }
  const [first, second, third, fourth] = octets as [number, number, number, number];
  return ((first * 256 + second) * 256 + third) * 256 + fourth;
}

function inIpv4Cidr(value: number, network: number, prefix: number): boolean {
  const blockSize = 2 ** (32 - prefix);
  return Math.floor(value / blockSize) === Math.floor(network / blockSize);
}

function publicIpv4(address: string): boolean {
  const value = ipv4Number(address);
  if (value === undefined) return false;
  const blocked = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.31.196.0", 24],
    ["192.52.193.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["192.175.48.0", 24],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ] as const;
  return !blocked.some(([network, prefix]) => inIpv4Cidr(value, ipv4Number(network)!, prefix));
}

function ipv6Words(address: string): number[] | undefined {
  if (isIP(address) !== 6) return undefined;
  let normalized = address.toLowerCase();
  if (normalized.includes(".")) {
    const separator = normalized.lastIndexOf(":");
    const embedded = ipv4Number(normalized.slice(separator + 1));
    if (separator < 0 || embedded === undefined) return undefined;
    normalized = `${normalized.slice(0, separator)}:${Math.floor(embedded / 65_536).toString(16)}:${(
      embedded % 65_536
    ).toString(16)}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) {
    return undefined;
  }
  const words = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (words.length !== 8 || words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) {
    return undefined;
  }
  return words.map((word) => Number.parseInt(word, 16));
}

function publicIpv6(address: string): boolean {
  const words = ipv6Words(address);
  if (words === undefined) return false;

  // IPv4-mapped IPv6 addresses must be classified using their embedded IPv4 address.
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    const high = words[6]!;
    const low = words[7]!;
    return publicIpv4(`${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`);
  }

  // Only global-unicast IPv6 is eligible. Exclude special/documentation ranges inside 2000::/3.
  const [first, second] = words as [number, number, ...number[]];
  if (first < 0x2000 || first >= 0x4000) return false;
  if (first === 0x2001 && second <= 0x01ff) return false; // 2001:0000::/23 special-purpose.
  if (first === 0x2001 && second === 0x0db8) return false; // 2001:db8::/32 documentation.
  if (first === 0x2002) return false; // 6to4 can encode non-public IPv4.
  if (first === 0x3fff && second < 0x1000) return false; // 3fff::/20 documentation.
  return true;
}

function publicIpAddress(address: string): address is string {
  const family = isIP(address);
  return family === 4 ? publicIpv4(address) : family === 6 ? publicIpv6(address) : false;
}

/** Rejects provider-controlled result URLs that directly target non-public hosts. */
export function requirePublicHttpsUrl(value: string, field: string): string {
  const normalized = requireHttpsUrl(value, field);
  const parsed = new URL(normalized);
  const hostname = parsed.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
  const family = isIP(hostname);
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    (family !== 0 && !publicIpAddress(hostname))
  ) {
    throw new TypeError(`${field} must use a public HTTPS host.`);
  }
  return normalized;
}

const defaultPublicAddressResolver: PublicAddressResolver = async (hostname) => {
  const answers = await dnsLookup(hostname, { all: true, verbatim: true });
  return answers.flatMap((answer) =>
    answer.family === 4 || answer.family === 6
      ? [{ address: answer.address, family: answer.family }]
      : [],
  );
};

class PublicHttpsAbortError extends Error {}

function interruptible<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new PublicHttpsAbortError());
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new PublicHttpsAbortError());
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export async function resolvePublicHttpsTarget(
  value: string,
  field: string,
  resolver: PublicAddressResolver = defaultPublicAddressResolver,
  signal?: AbortSignal,
): Promise<ResolvedPublicHttpsTarget> {
  const normalized = requirePublicHttpsUrl(value, field);
  const parsed = new URL(normalized);
  const hostname = parsed.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
  const literalFamily = isIP(hostname);
  const pendingAnswers: Promise<readonly PublicAddress[]> =
    literalFamily === 4 || literalFamily === 6
      ? Promise.resolve([{ address: hostname, family: literalFamily }])
      : resolver(hostname);
  const answers = signal ? await interruptible(pendingAnswers, signal) : await pendingAnswers;
  if (answers.length === 0) {
    throw new ImageUnderstandingProviderError("provider-network-error", { retryable: true });
  }

  const normalizedAnswers = answers.map((answer) => ({
    address: answer.address.replace(/^\[|\]$/g, "").toLowerCase(),
    family: answer.family,
  }));
  if (
    normalizedAnswers.some(
      (answer) => isIP(answer.address) !== answer.family || !publicIpAddress(answer.address),
    )
  ) {
    // Reject the complete answer set if any address is unsafe; selecting only a safe member would
    // make split-horizon/mixed-answer rebinding behavior dependent on connection ordering.
    throw new TypeError(`${field} must resolve only to public IP addresses.`);
  }

  const selected = normalizedAnswers[0]!;
  const port = parsed.port ? Number(parsed.port) : 443;
  return {
    url: normalized,
    hostname,
    address: selected.address,
    family: selected.family,
    port,
    authority: parsed.host,
    path: `${parsed.pathname}${parsed.search}`,
  };
}

function headersFromNode(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item);
    } else if (value !== undefined) {
      result.set(name, value);
    }
  }
  return result;
}

const defaultPublicHttpsTransport: PublicHttpsTransport = (target, signal) =>
  new Promise((resolve, reject) => {
    const requestOptions: HttpsRequestOptions = {
      protocol: "https:",
      hostname: target.address,
      family: target.family,
      port: target.port,
      method: "GET",
      path: target.path,
      headers: { Host: target.authority },
      // Keep certificate validation bound to the original URL hostname while connecting to the
      // numeric address. Supplying a numeric `hostname` prevents a second DNS lookup/rebinding.
      servername: isIP(target.hostname) === 0 ? target.hostname : undefined,
    };
    const request = httpsRequest(requestOptions, (response) => {
      const abortResponse = () => response.destroy(new PublicHttpsAbortError());
      const removeAbortResponse = () => signal.removeEventListener("abort", abortResponse);
      signal.addEventListener("abort", abortResponse, { once: true });
      response.once("close", removeAbortResponse);
      response.once("end", removeAbortResponse);
      resolve({
        status: response.statusCode ?? 0,
        headers: headersFromNode(response.headers),
        body: response,
        cancel: () => response.destroy(),
      });
    });
    const abort = () => request.destroy(new PublicHttpsAbortError());
    signal.addEventListener("abort", abort, { once: true });
    request.once("close", () => signal.removeEventListener("abort", abort));
    request.once("error", reject);
    request.end();
  });

async function readBoundedPublicHttpsBody(
  response: PublicHttpsResponse,
  maximum: number,
  signal: AbortSignal,
): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (Number.isFinite(parsed) && parsed > maximum) {
      response.cancel();
      throw new ImageUnderstandingProviderError("provider-response-too-large");
    }
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const rawChunk of response.body) {
    if (signal.aborted) {
      response.cancel();
      throw new PublicHttpsAbortError();
    }
    const chunk = rawChunk instanceof Uint8Array ? rawChunk : new Uint8Array(rawChunk);
    total += chunk.byteLength;
    if (total > maximum) {
      response.cancel();
      throw new ImageUnderstandingProviderError("provider-response-too-large");
    }
    chunks.push(chunk);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Downloads a provider-controlled HTTPS URL through a validated, pinned public IP address.
 * Redirects are bounded and every hop is independently HTTPS/DNS/public-IP validated and pinned.
 * The complete chain remains subject to one timeout, cancellation, status mapping, and byte limit.
 */
export async function boundedPublicHttpsText(options: BoundedPublicHttpsOptions): Promise<string> {
  requirePositiveInteger(options.timeoutMs, "timeoutMs");
  requirePositiveInteger(options.maxResponseBytes, "maxResponseBytes");
  const maxRedirects = options.maxRedirects ?? 0;
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 10) {
    throw new TypeError("maxRedirects must be an integer between 0 and 10.");
  }
  if (options.signal?.aborted) {
    throw new ImageUnderstandingProviderError("provider-aborted");
  }

  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);

  try {
    let currentUrl = options.url;
    for (let redirectCount = 0; ; redirectCount += 1) {
      const target = await resolvePublicHttpsTarget(
        currentUrl,
        options.field,
        options.resolver,
        controller.signal,
      );
      const response = await interruptible(
        (options.transport ?? defaultPublicHttpsTransport)(target, controller.signal),
        controller.signal,
      );
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        response.cancel();
        if (!location || redirectCount >= maxRedirects) {
          throw new ImageUnderstandingProviderError("provider-invalid-response", {
            status: response.status,
          });
        }
        try {
          currentUrl = new URL(location, currentUrl).toString();
        } catch {
          throw new ImageUnderstandingProviderError("provider-invalid-response", {
            status: response.status,
          });
        }
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        response.cancel();
        throw errorForStatus(response.status);
      }
      try {
        return await interruptible(
          readBoundedPublicHttpsBody(response, options.maxResponseBytes, controller.signal),
          controller.signal,
        );
      } catch (error) {
        if (error instanceof PublicHttpsAbortError) response.cancel();
        throw error;
      }
    }
  } catch (error) {
    if (error instanceof TypeError || error instanceof ImageUnderstandingProviderError) throw error;
    if (options.signal?.aborted) {
      throw new ImageUnderstandingProviderError("provider-aborted");
    }
    if (timedOut || error instanceof PublicHttpsAbortError) {
      throw new ImageUnderstandingProviderError("provider-timeout", { retryable: true });
    }
    throw new ImageUnderstandingProviderError("provider-network-error", { retryable: true });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

function canonicalBase64(value: string): boolean {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    return false;
  }
  try {
    return Buffer.from(value, "base64").toString("base64") === value;
  } catch {
    return false;
  }
}

function isRecognizableMediaType(value: string): boolean {
  return value.startsWith("image/") || value === "application/pdf";
}

export function attachmentDataUrl(attachment: RecognizableAttachment): string {
  if (attachment.data.startsWith("data:")) {
    const matched = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(attachment.data);
    if (
      !matched ||
      !isRecognizableMediaType(matched[1] ?? "") ||
      matched[1] !== attachment.mimeType ||
      !canonicalBase64(matched[2]!)
    ) {
      throw new ImageUnderstandingProviderError("provider-invalid-input");
    }
    return attachment.data;
  }
  if (!canonicalBase64(attachment.data) || !isRecognizableMediaType(attachment.mimeType)) {
    throw new ImageUnderstandingProviderError("provider-invalid-input");
  }
  return `data:${attachment.mimeType};base64,${attachment.data}`;
}

export function attachmentBytes(attachment: RecognizableAttachment): Uint8Array {
  const dataUrl = attachmentDataUrl(attachment);
  const separator = dataUrl.indexOf(",");
  return Buffer.from(dataUrl.slice(separator + 1), "base64");
}

function errorForStatus(status: number): ImageUnderstandingProviderError {
  if (status === 401 || status === 403) {
    return new ImageUnderstandingProviderError("provider-authentication-failed", { status });
  }
  if (status === 429) {
    return new ImageUnderstandingProviderError("provider-rate-limited", {
      retryable: true,
      status,
    });
  }
  if (status >= 500) {
    return new ImageUnderstandingProviderError("provider-unavailable", {
      retryable: true,
      status,
    });
  }
  return new ImageUnderstandingProviderError("provider-invalid-response", { status });
}

async function readBoundedBody(response: Response, maximum: number): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (Number.isFinite(parsed) && parsed > maximum) {
      await response.body?.cancel().catch(() => undefined);
      throw new ImageUnderstandingProviderError("provider-response-too-large");
    }
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel().catch(() => undefined);
        throw new ImageUnderstandingProviderError("provider-response-too-large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function boundedFetchText(options: BoundedFetchOptions): Promise<string> {
  requirePositiveInteger(options.timeoutMs, "timeoutMs");
  requirePositiveInteger(options.maxResponseBytes, "maxResponseBytes");

  if (options.signal?.aborted) {
    throw new ImageUnderstandingProviderError("provider-aborted");
  }

  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);

  try {
    const response = await options.fetch(options.url, {
      ...options.init,
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      if (options.mapErrorResponse) {
        const text = await readBoundedBody(response, options.maxResponseBytes);
        const mapped = options.mapErrorResponse({ status: response.status, text });
        if (mapped) throw mapped;
      } else {
        await response.body?.cancel().catch(() => undefined);
      }
      throw errorForStatus(response.status);
    }
    return await readBoundedBody(response, options.maxResponseBytes);
  } catch (error) {
    if (error instanceof ImageUnderstandingProviderError) throw error;
    if (options.signal?.aborted) {
      throw new ImageUnderstandingProviderError("provider-aborted");
    }
    if (timedOut) {
      throw new ImageUnderstandingProviderError("provider-timeout", { retryable: true });
    }
    throw new ImageUnderstandingProviderError("provider-network-error", { retryable: true });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

/**
 * Downloads from an explicit HTTPS host namespace through the environment's native fetch stack.
 * This is reserved for trusted provider storage domains whose DNS may intentionally resolve to a
 * local proxy address. Every redirect remains inside the same allowlist; arbitrary result hosts
 * must continue to use `boundedPublicHttpsText` and its DNS-pinned transport.
 */
export async function boundedAllowedHttpsText(
  options: BoundedAllowedHttpsOptions,
): Promise<string> {
  requirePositiveInteger(options.timeoutMs, "timeoutMs");
  requirePositiveInteger(options.maxResponseBytes, "maxResponseBytes");
  const maxRedirects = options.maxRedirects ?? 0;
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 10) {
    throw new TypeError("maxRedirects must be an integer between 0 and 10.");
  }
  if (options.allowedHostnameSuffixes.length === 0) {
    throw new TypeError("allowedHostnameSuffixes must not be empty.");
  }
  if (options.signal?.aborted) {
    throw new ImageUnderstandingProviderError("provider-aborted");
  }

  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);

  try {
    let currentUrl = requireAllowedHttpsUrl(
      options.url,
      options.field,
      options.allowedHostnameSuffixes,
    );
    for (let redirectCount = 0; ; redirectCount += 1) {
      const response = await options.fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location || redirectCount >= maxRedirects) {
          throw new ImageUnderstandingProviderError("provider-invalid-response", {
            status: response.status,
          });
        }
        let redirected: string;
        try {
          redirected = new URL(location, currentUrl).toString();
        } catch {
          throw new AllowedHttpsUrlError(`${options.field} redirect is invalid.`);
        }
        currentUrl = requireAllowedHttpsUrl(
          redirected,
          options.field,
          options.allowedHostnameSuffixes,
        );
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw errorForStatus(response.status);
      }
      return await readBoundedBody(response, options.maxResponseBytes);
    }
  } catch (error) {
    if (error instanceof ImageUnderstandingProviderError) throw error;
    if (error instanceof AllowedHttpsUrlError) throw new TypeError(error.message);
    if (options.signal?.aborted) {
      throw new ImageUnderstandingProviderError("provider-aborted");
    }
    if (timedOut || (error instanceof Error && error.name === "AbortError")) {
      throw new ImageUnderstandingProviderError("provider-timeout", { retryable: true });
    }
    throw new ImageUnderstandingProviderError("provider-network-error", { retryable: true });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

export function parseJsonObject(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ImageUnderstandingProviderError("provider-invalid-response");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ImageUnderstandingProviderError("provider-invalid-response");
  }
  return parsed as Record<string, unknown>;
}
