import {
  RpcClientError,
  resolveRuntimeFetch,
  type RpcCallOptions,
} from "@workbench/host-client/rpc";
import type { RuntimeFetch } from "@workbench/host-client";

/**
 * Read a binary preview through the installation-bound HTTP carrier. Desktop sidecars cannot use
 * a bare `<img src="/api/...">` because that request cannot carry the in-memory Bearer token.
 */
export async function fetchFileContent(url: string, options?: RpcCallOptions): Promise<Blob> {
  const response = await resolveRuntimeFetch(options?.transport)(url, {
    headers: { Accept: "*/*" },
    signal: options?.signal,
  });
  if (!response.ok) throw new RpcClientError("workspace_file_content_failed", response.status);
  return response.blob();
}

export interface FileTextChunk {
  text: string;
  loadedBytes: number;
  totalBytes?: number;
}

export interface StreamFileTextOptions {
  signal?: AbortSignal;
  onChunk(chunk: FileTextChunk): void;
  /** Directs this file-content request to one explicit Runtime Host. */
  transport?: RuntimeFetch;
}

function contentLength(response: Response): number | undefined {
  const header = response.headers.get("content-length");
  if (header === null) return undefined;
  const value = Number(header);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function decodeFileText(decoder: TextDecoder, value?: Uint8Array, stream = false): string {
  try {
    return value ? decoder.decode(value, { stream }) : decoder.decode();
  } catch {
    throw new RpcClientError("workspace-file-unsupported-encoding", 422);
  }
}

export async function streamFileText(
  url: string,
  { signal, onChunk, transport }: StreamFileTextOptions,
): Promise<{ loadedBytes: number; totalBytes?: number }> {
  const response = await resolveRuntimeFetch(transport)(url, {
    headers: { Accept: "text/plain, text/*;q=0.9, application/json;q=0.8, */*;q=0.1" },
    signal,
  });
  if (!response.ok) {
    throw new RpcClientError("workspace_file_content_failed", response.status);
  }

  const totalBytes = contentLength(response);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const reader = response.body?.getReader();
  if (!reader) throw new RpcClientError("workspace_file_content_unavailable", response.status);

  let loadedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      if (value.includes(0)) {
        throw new RpcClientError("workspace-file-unsupported-encoding", 422);
      }
      loadedBytes += value.byteLength;
      const text = decodeFileText(decoder, value, true);
      onChunk({ text, loadedBytes, ...(totalBytes === undefined ? {} : { totalBytes }) });
    }
    const text = decodeFileText(decoder);
    if (text) {
      onChunk({ text, loadedBytes, ...(totalBytes === undefined ? {} : { totalBytes }) });
    }
  } catch (error) {
    if (error instanceof RpcClientError || signal?.aborted) throw error;
    throw new RpcClientError("workspace_file_content_failed", response.status);
  } finally {
    reader.releaseLock();
  }

  return { loadedBytes, ...(totalBytes === undefined ? {} : { totalBytes }) };
}
