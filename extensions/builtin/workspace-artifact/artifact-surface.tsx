"use client";

import { FileOutputIcon } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { useI18n } from "@/i18n";
import type { WorkspaceSurfaceProps } from "@/platform/extensions";

import { InlineFeedbackForm } from "@/components/right-workspace";
import { artifactPreviewService as artifacts } from "./artifact-preview-service";
import { artifactRendererRegistry } from "./artifact-renderer-registry";

export interface ArtifactSurfaceParams extends Record<string, unknown> {
  artifactId: string;
  rendererHint?: string;
}

export function ArtifactSurface({ surface }: WorkspaceSurfaceProps<ArtifactSurfaceParams>) {
  const { t } = useI18n();
  useSyncExternalStore(
    artifacts.subscribe.bind(artifacts),
    artifacts.getRevision.bind(artifacts),
    () => 0,
  );
  const artifact = artifacts.getArtifact({ id: surface.params.artifactId, scope: surface.scope });
  const [mode, setMode] = useState<"rendered" | "source">("rendered");

  if (!artifact) {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-sm">
        <FileOutputIcon className="size-7 opacity-45" />
        {t("extensions.workspaceArtifact.missing")}
      </div>
    );
  }

  const definition = artifactRendererRegistry[artifact.rendererKind];
  const Renderer = definition.render;

  return (
    <section className="relative flex h-full min-h-0 flex-col">
      {definition.supportsSource ? (
        <div className="flex h-10 shrink-0 items-center gap-1 border-b px-3">
          {(["rendered", "source"] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              data-state={mode === candidate ? "active" : "inactive"}
              className="inline-flex h-[var(--button-height-default)] items-center rounded-[var(--button-radius)] px-2.5 pt-[var(--button-content-padding-block-start)] pb-[var(--button-content-padding-block-end)] text-xs leading-[var(--control-text-line-height)]! data-[state=active]:[background:var(--button-background-selected)] data-[state=active]:[color:var(--button-foreground-selected)]"
              onClick={() => setMode(candidate)}
            >
              {candidate === "rendered"
                ? t("extensions.workspaceArtifact.rendered")
                : t("extensions.workspaceArtifact.source")}
            </button>
          ))}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden">
        <Renderer artifact={artifact} mode={mode} />
      </div>
      {definition.supportsAnnotation ? (
        <div className="absolute end-3 bottom-3">
          <InlineFeedbackForm
            surface={surface}
            kind="artifact-region"
            label={t("extensions.workspaceArtifact.annotate")}
            target={{ artifactId: artifact.id, renderer: artifact.rendererKind }}
          />
        </div>
      ) : null}
    </section>
  );
}
