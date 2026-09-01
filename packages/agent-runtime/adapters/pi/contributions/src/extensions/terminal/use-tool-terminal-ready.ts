"use client";

import { useEffect, useState } from "react";

import { createRuntimeWebSocketFactory, type RuntimeWebSocket } from "@workbench/host-client";
import { terminalReconnectDelay, toolTerminalSocketPath } from "@workbench/terminal-client";
import { parseTerminalServerFrame } from "@workbench/terminal-contracts";

import { usePiRuntimeConnection } from "../../public/runtime-connection-context";

export function useToolTerminalReady(
  piSessionId: string | undefined,
  toolCallId: string,
  enabled: boolean,
): boolean {
  const [ready, setReady] = useState(false);
  const runtimeConnection = usePiRuntimeConnection();

  useEffect(() => {
    if (!enabled || !piSessionId) {
      setReady(false);
      return;
    }

    let disposed = false;
    let finished = false;
    let attempts = 0;
    let socket: RuntimeWebSocket | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    const createSocket = createRuntimeWebSocketFactory(runtimeConnection);

    const connect = () => {
      if (disposed || finished) return;
      const path = toolTerminalSocketPath(
        { sessionId: piSessionId, toolCallId },
        { observeInteraction: true },
      );
      if (!path) return;
      const nextSocket = createSocket(path);
      socket = nextSocket;
      nextSocket.onmessage = (event) => {
        if (disposed || nextSocket !== socket || typeof event.data !== "string") return;
        let value: unknown;
        try {
          value = JSON.parse(event.data);
        } catch {
          return;
        }
        const frame = parseTerminalServerFrame(value);
        if (frame?.type === "process/ready") {
          attempts = 0;
          setReady(true);
        } else if (frame?.type === "process/exited") {
          finished = true;
          setReady(false);
        }
      };
      nextSocket.onclose = () => {
        if (disposed || finished || nextSocket !== socket) return;
        setReady(false);
        attempts += 1;
        const delay = terminalReconnectDelay(attempts, {
          baseMs: 100,
          maxMs: 2_000,
          exponentCap: 5,
        });
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close(1000, "tool readiness observer closed");
    };
  }, [enabled, piSessionId, runtimeConnection, toolCallId]);

  return ready;
}
