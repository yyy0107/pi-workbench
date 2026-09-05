"use client";

import { Maximize2Icon, Minimize2Icon } from "lucide-react";
import { useMemo } from "react";

import { Button } from "../../ui/button";
import { useI18n } from "../../i18n";
import { SlotHost } from "@workbench/extension-host/hosts/slot-host";
import { selectActiveSurface, selectContextSurfaces } from "../../right-workspace";
import {
  useRightWorkspace,
  useRightWorkspaceState,
  useWorkspaceContext,
} from "../../right-workspace-react";
import { WorkspaceAddMenu } from "./workspace-add-menu";
import { WorkspaceTabs } from "./workspace-tabs";

export function WorkspaceHeader() {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();
  const state = useRightWorkspaceState((value) => value);
  const active = useMemo(() => selectActiveSurface(state, context), [context, state]);
  const hasSurfaces = useMemo(
    () => selectContextSurfaces(state, context).length > 0,
    [context, state],
  );

  return (
    <header className="shrink-0">
      <div
        data-workbench-surface="right-workspace-header"
        className="flex h-(--workbench-header-height) items-center gap-1.5 ps-2 pe-2"
      >
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {hasSurfaces ? (
            <>
              <WorkspaceTabs />
              <WorkspaceAddMenu />
            </>
          ) : null}
        </div>
        <Button
          data-workbench-surface="right-workspace-maximize"
          type="button"
          variant="ghost"
          size="icon"
          aria-label={state.maximized ? t("rightWorkspace.restore") : t("rightWorkspace.maximize")}
          title={state.maximized ? t("rightWorkspace.restore") : t("rightWorkspace.maximize")}
          onClick={() => controller.setMaximized(!state.maximized)}
        >
          {state.maximized ? (
            <Minimize2Icon className="size-4" viewBox="-2 -2 28 28" />
          ) : (
            <Maximize2Icon className="size-4" viewBox="-2 -2 28 28" />
          )}
        </Button>
        <SlotHost
          name="workspace.actions"
          context={{ activeSurfaceId: active?.id, isOpen: state.open }}
          className="flex shrink-0 items-center gap-1"
        />
      </div>
    </header>
  );
}
