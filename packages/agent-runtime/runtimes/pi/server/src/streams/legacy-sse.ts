import type { PiEvent } from "@workbench/agent-runtime-pi-protocol/messages";
import {
  getOrStartSession,
  getRunningSessionIds,
  subscribeRunningSessions,
} from "../sessions/session-registry";

const HEARTBEAT_INTERVAL_MS = 30_000;

function sseResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function createSessionEventResponse(request: Request, sessionId: string) {
  const host = await getOrStartSession(sessionId);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const buffered: PiEvent[] = [];
      let ready = false;
      let closed = false;

      const send = (event: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          cleanup();
        }
      };
      const unsubscribe = host.subscribe((event) => {
        if (ready) send(event);
        else buffered.push(event);
      });
      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(":\n\n"));
      }, HEARTBEAT_INTERVAL_MS);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        request.signal.removeEventListener("abort", cleanup);
        try {
          controller.close();
        } catch {
          // The transport may already be closed by the client.
        }
      };

      const sequence = host.currentSequence;
      const streamingMessage = host.streamingMessage;
      send({
        type: "connected",
        sessionId,
        isRunning: host.isRunning,
        steering: host.steeringMessages,
        followUp: host.followUpMessages,
        queuePaused: host.queuePaused,
        sequence,
      });
      if (streamingMessage) {
        send({ type: "message_start", message: streamingMessage, sequence });
      }
      ready = true;
      for (const event of buffered) {
        if (event.sequence === undefined || event.sequence > sequence) send(event);
      }
      request.signal.addEventListener("abort", cleanup, { once: true });
      if (request.signal.aborted) cleanup();
    },
  });

  return sseResponse(stream);
}

export function createRunningEventResponse(request: Request) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const buffered: string[][] = [];
      let ready = false;
      let closed = false;

      const send = (ids: string[]) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "running", runningSessionIds: ids })}\n\n`,
          ),
        );
      };
      const unsubscribe = subscribeRunningSessions((ids) => {
        if (ready) send(ids);
        else buffered.push(ids);
      });
      send(getRunningSessionIds());
      ready = true;
      for (const ids of buffered) send(ids);

      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(":\n\n"));
      }, HEARTBEAT_INTERVAL_MS);
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        request.signal.removeEventListener("abort", cleanup);
        try {
          controller.close();
        } catch {
          // The transport may already be closed by the client.
        }
      };
      request.signal.addEventListener("abort", cleanup, { once: true });
      if (request.signal.aborted) cleanup();
    },
  });

  return sseResponse(stream);
}
