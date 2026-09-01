const path = require("node:path");
const { pathToFileURL } = require("node:url");

const DESKTOP_RENDERER_ORIGIN = "workbench://app";
const DESKTOP_RENDERER_SCHEME = "workbench";
const DESKTOP_RENDERER_DEVELOPMENT_MARKER = 'data-workbench-desktop-renderer="1"';
const DESKTOP_RENDERER_DEVELOPMENT_HTML_MAX_BYTES = 2 * 1024 * 1024;

async function assertDesktopRendererDevelopmentResponse(response, expectedOrigin) {
  let finalUrl;
  try {
    finalUrl = new URL(response?.url);
  } catch {
    throw new Error("The development Desktop renderer response URL was invalid.");
  }
  if (
    !response.ok ||
    response.status !== 200 ||
    response.redirected === true ||
    finalUrl.origin !== expectedOrigin ||
    finalUrl.pathname !== "/" ||
    finalUrl.search ||
    finalUrl.hash ||
    response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "text/html"
  ) {
    throw new Error(
      "The development Desktop renderer did not return its canonical HTML entrypoint.",
    );
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const bytes = Number(contentLength);
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 1 ||
      bytes > DESKTOP_RENDERER_DEVELOPMENT_HTML_MAX_BYTES
    ) {
      throw new Error("The development Desktop renderer HTML size was invalid.");
    }
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The development Desktop renderer HTML body was unavailable.");
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > DESKTOP_RENDERER_DEVELOPMENT_HTML_MAX_BYTES) {
        throw new Error("The development Desktop renderer HTML exceeded its size limit.");
      }
      chunks.push(Buffer.from(chunk.value));
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  if (
    bytes === 0 ||
    !Buffer.concat(chunks).toString("utf8").includes(DESKTOP_RENDERER_DEVELOPMENT_MARKER)
  ) {
    throw new Error("The development Desktop renderer identity marker was missing.");
  }
}

function rendererResourcePath(rawUrl, rendererArtifact) {
  if (typeof rawUrl !== "string" || !rawUrl.startsWith(`${DESKTOP_RENDERER_ORIGIN}/`)) {
    return undefined;
  }
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== `${DESKTOP_RENDERER_SCHEME}:` ||
    url.hostname !== "app" ||
    url.host !== "app" ||
    url.username ||
    url.password ||
    url.port ||
    /%2f|%5c/iu.test(rawUrl)
  ) {
    return undefined;
  }
  let pathname;
  try {
    const suffix = rawUrl.slice(DESKTOP_RENDERER_ORIGIN.length);
    const pathEnd = suffix.search(/[?#]/u);
    pathname = decodeURIComponent(pathEnd === -1 ? suffix : suffix.slice(0, pathEnd));
  } catch {
    return undefined;
  }
  const segments = pathname.split("/");
  const relativePath = pathname === "/" ? rendererArtifact.manifest.entrypoint : pathname.slice(1);
  if (
    !pathname.startsWith("/") ||
    !relativePath ||
    relativePath.includes("\\") ||
    (pathname !== "/" &&
      segments.slice(1).some((segment) => !segment || segment === "." || segment === "..")) ||
    !rendererArtifact.manifest.files.some((file) => file.path === relativePath)
  ) {
    return undefined;
  }
  return path.join(rendererArtifact.artifactRoot, ...relativePath.split("/"));
}

function createDesktopRendererProtocolHandler(
  rendererArtifact,
  { fetchFile, runtimeOrigin, HeadersImpl = Headers, ResponseImpl = Response },
) {
  if (
    !rendererArtifact?.artifactRoot ||
    !rendererArtifact?.manifest ||
    typeof fetchFile !== "function" ||
    !/^http:\/\/127\.0\.0\.1:\d+$/u.test(runtimeOrigin)
  ) {
    throw new Error("An admitted Desktop renderer artifact and file fetcher are required.");
  }
  return async (request) => {
    if (request?.method !== "GET") return new ResponseImpl(null, { status: 405 });
    const resourcePath = rendererResourcePath(request.url, rendererArtifact);
    if (!resourcePath) return new ResponseImpl(null, { status: 404 });
    const response = await fetchFile(pathToFileURL(resourcePath).toString());
    const headers = new HeadersImpl(response.headers);
    const runtimeWebSocketOrigin = runtimeOrigin.replace(/^http:/u, "ws:");
    headers.set(
      "Content-Security-Policy",
      [
        "default-src 'none'",
        "base-uri 'none'",
        `connect-src ${runtimeOrigin} ${runtimeWebSocketOrigin}`,
        "font-src 'self' data:",
        "form-action 'none'",
        "frame-ancestors 'none'",
        "frame-src 'none'",
        "img-src 'self' blob: data:",
        "manifest-src 'self'",
        "media-src 'self' blob: data:",
        "object-src 'none'",
        "script-src 'self'",
        "style-src 'self'",
        "worker-src 'self' blob:",
      ].join("; "),
    );
    return new ResponseImpl(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  };
}

module.exports = {
  DESKTOP_RENDERER_DEVELOPMENT_HTML_MAX_BYTES,
  DESKTOP_RENDERER_DEVELOPMENT_MARKER,
  DESKTOP_RENDERER_ORIGIN,
  DESKTOP_RENDERER_SCHEME,
  assertDesktopRendererDevelopmentResponse,
  createDesktopRendererProtocolHandler,
  rendererResourcePath,
};
