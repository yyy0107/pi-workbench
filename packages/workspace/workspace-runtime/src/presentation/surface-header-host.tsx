"use client";
import { workspaceTranslationBundle } from "../i18n";
import { useI18n } from "@workbench/i18n";

import { Suspense } from "react";

import type {
  AnyWorkspaceSurfaceDefinition,
  WorkspaceContext,
  WorkspaceSurfaceInstance,
} from "@workbench/extension-sdk";
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
  const { t } = useI18n(workspaceTranslationBundle);
  const Header = definition?.header;

  if (!active || !Header) return null;

  return (
    <div
      data-surface-header={active.kind}
      className="h-[var(--control-hit-default)] shrink-0 overflow-hidden border-b"
    >
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
