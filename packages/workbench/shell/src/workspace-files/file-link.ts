import type { OpenableResource, OpenerService, WorkspaceContext } from "@workbench/extension-sdk";

const WINDOWS_PATH = /^[a-z]:[\\/]/i;

/** Decode a file link without interpreting web URLs or page anchors as local paths. */
export function parseLocalFileHref(href: string): string | undefined {
  const value = href.trim();
  if (!value || /^[#?]/.test(value) || /^[\\/]{2}/.test(value)) return undefined;
  let path = value.split(/[?#]/, 1)[0];
  const fileUrl = /^file:/i.test(value);
  if (fileUrl) {
    try {
      const url = new URL(value);
      if (url.hostname && url.hostname !== "localhost") return undefined;
      path = url.pathname;
    } catch {
      return undefined;
    }
  } else if (
    /^[a-z][a-z\d+.-]*:/i.test(value) &&
    !WINDOWS_PATH.test(value) &&
    !/^[^:/\\]+\.[^:/\\]+:\d+(?::\d+)?$/.test(path)
  ) {
    return undefined;
  }
  // Strip editor locations before decoding so an encoded colon remains part of the filename.
  path = path.replace(/:\d+(?::\d+)?$/, "");
  try {
    path = decodeURIComponent(path);
  } catch {
    return undefined;
  }
  if (fileUrl && /^\/[a-z]:[\\/]/i.test(path)) path = path.slice(1);
  if (!path || /\p{Cc}/u.test(path) || /^[\\/]{2}/.test(path)) return undefined;
  return path;
}

function encodedPath(path: string): string {
  return path.replaceAll("\\", "/").split("/").map(encodeURIComponent).join("/");
}

export function fileLinkResource(href: string, rootPath?: string): OpenableResource | undefined {
  const path = parseLocalFileHref(href);
  if (!path) return undefined;
  if (/^~[\\/]/.test(path)) return { scheme: "file", path };
  const absolute = path.startsWith("/") || WINDOWS_PATH.test(path);
  if (!absolute && !rootPath) throw new Error("A relative file link requires a workspace root");
  const root = rootPath ?? "/";
  const base = `file://${root.startsWith("/") ? "" : "/"}${encodedPath(root).replace(/\/+$/, "")}/`;
  const url = new URL(`${WINDOWS_PATH.test(path) ? "/" : ""}${encodedPath(path)}`, base);
  const resolved = decodeURIComponent(url.pathname).replace(/^\/([a-z]:\/)/i, "$1");
  return { scheme: "file", path: resolved };
}

/** All file-link callers share the registered opener and its existing tab deduplication. */
export async function openFileLink(
  opener: Pick<OpenerService, "open">,
  context: WorkspaceContext,
  href: string,
) {
  const resource = fileLinkResource(href, context.rootPath);
  if (!resource) throw new Error("The link does not identify a local file");
  return opener.open({ resource, context, policy: "force-focus" });
}
