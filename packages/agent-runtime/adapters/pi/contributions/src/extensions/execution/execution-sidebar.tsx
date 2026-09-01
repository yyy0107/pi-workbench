"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import {
  GitBranchIcon,
  HistoryIcon,
  LayoutTemplateIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@workbench/shell/ui";
import { usePiI18n } from "../../i18n";
import { cn } from "@workbench/shell/utils";
import { useMainViewService } from "@workbench/extension-host";
import type { SlotPropsMap } from "@workbench/extension-sdk";
import { usePiExecutionClient } from "@workbench/agent-runtime-pi-client/execution";
import type { WorkflowKind, WorkflowSummary } from "@workbench/execution-contracts";

import { workflowMainViewRequest, type WorkflowMainViewParams } from "./execution-main-view";
import { useWorkflowCatalogStore, useWorkflowCatalogStoreApi } from "./execution-state";

type ExecutionCategory = WorkflowKind | "automation";

const KIND_ICONS: Record<ExecutionCategory, LucideIcon> = {
  workflow: GitBranchIcon,
  automation: ZapIcon,
};

export function WorkflowSidebar({ searchQuery }: SlotPropsMap["sidebar.workflows"]) {
  const panelId = useId();
  const { workflow } = usePiExecutionClient();
  const catalogStore = useWorkflowCatalogStoreApi();
  const { locale, t } = usePiI18n();
  const mainViews = useMainViewService();
  const { items, loadState, refresh } = useWorkflowCatalogStore();
  const activeView = useSyncExternalStore(
    mainViews.subscribe,
    mainViews.getSnapshot,
    mainViews.getInitialSnapshot,
  );
  useEffect(() => {
    if (mainViews.getSnapshot()?.kind === "workflows") return;
    mainViews.open(workflowMainViewRequest({ page: "workflows" }));
  }, [mainViews]);
  useEffect(() => {
    if (catalogStore.getState().loadState === "idle") void refresh(workflow);
  }, [catalogStore, refresh, workflow]);
  const [category, setCategory] = useState<ExecutionCategory>("workflow");
  const params =
    activeView?.kind === "workflows" ? (activeView.params as WorkflowMainViewParams) : undefined;
  const selectedWorkflowId = params?.page === "editor" ? params.workflowId : undefined;
  const selectedWorkflowKind = items.find(({ id }) => id === selectedWorkflowId)?.kind;
  const effectiveCategory: ExecutionCategory =
    params?.page === "workflows"
      ? "workflow"
      : params?.page === "automations" ||
          params?.page === "automation-create" ||
          params?.page === "automation-edit"
        ? "automation"
        : params?.page === "create" && params.kind
          ? params.kind
          : params?.page === "templates" && params.kind
            ? params.kind
            : (selectedWorkflowKind ?? category);
  const kindLabels: Record<ExecutionCategory, string> = {
    workflow: t("extensions.workflows.kind.workflow"),
    automation: t("extensions.workflows.kind.automation"),
  };
  const normalized = searchQuery.trim().toLocaleLowerCase(locale);
  const visible = items.filter(
    (workflow) =>
      effectiveCategory !== "automation" &&
      workflow.archivedAt === undefined &&
      workflow.kind === effectiveCategory &&
      (!normalized ||
        `${workflow.name} ${workflow.description ?? ""} ${kindLabels[workflow.kind]}`
          .toLocaleLowerCase(locale)
          .includes(normalized)),
  );
  const open = (next: WorkflowMainViewParams) => mainViews.open(workflowMainViewRequest(next));
  const selectCategory = (next: ExecutionCategory) => {
    setCategory(next);
    open(next === "workflow" ? { page: "workflows" } : { page: "automations" });
  };

  return (
    <section
      id={panelId}
      role="region"
      aria-label={t("extensions.workflows.sidebar.region")}
      className="flex h-full min-h-0 flex-col"
    >
      <div className="min-h-0 flex-1 overflow-y-auto py-1 ps-3 pe-[2px] [scrollbar-gutter:stable]">
        <nav
          aria-label={t("extensions.workflows.sidebar.categories")}
          className="flex flex-col gap-0.5"
        >
          {(Object.keys(KIND_ICONS) as ExecutionCategory[]).map((kind) => (
            <NavigationButton
              key={kind}
              icon={KIND_ICONS[kind]}
              label={kindLabels[kind]}
              active={effectiveCategory === kind}
              onClick={() => selectCategory(kind)}
            />
          ))}
        </nav>

        <div className="bg-sidebar-border mx-2 my-3 h-px" />
        <div className="flex h-9 items-center px-2">
          <h2 className="text-muted-foreground text-sm font-medium">
            {t("extensions.workflows.sidebar.allExecutions")}
          </h2>
        </div>

        {loadState === "loading" || loadState === "idle" ? (
          <p className="text-muted-foreground px-2 py-3 text-xs">
            {t("extensions.workflows.sidebar.loading")}
          </p>
        ) : loadState === "error" ? (
          <div className="px-2 py-3">
            <p className="text-muted-foreground text-xs">
              {t("extensions.workflows.sidebar.loadFailed")}
            </p>
            <Button
              variant="ghost"
              size="xs"
              className="mt-2"
              onClick={() => void refresh(workflow)}
            >
              {t("extensions.workflows.sidebar.retry")}
            </Button>
          </div>
        ) : visible.length > 0 ? (
          <div className="flex flex-col gap-[2px]">
            {visible.map((workflow) => (
              <WorkflowItem
                key={workflow.id}
                workflow={workflow}
                kindLabel={kindLabels[workflow.kind]}
                active={selectedWorkflowId === workflow.id}
                onClick={() =>
                  open({ page: "editor", workflowId: workflow.id, kind: workflow.kind })
                }
              />
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground px-2 py-3 text-xs leading-relaxed">
            {t("extensions.workflows.sidebar.noResults")}
          </p>
        )}

        {effectiveCategory === "automation" ? null : (
          <>
            <div className="bg-sidebar-border mx-2 my-3 h-px" />
            <nav
              aria-label={t("extensions.workflows.sidebar.resources")}
              className="flex flex-col gap-0.5"
            >
              <DestinationButton
                icon={HistoryIcon}
                label={t("extensions.workflows.sidebar.runHistory")}
                active={params?.page === "runs"}
                onClick={() => open({ page: "runs", kind: effectiveCategory })}
              />
              <DestinationButton
                icon={LayoutTemplateIcon}
                label={t("extensions.workflows.sidebar.templates")}
                active={params?.page === "templates"}
                onClick={() => open({ page: "templates", kind: effectiveCategory })}
              />
            </nav>
          </>
        )}
      </div>
    </section>
  );
}

function NavigationButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick(): void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      aria-pressed={active}
      title={label}
      className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground h-[var(--control-hit-touch)] w-full justify-start gap-0 px-1.5 text-sm font-normal md:h-9"
      onClick={onClick}
    >
      <span className="flex size-[var(--icon-frame-size-default)] shrink-0 items-center justify-center">
        <Icon aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 truncate ps-1 text-start">{label}</span>
    </Button>
  );
}

function WorkflowItem({
  workflow,
  kindLabel,
  active,
  onClick,
}: {
  workflow: WorkflowSummary;
  kindLabel: string;
  active: boolean;
  onClick(): void;
}) {
  const { t } = usePiI18n();
  const Icon = KIND_ICONS[workflow.kind];
  const state = workflow.publishedRevisionId
    ? t("extensions.workflows.sidebar.published")
    : t("extensions.workflows.sidebar.draft");
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      title={workflow.name}
      className={cn(
        "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-sidebar-ring flex min-h-[var(--control-hit-touch)] w-full items-center rounded-[var(--button-radius)] px-1.5 py-1 text-start outline-none transition-colors focus-visible:ring-2",
        active && "bg-sidebar-accent text-sidebar-foreground",
      )}
      onClick={onClick}
    >
      <span className="flex size-[var(--icon-frame-size-default)] shrink-0 items-center justify-center">
        <Icon aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 ps-1">
        <span className="block truncate text-sm leading-4">{workflow.name}</span>
        <span className="text-muted-foreground block truncate text-[11px] leading-4">
          {kindLabel} · {state}
        </span>
      </span>
    </button>
  );
}

function DestinationButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick(): void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      aria-current={active ? "page" : undefined}
      title={label}
      className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground h-[var(--control-hit-touch)] w-full justify-start gap-0 px-1.5 text-sm font-normal md:h-9"
      onClick={onClick}
    >
      <span className="flex size-[var(--icon-frame-size-default)] shrink-0 items-center justify-center">
        <Icon aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 truncate ps-1 text-start">{label}</span>
    </Button>
  );
}
