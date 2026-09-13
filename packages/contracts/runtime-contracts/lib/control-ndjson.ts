import { isUtf8 } from "node:buffer";

/** Shared ceiling for local control channels. The trailing LF is not counted as frame content. */
export const CONTROL_NDJSON_MAX_FRAME_BYTES = 64 * 1024;

export const ControlNdjsonDecodeErrorCode = Object.freeze({
  frameTooLarge: "frame-too-large",
  invalidEncoding: "invalid-encoding",
  invalidJson: "invalid-json",
  incompleteFrame: "incomplete-frame",
} as const);

export type ControlNdjsonDecodeErrorCode =
  (typeof ControlNdjsonDecodeErrorCode)[keyof typeof ControlNdjsonDecodeErrorCode];

export class ControlNdjsonDecodeError extends Error {
  readonly code: ControlNdjsonDecodeErrorCode;

  constructor(code: ControlNdjsonDecodeErrorCode) {
    super("Invalid control NDJSON input.");
    this.name = "ControlNdjsonDecodeError";
    this.code = code;
  }
}

export interface ControlNdjsonDecoderOptions {
  readonly maximumFrameBytes?: number;
  readonly createError?: (code: ControlNdjsonDecodeErrorCode) => Error;
}

/**
 * A byte-bounded, fatal-UTF-8 NDJSON decoder. Every accepted record ends in LF.
 * Consumers may supply an error factory to keep a protocol's established public error API.
 */
export class ControlNdjsonDecoder {
  #pending = Buffer.alloc(0);
  #finished = false;
  readonly #maximumFrameBytes: number;
  readonly #createError: (code: ControlNdjsonDecodeErrorCode) => Error;

  constructor({
    maximumFrameBytes = CONTROL_NDJSON_MAX_FRAME_BYTES,
    createError = (code) => new ControlNdjsonDecodeError(code),
  }: ControlNdjsonDecoderOptions = {}) {
    if (
      !Number.isSafeInteger(maximumFrameBytes) ||
      maximumFrameBytes < 1 ||
      maximumFrameBytes > 16 * 1024 * 1024
    ) {
      throw new RangeError("Control NDJSON maximum frame size is invalid.");
    }
    this.#maximumFrameBytes = maximumFrameBytes;
    this.#createError = createError;
  }

  push(chunk: Uint8Array): readonly unknown[] {
    if (this.#finished) throw new Error("Control NDJSON decoder is already finished.");
    let remaining = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    const records: unknown[] = [];

    while (remaining.length > 0) {
      const newline = remaining.indexOf(0x0a);
      if (newline < 0) {
        if (this.#pending.length + remaining.length > this.#maximumFrameBytes) {
          throw this.#createError(ControlNdjsonDecodeErrorCode.frameTooLarge);
        }
        this.#pending = Buffer.concat([this.#pending, remaining]);
        break;
      }

      const segment = remaining.subarray(0, newline);
      if (this.#pending.length + segment.length > this.#maximumFrameBytes) {
        throw this.#createError(ControlNdjsonDecodeErrorCode.frameTooLarge);
      }
      const line = this.#pending.length === 0 ? segment : Buffer.concat([this.#pending, segment]);
      this.#pending = Buffer.alloc(0);
      remaining = remaining.subarray(newline + 1);

      if (!isUtf8(line)) {
        throw this.#createError(ControlNdjsonDecodeErrorCode.invalidEncoding);
      }
      try {
        records.push(JSON.parse(line.toString("utf8")) as unknown);
      } catch {
        throw this.#createError(ControlNdjsonDecodeErrorCode.invalidJson);
      }
    }

    return records;
  }

  finish(): void {
    if (this.#finished) return;
    this.#finished = true;
    if (this.#pending.length > 0) {
      throw this.#createError(ControlNdjsonDecodeErrorCode.incompleteFrame);
    }
  }
}

export function encodeControlNdjsonFrame(
  frame: unknown,
  maximumFrameBytes = CONTROL_NDJSON_MAX_FRAME_BYTES,
): string {
  const encoded = `${JSON.stringify(frame)}\n`;
  if (Buffer.byteLength(encoded) > maximumFrameBytes + 1) {
    throw new Error("Control NDJSON frame exceeds the maximum size.");
  }
  return encoded;
}
