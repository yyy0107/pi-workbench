"use client";

import { useCallback, useEffect, useState } from "react";

import { describePiSkill } from "@/runtime/pi/client/transport/api";
import type { PiResourceCatalogTarget, SkillDescribeValue } from "@/runtime/pi/contracts/rpc";

type SkillDetailsLoadState = "idle" | "loading" | "ready" | "failed";

interface SkillDetailsState {
  loadState: SkillDetailsLoadState;
  targetKey: string;
  name: string;
  value?: SkillDescribeValue;
}

function resourceTargetKey(target: PiResourceCatalogTarget | undefined): string {
  if (!target) return "";
  return target.scope === "user" ? "user" : `project:${target.workspaceId}`;
}

export function usePiSkillDetails(
  target: PiResourceCatalogTarget | undefined,
  name: string,
  enabled: boolean,
) {
  const targetKey = resourceTargetKey(target);
  const [state, setState] = useState<SkillDetailsState>({
    loadState: "idle",
    targetKey: "",
    name: "",
  });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setState({ loadState: "idle", targetKey, name });
      return;
    }
    if (!target) return;

    let active = true;
    setState({ loadState: "loading", targetKey, name });
    void describePiSkill({ target, name }).then(
      (value) => {
        if (active) setState({ loadState: "ready", targetKey, name, value });
      },
      () => {
        if (active) setState({ loadState: "failed", targetKey, name });
      },
    );

    return () => {
      active = false;
    };
  }, [enabled, name, revision, target, targetKey]);

  const refresh = useCallback(() => setRevision((current) => current + 1), []);
  const isCurrentSkill = state.targetKey === targetKey && state.name === name;
  return {
    loadState: isCurrentSkill ? state.loadState : enabled ? "loading" : "idle",
    refresh,
    value: isCurrentSkill ? state.value : undefined,
  } as const;
}
