import type { TerminalOutputDelta } from "@workbench/terminal-contracts";

export interface TerminalProcessReplay {
  data: string;
  sequence: number;
  outputBytes: number;
  outputCapReached: boolean;
}

interface RetainedChunk {
  data: string;
  bytes: number;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/**
 * Keeps the bounded reconnect transcript while reporting the lifetime output count separately.
 * Live subscribers always receive every delta; `outputCapReached` means only replay history rolled.
 */
export class TerminalProcessBuffer {
  readonly #processHandle: string;
  readonly #outputBytesCap: number;
  readonly #chunks: RetainedChunk[] = [];
  #retainedBytes = 0;
  #outputBytes = 0;
  #sequence = 0;
  #outputCapReached = false;

  constructor(processHandle: string, outputBytesCap: number) {
    if (!Number.isInteger(outputBytesCap) || outputBytesCap < 1) {
      throw new RangeError("outputBytesCap must be a positive integer.");
    }
    this.#processHandle = processHandle;
    this.#outputBytesCap = outputBytesCap;
  }

  get outputBytes(): number {
    return this.#outputBytes;
  }

  get outputBytesCap(): number {
    return this.#outputBytesCap;
  }

  get outputCapReached(): boolean {
    return this.#outputCapReached;
  }

  append(data: string): TerminalOutputDelta | undefined {
    if (!data) return undefined;
    const bytes = byteLength(data);
    this.#sequence += 1;
    this.#outputBytes += bytes;
    this.#chunks.push({ data, bytes });
    this.#retainedBytes += bytes;
    while (this.#retainedBytes > this.#outputBytesCap && this.#chunks.length > 0) {
      const removed = this.#chunks.shift();
      if (removed) this.#retainedBytes -= removed.bytes;
      this.#outputCapReached = true;
    }
    return {
      processHandle: this.#processHandle,
      sequence: this.#sequence,
      stream: "terminal",
      data,
      outputBytes: this.#outputBytes,
      outputCapReached: this.#outputCapReached,
    };
  }

  replay(): TerminalProcessReplay {
    return {
      data: this.#chunks.map((chunk) => chunk.data).join(""),
      sequence: this.#sequence,
      outputBytes: this.#outputBytes,
      outputCapReached: this.#outputCapReached,
    };
  }
}
