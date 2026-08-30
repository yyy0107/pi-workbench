"use client";

import { useEffect, useMemo } from "react";

import { useRightWorkspaceState } from "@/components/right-workspace";
import { usePiSideChatClient } from "@/workbench/runtime-contributions/pi/client/side-chat";

import { retainScratchSession } from "./scratch-session-lease";
import { SIDE_CHAT_SURFACE_KIND, type SideChatSurfaceParams } from "./side-chat-workspace";

/** Keep scratch leases aligned with stored Surface instances, not their current scope visibility. */
export function SideChatRuntimeBridge() {
  const manager = usePiSideChatClient();
  const signature = useRightWorkspaceState((state) =>
    JSON.stringify(
      [
        ...new Set(
          state.surfaceOrder.flatMap((surfaceId) => {
            const surface = state.surfaces[surfaceId];
            if (surface?.kind !== SIDE_CHAT_SURFACE_KIND) return [];
            const params = surface.params as SideChatSurfaceParams;
            return typeof params.scratchSessionId === "string" &&
              typeof params.sourceSessionId === "string" &&
              typeof params.expiresAt === "number"
              ? [
                  JSON.stringify({
                    sessionId: params.scratchSessionId,
                    sourceSessionId: params.sourceSessionId,
                    expiresAt: params.expiresAt,
                  }),
                ]
              : [];
          }),
        ),
      ].sort(),
    ),
  );
  const stableScratchSessions = useMemo(
    () =>
      (JSON.parse(signature) as string[]).map(
        (serialized) =>
          JSON.parse(serialized) as {
            sessionId: string;
            sourceSessionId: string;
            expiresAt: number;
          },
      ),
    [signature],
  );

  useEffect(() => {
    const releases = stableScratchSessions.map((scratch) => {
      manager.restoreScratchSession(scratch);
      return retainScratchSession(manager, scratch.sessionId);
    });
    return () => {
      for (const release of releases) release();
    };
  }, [manager, stableScratchSessions]);

  return null;
}
