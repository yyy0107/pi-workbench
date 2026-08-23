import { getExtension } from "@file-viewer/core";

/**
 * File Viewer 2.x routes renderers by filename extension. Its `type` option is
 * therefore an extension such as `jpeg`, not a MIME type such as `image/jpeg`.
 */
export function resolveFileViewerType(name: string): string {
  return getExtension(name);
}
