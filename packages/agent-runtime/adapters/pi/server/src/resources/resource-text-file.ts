import { open } from "node:fs/promises";

const READ_CHUNK_BYTES = 64 * 1024;

export class ResourceTextFileTooLargeError extends Error {}

export class ResourceTextFileUnsupportedEncodingError extends Error {}

export async function readResourceTextFile(
  filePath: string,
  maximumBytes: number,
): Promise<{ content: string; bytes: Buffer; modifiedAt: number }> {
  const file = await open(filePath, "r");
  try {
    const metadata = await file.stat();
    if (!metadata.isFile()) throw new Error("The requested resource path is not a regular file.");
    if (metadata.size > maximumBytes) throw new ResourceTextFileTooLargeError();

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (totalBytes <= maximumBytes) {
      const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, maximumBytes + 1 - totalBytes));
      const { bytesRead } = await file.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > maximumBytes) throw new ResourceTextFileTooLargeError();
      chunks.push(buffer.subarray(0, bytesRead));
    }

    const bytes = Buffer.concat(chunks, totalBytes);
    if (bytes.includes(0)) throw new ResourceTextFileUnsupportedEncodingError();
    try {
      return {
        content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        bytes,
        modifiedAt: metadata.mtimeMs,
      };
    } catch {
      throw new ResourceTextFileUnsupportedEncodingError();
    }
  } finally {
    await file.close();
  }
}
