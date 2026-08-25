"use client";

import { useCallback, useEffect, useState } from "react";

import { describePiSkill } from "@/runtime/pi/client/transport/api";
import type { SkillDescribeValue } from "@/runtime/pi/rpc-contracts";

type SkillDetailsLoadState = "idle" | "loading" | "ready" | "failed";

interface SkillDetailsState {
  loadState: SkillDetailsLoadState;
  sessionId: string;
  name: string;
  value?: SkillDescribeValue;
}

export function usePiSkillDetails(sessionId: string, name: string, enabled: boolean) {
  const [state, setState] = useState<SkillDetailsState>({
    loadState: "idle",
    sessionId: "",
    name: "",
  });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setState({ loadState: "idle", sessionId, name });
      return;
    }

    let active = true;
    setState({ loadState: "loading", sessionId, name });
    void describePiSkill({ sessionId, name }).then(
      (value) => {
        if (active) setState({ loadState: "ready", sessionId, name, value });
      },
      () => {
        if (active) setState({ loadState: "failed", sessionId, name });
      },
    );

    return () => {
      active = false;
    };
  }, [enabled, name, revision, sessionId]);

  const refresh = useCallback(() => setRevision((current) => current + 1), []);
  const isCurrentSkill = state.sessionId === sessionId && state.name === name;
  return {
    loadState: isCurrentSkill ? state.loadState : enabled ? "loading" : "idle",
    refresh,
    value: isCurrentSkill ? state.value : undefined,
  } as const;
}
