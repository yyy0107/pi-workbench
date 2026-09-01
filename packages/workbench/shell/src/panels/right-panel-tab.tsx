"use client";

import { XIcon } from "lucide-react";

import { Button } from "../ui/button";
import { useI18n } from "../i18n";
import { cn } from "../utils";
import type {
  PanelDefinition,
  PanelTabClassName,
  PanelTabComponentProps,
} from "@workbench/extension-sdk";

import { PanelTabContent } from "./panel-tab-content";

export interface RightPanelTabProps {
  definition: PanelDefinition;
  isActive: boolean;
  onClose(): void;
  onSelect(): void;
}

function resolveClassName(
  className: PanelTabClassName | undefined,
  context: PanelTabComponentProps,
): string | undefined {
  return typeof className === "function" ? className(context) : className;
}

export function RightPanelTab({ definition, isActive, onClose, onSelect }: RightPanelTabProps) {
  const { t, text } = useI18n();
  const label = definition.title ? text(definition.title) : definition.id;
  const styleContext = { panelId: definition.id, isActive };
  const classNames = definition.tabClassNames;

  return (
    <div
      role="presentation"
      data-slot="workbench-right-panel-tab"
      data-workbench-selection-surface=""
      data-panel-id={definition.id}
      data-state={isActive ? "active" : "inactive"}
      className={cn(
        "group flex h-9 min-w-32 max-w-52 shrink-0 items-center rounded-xl text-sm transition-colors",
        isActive
          ? "bg-muted/80 text-foreground font-medium shadow-xs"
          : "text-muted-foreground hover:bg-muted/45 hover:text-foreground",
        resolveClassName(classNames?.root, styleContext),
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={isActive}
        title={label}
        data-slot="workbench-right-panel-tab-trigger"
        className={cn(
          "flex h-full min-w-0 flex-1 items-center gap-2 rounded-l-xl pt-[var(--button-content-padding-block-start)] pr-1 pb-[var(--button-content-padding-block-end)] pl-3 leading-[var(--control-text-line-height)]! outline-none focus-visible:ring-2 focus-visible:ring-inset",
          resolveClassName(classNames?.trigger, styleContext),
        )}
        onClick={onSelect}
      >
        <PanelTabContent definition={definition} isActive={isActive} />
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        data-frame="none"
        aria-label={t("workbench.panels.closeTab", { label })}
        title={t("workbench.panels.closeTab", { label })}
        data-panel-tab-part="close-button"
        className={cn(
          "text-muted-foreground hover:text-foreground mr-1 rounded-lg opacity-65 hover:opacity-100 focus-visible:opacity-100",
          resolveClassName(classNames?.closeButton, styleContext),
        )}
        onClick={onClose}
      >
        <XIcon className="size-3.5" />
      </Button>
    </div>
  );
}
