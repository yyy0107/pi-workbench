import { getExtension } from "@file-viewer/core";

const FILE_VIEWER_VIDEO_TYPES = new Set(["m3u8", "mp4", "webm"]);

/**
 * File Viewer 2.x routes renderers by filename extension. Its `type` option is
 * therefore an extension such as `jpeg`, not a MIME type such as `image/jpeg`.
 */
export function resolveFileViewerType(name: string): string {
  return getExtension(name);
}

export function isFileViewerVideoType(type: string): boolean {
  return FILE_VIEWER_VIDEO_TYPES.has(type.trim().toLowerCase());
}
