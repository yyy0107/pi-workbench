"use client";

import { useEffect, useState } from "react";

import {
  parseTerminalServerFrame,
  type TerminalInteractionState,
} from "@/runtime/terminal/contracts";

import { toolTerminalSocketUrl } from "./terminal-socket-url";

export function useToolTerminalInteraction(
  piSessionId: string | undefined,
  toolCallId: string,
  enabled: boolean,
): TerminalInteractionState {
  const [state, setState] = useState<TerminalInteractionState>("none");

  useEffect(() => {
    if (!enabled || !piSessionId) {
      setState("none");
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
          setState(frame.process.interactionState);
        } else if (frame?.type === "process/state") {
          setState(frame.interactionState);
        } else if (frame?.type === "process/exited") {
          finished = true;
          setState("none");
        }
      });
      nextSocket.addEventListener("close", () => {
        if (disposed || finished || nextSocket !== socket) return;
        setState("none");
        attempts += 1;
        const delay = Math.min(2_000, 100 * 2 ** Math.min(attempts, 5));
        reconnectTimer = setTimeout(connect, delay);
      });
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close(1000, "tool interaction observer closed");
    };
  }, [enabled, piSessionId, toolCallId]);

  return state;
}
