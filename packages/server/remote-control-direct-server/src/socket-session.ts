import { remoteUtf8ByteLength } from "@workbench/remote-control-contracts/codecs";

import { DirectGatewayError } from "./errors.ts";
import { DIRECT_SERVER_LIMITS } from "./lib/limits.ts";
import type { DirectSocketPort, Disposable } from "./ports.ts";

export interface BoundedDirectSocketSession extends Disposable {
  readonly closed: boolean;
  send(value: unknown): Promise<void>;
  finish(reason: "pairing_complete" | "pairing_denied"): void;
  close(reason?: "authentication_failed" | "invalid_frame" | "listener_disabled"): void;
}

export function createBoundedDirectSocketSession(input: {
  readonly socket: DirectSocketPort;
  readonly maximumFrameBytes: number;
  readonly maximumFrames: number;
  readonly firstFrameTimeoutMs?: number;
  readonly onFrame: (value: unknown, session: BoundedDirectSocketSession) => void | Promise<void>;
  readonly onClose?: () => void;
}): BoundedDirectSocketSession {
  let closed = false;
  let frameCount = 0;
  let processing = Promise.resolve();
  const subscriptions: Disposable[] = [];
  const timeout = setTimeout(
    () => close("authentication_failed"),
    input.firstFrameTimeoutMs ?? DIRECT_SERVER_LIMITS.firstFrameTimeoutMs,
  );
  timeout.unref?.();

  const cleanup = (): void => {
    clearTimeout(timeout);
    while (subscriptions.length > 0) subscriptions.pop()?.dispose();
  };
  const close = (
    reason: "authentication_failed" | "invalid_frame" | "listener_disabled" = "invalid_frame",
  ): void => {
    if (closed) return;
    closed = true;
    cleanup();
    input.socket.close(1008, reason);
    input.onClose?.();
  };
  const session: BoundedDirectSocketSession = {
    get closed() {
      return closed;
    },
    async send(value): Promise<void> {
      if (closed) throw new DirectGatewayError("listener_disabled");
      const frame = JSON.stringify(value);
      if (remoteUtf8ByteLength(frame) > input.maximumFrameBytes) {
        close("invalid_frame");
        throw new DirectGatewayError("payload_too_large");
      }
      await input.socket.send(frame);
    },
    close,
    finish(reason): void {
      if (closed) return;
      closed = true;
      cleanup();
      input.socket.close(1000, reason);
      input.onClose?.();
    },
    dispose(): void {
      close("listener_disabled");
    },
  };
  subscriptions.push(
    input.socket.onMessage((frame) => {
      if (closed) return;
      frameCount += 1;
      if (
        frameCount > input.maximumFrames ||
        typeof frame !== "string" ||
        remoteUtf8ByteLength(frame) > input.maximumFrameBytes
      ) {
        close("invalid_frame");
        return;
      }
      if (frameCount === 1) clearTimeout(timeout);
      processing = processing
        .then(async () => {
          let value: unknown;
          try {
            value = JSON.parse(frame) as unknown;
          } catch {
            close("invalid_frame");
            return;
          }
          await input.onFrame(value, session);
        })
        .catch(() => close("invalid_frame"));
    }),
    input.socket.onClose(() => {
      if (closed) return;
      closed = true;
      cleanup();
      input.onClose?.();
    }),
  );
  return session;
}
