"use client";

import type { PanelDefinition } from "@/platform/extensions";
import { useI18n } from "@/i18n";
import { ExtensionErrorBoundary, useExtensionEnvironment } from "@/platform/extensions";

export interface PanelTabContentProps {
  definition: PanelDefinition;
  isActive: boolean;
}

function StaticPanelTabContent({ definition }: Pick<PanelTabContentProps, "definition">) {
  const { text } = useI18n();
  const Icon = definition.icon;

  return (
    <>
      {Icon ? <Icon className="size-4 shrink-0" /> : null}
      <span className="min-w-0 flex-1 truncate text-left">
        {definition.title ? text(definition.title) : definition.id}
      </span>
    </>
  );
}

export function PanelTabContent({ definition, isActive }: PanelTabContentProps) {
  const { reportError } = useExtensionEnvironment();
  const Tab = definition.tabComponent;

  if (!Tab) return <StaticPanelTabContent definition={definition} />;

  return (
    <ExtensionErrorBoundary
      contributionId={`${definition.id}.tab`}
      source="panel"
      onError={reportError}
      resetKey={Tab}
      fallback={<StaticPanelTabContent definition={definition} />}
    >
      <Tab panelId={definition.id} isActive={isActive} />
    </ExtensionErrorBoundary>
  );
}
