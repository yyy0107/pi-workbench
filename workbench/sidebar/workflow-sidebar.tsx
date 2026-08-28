"use client";

import { useState } from "react";
import {
  GitBranchIcon,
  HistoryIcon,
  LayoutGridIcon,
  LayoutTemplateIcon,
  ListChecksIcon,
  PlusIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

type WorkflowKind = "workflow" | "sop" | "automation";

interface WorkflowListItem {
  id: string;
  kind: WorkflowKind;
  title: string;
  metadata: string;
  icon: LucideIcon;
}

interface WorkflowCategory {
  id: "all" | WorkflowKind;
  label: string;
  icon: LucideIcon;
}

export function WorkflowSidebar({ searchQuery }: { searchQuery: string }) {
  const { t } = useI18n();
  const [activeCategory, setActiveCategory] = useState<WorkflowCategory["id"]>("all");
  const [selectedEntry, setSelectedEntry] = useState<string>();

  const kindLabels: Record<WorkflowKind, string> = {
    workflow: t("workbench.sidebar.workflow.kind.workflow"),
    sop: t("workbench.sidebar.workflow.kind.sop"),
    automation: t("workbench.sidebar.workflow.kind.automation"),
  };
  const categories: readonly WorkflowCategory[] = [
    {
      id: "all",
      label: t("workbench.sidebar.workflow.allWorkflows"),
      icon: LayoutGridIcon,
    },
    {
      id: "workflow",
      label: kindLabels.workflow,
      icon: GitBranchIcon,
    },
    {
      id: "sop",
      label: kindLabels.sop,
      icon: ListChecksIcon,
    },
    {
      id: "automation",
      label: kindLabels.automation,
      icon: ZapIcon,
    },
  ];
  const workflows: readonly WorkflowListItem[] = [
    {
      id: "daily-work-summary",
      kind: "automation",
      title: t("workbench.sidebar.workflow.items.dailyWorkSummary"),
      metadata: t("workbench.sidebar.workflow.itemMetadata", {
        kind: kindLabels.automation,
        detail: t("workbench.sidebar.workflow.schedule.dailyAtNine"),
      }),
      icon: ZapIcon,
    },
    {
      id: "pr-review",
      kind: "workflow",
      title: t("workbench.sidebar.workflow.items.prReview"),
      metadata: t("workbench.sidebar.workflow.itemMetadata", {
        kind: kindLabels.workflow,
        detail: t("workbench.sidebar.workflow.stepCount", { count: 5 }),
      }),
      icon: GitBranchIcon,
    },
    {
      id: "release-checklist",
      kind: "sop",
      title: t("workbench.sidebar.workflow.items.releaseChecklist"),
      metadata: t("workbench.sidebar.workflow.itemMetadata", {
        kind: kindLabels.sop,
        detail: t("workbench.sidebar.workflow.stepCount", { count: 8 }),
      }),
      icon: ListChecksIcon,
    },
  ];
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const visibleWorkflows = workflows.filter(
    (workflow) =>
      (activeCategory === "all" || workflow.kind === activeCategory) &&
      (!normalizedQuery ||
        `${workflow.title} ${workflow.metadata}`.toLocaleLowerCase().includes(normalizedQuery)),
  );

  return (
    <section
      id="workbench-sidebar-workflows-panel"
      role="region"
      aria-label={t("workbench.sidebar.workflow.region")}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="min-h-0 flex-1 overflow-y-auto py-1 ps-3 pe-[2px] [scrollbar-gutter:stable]">
        <Button
          type="button"
          variant="ghost"
          aria-current={selectedEntry === "new" ? "page" : undefined}
          className="hover:bg-sidebar-accent data-active:bg-sidebar-accent h-9 w-full justify-start gap-2 rounded-lg px-3 text-sm font-medium shadow-none"
          onClick={() => setSelectedEntry("new")}
        >
          <PlusIcon aria-hidden="true" className="size-[var(--icon-size-md)]" />
          <span>{t("workbench.sidebar.workflow.newWorkflow")}</span>
        </Button>

        <nav
          aria-label={t("workbench.sidebar.workflow.categories")}
          className="mt-2 flex flex-col gap-0.5"
        >
          <WorkflowNavigationButton
            icon={categories[0].icon}
            label={categories[0].label}
            active={activeCategory === "all"}
            onClick={() => setActiveCategory("all")}
          />

          <div className="border-sidebar-border ms-4 flex flex-col border-s ps-2">
            {categories.slice(1).map((category) => (
              <div
                key={category.id}
                className="before:border-sidebar-border relative before:absolute before:-start-2 before:top-1/2 before:w-2 before:border-t"
              >
                <WorkflowNavigationButton
                  icon={category.icon}
                  label={category.label}
                  active={activeCategory === category.id}
                  onClick={() => setActiveCategory(category.id)}
                />
              </div>
            ))}
          </div>
        </nav>

        <div className="bg-sidebar-border mx-2 my-3 h-px" />

        <div className="flex h-9 items-center px-2">
          <h2 className="text-muted-foreground text-sm font-medium">
            {t("workbench.sidebar.workflow.myWorkflows")}
          </h2>
        </div>

        {visibleWorkflows.length > 0 ? (
          <div className="flex flex-col gap-[2px]">
            {visibleWorkflows.map((workflow) => (
              <WorkflowItemButton
                key={workflow.id}
                workflow={workflow}
                active={selectedEntry === workflow.id}
                onClick={() => setSelectedEntry(workflow.id)}
              />
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground px-2 py-3 text-xs leading-relaxed">
            {t("workbench.sidebar.workflow.noResults")}
          </p>
        )}

        <div className="bg-sidebar-border mx-2 my-3 h-px" />

        <nav
          aria-label={t("workbench.sidebar.workflow.resources")}
          className="flex flex-col gap-0.5"
        >
          <WorkflowDestinationButton
            id="run-history"
            icon={HistoryIcon}
            label={t("workbench.sidebar.workflow.runHistory")}
            selectedEntry={selectedEntry}
            onSelect={setSelectedEntry}
          />
          <WorkflowDestinationButton
            id="templates"
            icon={LayoutTemplateIcon}
            label={t("workbench.sidebar.workflow.templates")}
            selectedEntry={selectedEntry}
            onSelect={setSelectedEntry}
          />
        </nav>
      </div>
    </section>
  );
}

function WorkflowNavigationButton({
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
      className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground h-[var(--control-hit-touch)] w-full justify-start gap-0 rounded-lg px-1.5 text-sm font-normal md:h-9"
      onClick={onClick}
    >
      <span className="flex size-[var(--icon-frame-size-default)] shrink-0 items-center justify-center">
        <Icon aria-hidden="true" className="size-[var(--icon-size-md)]" />
      </span>
      <span className="min-w-0 flex-1 truncate ps-1 text-start">{label}</span>
    </Button>
  );
}

function WorkflowItemButton({
  workflow,
  active,
  onClick,
}: {
  workflow: WorkflowListItem;
  active: boolean;
  onClick(): void;
}) {
  const Icon = workflow.icon;

  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      title={workflow.title}
      className={cn(
        "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-sidebar-ring flex h-[var(--control-hit-touch)] w-full items-center rounded-lg px-1.5 text-start outline-none transition-[color,background-color] focus-visible:ring-2",
        active && "bg-sidebar-accent text-sidebar-foreground",
      )}
      onClick={onClick}
    >
      <span className="flex size-[var(--icon-frame-size-default)] shrink-0 items-center justify-center">
        <Icon aria-hidden="true" className="size-[var(--icon-size-md)]" />
      </span>
      <span className="min-w-0 flex-1 ps-1">
        <span className="block truncate text-sm leading-4">{workflow.title}</span>
        <span className="text-muted-foreground block truncate text-[11px] leading-4">
          {workflow.metadata}
        </span>
      </span>
    </button>
  );
}

function WorkflowDestinationButton({
  id,
  icon: Icon,
  label,
  selectedEntry,
  onSelect,
}: {
  id: string;
  icon: LucideIcon;
  label: string;
  selectedEntry: string | undefined;
  onSelect(id: string): void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      aria-current={selectedEntry === id ? "page" : undefined}
      title={label}
      className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground h-[var(--control-hit-touch)] w-full justify-start gap-0 rounded-lg px-1.5 text-sm font-normal md:h-9"
      onClick={() => onSelect(id)}
    >
      <span className="flex size-[var(--icon-frame-size-default)] shrink-0 items-center justify-center">
        <Icon aria-hidden="true" className="size-[var(--icon-size-md)]" />
      </span>
      <span className="min-w-0 flex-1 truncate ps-1 text-start">{label}</span>
    </Button>
  );
}
