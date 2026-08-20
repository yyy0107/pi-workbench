"use client";

import { PanelsTopLeftIcon, PinIcon, XIcon } from "lucide-react";
import { useMemo } from "react";

import { useI18n } from "@/i18n";

import { selectContextSurfaces } from "./core/workspace-selectors";
import {
  useRightWorkspace,
  useRightWorkspaceEnvironment,
  useRightWorkspaceState,
  useWorkspaceContext,
  useWorkspaceSurfaceDefinitions,
} from "./workspace-context";

export function WorkspaceTabs() {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const environment = useRightWorkspaceEnvironment();
  const context = useWorkspaceContext();
  const surfaceOrder = useRightWorkspaceState((state) => state.surfaceOrder);
  const surfacesById = useRightWorkspaceState((state) => state.surfaces);
  const activeSurfaceId = useRightWorkspaceState((state) => state.activeSurfaceId);
  const definitions = useWorkspaceSurfaceDefinitions();
  const definitionByKind = useMemo(
    () => new Map(definitions.map((definition) => [definition.kind, definition])),
    [definitions],
  );
  const surfaces = useMemo(
    () =>
      selectContextSurfaces(
        { ...environment.store.getState(), surfaceOrder, surfaces: surfacesById },
        context,
      ),
    [context, environment.store, surfaceOrder, surfacesById],
  );

  return (
    <div
      role="tablist"
      aria-label={t("rightWorkspace.tabs")}
      className="flex min-w-0 max-w-full shrink items-center gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {surfaces.map((surface) => {
        const Icon = definitionByKind.get(surface.kind)?.icon ?? PanelsTopLeftIcon;
        const active = surface.id === activeSurfaceId;
        return (
          <div
            key={surface.id}
            role="presentation"
            data-state={active ? "active" : "inactive"}
            className="group/tab text-muted-foreground hover:bg-muted/70 hover:text-foreground focus-within:bg-muted/70 focus-within:text-foreground data-[state=active]:bg-muted data-[state=active]:text-foreground after:bg-border/70 relative flex h-7 w-52 min-w-20 max-w-52 flex-[1_1_13rem] items-center rounded-lg text-xs transition-colors after:absolute after:inset-y-1.5 after:end-[-3px] after:w-px after:content-[''] last:after:hidden hover:after:hidden focus-within:after:hidden data-[state=active]:after:hidden"
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              title={surface.title}
              className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-s-lg ps-2.5 pe-1 outline-none group-hover/tab:pe-8 group-focus-within/tab:pe-8 group-data-[state=active]/tab:pe-8 focus-visible:ring-2 focus-visible:ring-inset"
              onClick={() => controller.focus(surface.id)}
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-start [mask-image:linear-gradient(to_right,#000_calc(100%_-_0.75rem),transparent)]">
                {surface.title}
              </span>
              {surface.dirty ? (
                <span className="bg-foreground size-1.5 shrink-0 rounded-full" aria-hidden="true" />
              ) : null}
              {surface.pinned ? <PinIcon className="size-3 shrink-0" aria-hidden="true" /> : null}
            </button>
            <button
              type="button"
              aria-label={t("rightWorkspace.closeTab", { title: surface.title })}
              title={t("rightWorkspace.closeTab", { title: surface.title })}
              className="text-foreground/65 hover:bg-foreground/[0.04] hover:text-foreground pointer-events-none absolute end-[5px] top-1/2 z-10 inline-flex size-[22px] -translate-y-1/2 items-center justify-center rounded-md opacity-0 transition-[background-color,color,opacity] group-hover/tab:pointer-events-auto group-hover/tab:opacity-100 group-focus-within/tab:pointer-events-auto group-focus-within/tab:opacity-100 group-data-[state=active]/tab:pointer-events-auto group-data-[state=active]/tab:opacity-100 focus-visible:bg-foreground/[0.04] focus-visible:text-foreground focus-visible:opacity-100 dark:hover:bg-background/35 dark:focus-visible:bg-background/35"
              onClick={() => controller.close(surface.id)}
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
