"use client";

import { useEffect, useState } from "react";

import { parseTerminalServerFrame } from "@/runtime/terminal/contracts";

import { toolTerminalSocketUrl } from "./terminal-socket-url";

export function useToolTerminalReady(
  piSessionId: string | undefined,
  toolCallId: string,
  enabled: boolean,
): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled || !piSessionId) {
      setReady(false);
      return;
    }

    let disposed = false;
    let finished = false;
    let attempts = 0;
    let socket: WebSocket | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (disposed || finished) return;
      const url = toolTerminalSocketUrl({ piSessionId, toolCallId }, { observeInteraction: true });
      if (!url) return;
      const nextSocket = new WebSocket(url);
      socket = nextSocket;
      nextSocket.addEventListener("message", (event) => {
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
      });
      nextSocket.addEventListener("close", () => {
        if (disposed || finished || nextSocket !== socket) return;
        setReady(false);
        attempts += 1;
        const delay = Math.min(2_000, 100 * 2 ** Math.min(attempts, 5));
        reconnectTimer = setTimeout(connect, delay);
      });
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close(1000, "tool readiness observer closed");
    };
  }, [enabled, piSessionId, toolCallId]);

  return ready;
}
