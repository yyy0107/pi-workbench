"use client";

import { Maximize2Icon, Minimize2Icon, PanelRightCloseIcon } from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { SlotHost } from "@/platform/extensions";

import { selectActiveSurface, selectContextSurfaces } from "./core/workspace-selectors";
import {
  useRightWorkspace,
  useRightWorkspaceState,
  useWorkspaceContext,
} from "./workspace-context";
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
      <div className="flex h-10 items-center gap-1.5 px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {hasSurfaces ? (
            <>
              <WorkspaceTabs />
              <WorkspaceAddMenu />
            </>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={state.maximized ? t("rightWorkspace.restore") : t("rightWorkspace.maximize")}
          title={state.maximized ? t("rightWorkspace.restore") : t("rightWorkspace.maximize")}
          onClick={() => controller.setMaximized(!state.maximized)}
        >
          {state.maximized ? (
            <Minimize2Icon className="size-3.5" />
          ) : (
            <Maximize2Icon className="size-3.5" />
          )}
        </Button>
        <SlotHost
          name="workspace.actions"
          context={{ activeSurfaceId: active?.id, isOpen: state.open }}
          className="flex shrink-0 items-center gap-1"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-controls="right-workspace"
          aria-expanded={true}
          aria-label={t("rightWorkspace.collapse")}
          title={t("rightWorkspace.collapse")}
          className="text-foreground me-1 aria-expanded:bg-transparent aria-expanded:hover:bg-muted"
          onClick={() => controller.setWorkspaceOpen(false)}
        >
          <PanelRightCloseIcon className="size-[18px]" />
        </Button>
      </div>
    </header>
  );
}
