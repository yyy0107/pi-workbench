"use client";

import { Suspense } from "react";

import { useI18n } from "@/i18n";

import type {
  AnyWorkspaceSurfaceDefinition,
  WorkspaceContext,
  WorkspaceSurfaceInstance,
} from "./core/surface-types";
import { WorkspaceSurfaceBoundary } from "./surface-boundary";

export function SurfaceHeaderHost({
  active,
  context,
  definition,
}: Readonly<{
  active?: WorkspaceSurfaceInstance;
  context: WorkspaceContext;
  definition?: AnyWorkspaceSurfaceDefinition;
}>) {
  const { t } = useI18n();
  const Header = definition?.header;

  if (!active || !Header) return null;

  return (
    <div data-surface-header={active.kind} className="h-8 shrink-0 overflow-hidden border-b">
      <WorkspaceSurfaceBoundary key={active.id} surfaceId={`${active.id}:header`}>
        <Suspense
          fallback={
            <div
              role="status"
              className="text-muted-foreground flex size-full items-center px-3 text-xs"
            >
              {t("rightWorkspace.status.loading")}
            </div>
          }
        >
          <Header surface={active} context={context} isVisible />
        </Suspense>
      </WorkspaceSurfaceBoundary>
    </div>
  );
}
