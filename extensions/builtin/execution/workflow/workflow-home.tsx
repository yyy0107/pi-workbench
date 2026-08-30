"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangleIcon,
  CircleDotIcon,
  CirclePlayIcon,
  FolderKanbanIcon,
  GitBranchIcon,
  HistoryIcon,
  LayoutTemplateIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UserRoundIcon,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { useMainViewService } from "@/platform/extensions";
import { useWorkspaceSelection } from "@workbench/agent-runtime-client/workspaces";
import { workflowClient } from "@/workbench/runtime-contributions/pi/client/execution";
import type {
  FlowGraph,
  WorkflowRunStatus,
  WorkflowRunSummary,
  WorkflowSummary,
} from "@workbench/execution-contracts";

import { WorkflowGraphThumbnail } from "./workflow-graph-thumbnail";
import { workflowMainViewRequest } from "../execution-main-view";
import { useWorkflowCatalogStore } from "../execution-state";

const RUN_STATUS_KEYS = {
  queued: "queued",
  running: "running",
  "waiting-for-approval": "waitingForApproval",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
  interrupted: "interrupted",
} as const satisfies Record<WorkflowRunStatus, string>;

type WorkflowDeleteState = "idle" | "deleting" | "error";

export function WorkflowHome() {
  const { t } = useI18n();
  const mainViews = useMainViewService();
  const items = useWorkflowCatalogStore((state) => state.items);
  const runs = useWorkflowCatalogStore((state) => state.runs);
  const { workspaces } = useWorkspaceSelection();
  const loadState = useWorkflowCatalogStore((state) => state.loadState);
  const refresh = useWorkflowCatalogStore((state) => state.refresh);
  const [deleteTarget, setDeleteTarget] = useState<WorkflowSummary>();
  const [deleteState, setDeleteState] = useState<WorkflowDeleteState>("idle");
  const [deleteAnnouncement, setDeleteAnnouncement] = useState("");
  const workflows = useMemo(
    () => items.filter(({ kind, archivedAt }) => kind === "workflow" && archivedAt === undefined),
    [items],
  );
  const workspaceNames = useMemo(
    () => new Map(workspaces.map(({ id, name }) => [id, name])),
    [workspaces],
  );
  const graphPreviews = useWorkflowGraphPreviews(workflows);
  const latestRuns = useMemo(() => latestRunByWorkflow(workflows, runs), [runs, workflows]);
  const attention = useMemo(
    () => ({
      running: [...latestRuns.values()].filter(
        ({ status }) => status === "queued" || status === "running",
      ).length,
      waiting: [...latestRuns.values()].filter(({ status }) => status === "waiting-for-approval")
        .length,
      failed: [...latestRuns.values()].filter(
        ({ status }) => status === "failed" || status === "interrupted",
      ).length,
    }),
    [latestRuns],
  );
  const needsAttention = attention.running + attention.waiting + attention.failed > 0;
  const open = (workflowId: string) =>
    mainViews.open(workflowMainViewRequest({ page: "editor", workflowId, kind: "workflow" }));
  const openRuns = (workflowId?: string) =>
    mainViews.open(workflowMainViewRequest({ page: "runs", workflowId, kind: "workflow" }));
  const create = () =>
    mainViews.open(workflowMainViewRequest({ page: "create", kind: "workflow" }));
  const openTemplates = () =>
    mainViews.open(workflowMainViewRequest({ page: "templates", kind: "workflow" }));
  const requestDelete = (workflow: WorkflowSummary) => {
    setDeleteState("idle");
    setDeleteTarget(workflow);
  };
  const deleteWorkflow = async () => {
    if (!deleteTarget || deleteState === "deleting") return;
    setDeleteState("deleting");
    try {
      await workflowClient.archive({ workflowId: deleteTarget.id, archived: true });
      useWorkflowCatalogStore.getState().applyHostPayload({
        type: "host/workflow-removed",
        workflowId: deleteTarget.id,
      });
      setDeleteAnnouncement(
        t("extensions.workflows.workflowHome.deletedFeedback", { name: deleteTarget.name }),
      );
      setDeleteTarget(undefined);
      setDeleteState("idle");
    } catch {
      setDeleteState("error");
    }
  };

  return (
    <main
      aria-labelledby="workflow-home-title"
      className="bg-background h-full min-h-0 overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-10 lg:py-12">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1
              id="workflow-home-title"
              className="text-foreground text-3xl font-semibold tracking-tight"
            >
              {t("extensions.workflows.workflowHome.title")}
            </h1>
            <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
              {t("extensions.workflows.workflowHome.description")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => openRuns()}>
              <HistoryIcon aria-hidden="true" />
              {t("extensions.workflows.workflowHome.runHistory")}
            </Button>
            <Button type="button" onClick={create}>
              <PlusIcon aria-hidden="true" />
              {t("extensions.workflows.workflowHome.newWorkflow")}
            </Button>
          </div>
        </header>

        {needsAttention ? (
          <section
            aria-labelledby="workflow-home-attention-title"
            className="border-border mt-8 rounded-[var(--radius-lg)] border"
          >
            <div className="border-border flex min-h-11 items-center border-b px-4">
              <h2 id="workflow-home-attention-title" className="text-sm font-medium">
                {t("extensions.workflows.workflowHome.attention")}
              </h2>
            </div>
            <div className="grid sm:grid-cols-3">
              <AttentionItem
                icon={CirclePlayIcon}
                count={attention.running}
                label={t("extensions.workflows.workflowHome.running")}
                onClick={() => openRuns()}
              />
              <AttentionItem
                icon={ShieldCheckIcon}
                count={attention.waiting}
                label={t("extensions.workflows.workflowHome.waitingForApproval")}
                onClick={() => openRuns()}
              />
              <AttentionItem
                icon={AlertTriangleIcon}
                count={attention.failed}
                label={t("extensions.workflows.workflowHome.failed")}
                tone="destructive"
                onClick={() => openRuns()}
              />
            </div>
          </section>
        ) : null}

        <section aria-labelledby="workflow-home-list-title" className="mt-8">
          <div className="flex min-h-10 items-center justify-between gap-3">
            <h2 id="workflow-home-list-title" className="text-sm font-medium">
              {t("extensions.workflows.workflowHome.myWorkflows")}
            </h2>
            {loadState === "ready" ? (
              <span className="text-muted-foreground text-xs">
                {t("extensions.workflows.workflowHome.workflowCount", {
                  count: workflows.length,
                })}
              </span>
            ) : null}
          </div>

          {loadState === "loading" || loadState === "idle" ? (
            <div className="text-muted-foreground flex min-h-72 items-center justify-center gap-2 text-sm">
              <RefreshCwIcon
                aria-hidden="true"
                className="size-[var(--icon-size-md)] animate-spin"
              />
              {t("extensions.workflows.workflowHome.loading")}
            </div>
          ) : loadState === "error" ? (
            <div className="flex min-h-72 flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-muted-foreground text-sm">
                {t("extensions.workflows.workflowHome.loadFailed")}
              </p>
              <Button variant="outline" size="sm" onClick={() => void refresh()}>
                <RefreshCwIcon aria-hidden="true" />
                {t("extensions.workflows.sidebar.retry")}
              </Button>
            </div>
          ) : workflows.length === 0 ? (
            <WorkflowEmptyState onCreate={create} onOpenTemplates={openTemplates} />
          ) : (
            <div className="grid items-start gap-4 md:grid-cols-2">
              {workflows.map((workflow) => (
                <WorkflowCard
                  key={workflow.id}
                  workflow={workflow}
                  graph={
                    graphPreviews.get(workflow.id)?.revision === previewRevision(workflow)
                      ? graphPreviews.get(workflow.id)?.graph
                      : undefined
                  }
                  latestRun={latestRuns.get(workflow.id)}
                  projectName={
                    workflow.scope.type === "project"
                      ? workspaceNames.get(workflow.scope.workspaceId)
                      : undefined
                  }
                  onOpen={() => open(workflow.id)}
                  onOpenRuns={() => openRuns(workflow.id)}
                  onDelete={() => requestDelete(workflow)}
                />
              ))}
            </div>
          )}
        </section>

        {workflows.length > 0 ? (
          <section
            aria-labelledby="workflow-home-template-title"
            className="border-border mt-10 flex flex-wrap items-center justify-between gap-4 border-t pt-8"
          >
            <div>
              <h2 id="workflow-home-template-title" className="text-sm font-medium">
                {t("extensions.workflows.workflowHome.startFromTemplate")}
              </h2>
              <p className="text-muted-foreground mt-1 text-sm leading-6">
                {t("extensions.workflows.workflowHome.templateDescription")}
              </p>
            </div>
            <Button type="button" variant="outline" onClick={openTemplates}>
              <LayoutTemplateIcon aria-hidden="true" />
              {t("extensions.workflows.workflowHome.browseTemplates")}
            </Button>
          </section>
        ) : null}

        <span className="sr-only" role="status" aria-live="polite">
          {deleteAnnouncement}
        </span>

        <Dialog
          open={deleteTarget !== undefined}
          onOpenChange={(open) => {
            if (!open && deleteState !== "deleting") {
              setDeleteTarget(undefined);
              setDeleteState("idle");
            }
          }}
        >
          <DialogContent
            closeLabel={t("extensions.workflows.workflowHome.cancelDelete")}
            showCloseButton={false}
          >
            <DialogHeader>
              <DialogTitle>
                {t("extensions.workflows.workflowHome.deleteTitle", {
                  name: deleteTarget?.name ?? "",
                })}
              </DialogTitle>
              <DialogDescription>
                {t("extensions.workflows.workflowHome.deleteDescription")}
              </DialogDescription>
            </DialogHeader>
            {deleteState === "error" ? (
              <p className="text-destructive text-xs leading-5" role="alert">
                {t("extensions.workflows.workflowHome.deleteFailed", {
                  name: deleteTarget?.name ?? "",
                })}
              </p>
            ) : null}
            <DialogFooter closeLabel={t("extensions.workflows.workflowHome.cancelDelete")}>
              <Button
                type="button"
                variant="outline"
                disabled={deleteState === "deleting"}
                onClick={() => {
                  setDeleteTarget(undefined);
                  setDeleteState("idle");
                }}
              >
                {t("extensions.workflows.workflowHome.cancelDelete")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={!deleteTarget || deleteState === "deleting"}
                onClick={() => void deleteWorkflow()}
              >
                {deleteState === "deleting" ? (
                  <RefreshCwIcon aria-hidden="true" className="animate-spin" />
                ) : (
                  <Trash2Icon aria-hidden="true" />
                )}
                {t(
                  deleteState === "deleting"
                    ? "extensions.workflows.workflowHome.deleting"
                    : "extensions.workflows.workflowHome.confirmDelete",
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </main>
  );
}

function latestRunByWorkflow(
  workflows: readonly WorkflowSummary[],
  runs: readonly WorkflowRunSummary[],
): Map<string, WorkflowRunSummary> {
  const workflowIds = new Set(workflows.map(({ id }) => id));
  const latest = new Map<string, WorkflowRunSummary>();
  for (const run of runs) {
    if (!workflowIds.has(run.workflowId)) continue;
    const current = latest.get(run.workflowId);
    if (!current || run.updatedAt > current.updatedAt) latest.set(run.workflowId, run);
  }
  return latest;
}

interface GraphPreview {
  revision: string;
  graph: FlowGraph;
}

function previewRevision(workflow: WorkflowSummary): string {
  return `${workflow.draftRevision}:${workflow.updatedAt}`;
}

function useWorkflowGraphPreviews(
  workflows: readonly WorkflowSummary[],
): Map<string, GraphPreview> {
  const cache = useRef(new Map<string, GraphPreview>());
  const [, renderPreviews] = useState(0);

  useEffect(() => {
    const missing = workflows.filter(
      (workflow) => cache.current.get(workflow.id)?.revision !== previewRevision(workflow),
    );
    if (missing.length === 0) return;

    let active = true;
    void Promise.all(
      missing.map(async (workflow) => {
        try {
          const { document } = await workflowClient.read({
            workflowId: workflow.id,
            ...(workflow.scope.type === "project"
              ? { workspaceId: workflow.scope.workspaceId }
              : {}),
          });
          return {
            workflowId: workflow.id,
            preview: { revision: previewRevision(workflow), graph: document.graph },
          };
        } catch {
          return undefined;
        }
      }),
    ).then((results) => {
      if (!active) return;
      let changed = false;
      for (const result of results) {
        if (!result) continue;
        cache.current.set(result.workflowId, result.preview);
        changed = true;
      }
      if (changed) renderPreviews((version) => version + 1);
    });

    return () => {
      active = false;
    };
  }, [workflows]);

  return cache.current;
}

function AttentionItem({
  icon: Icon,
  count,
  label,
  tone = "default",
  onClick,
}: {
  icon: LucideIcon;
  count: number;
  label: string;
  tone?: "default" | "destructive";
  onClick(): void;
}) {
  return (
    <button
      type="button"
      className="border-border focus-visible:ring-ring flex min-h-20 cursor-pointer items-center gap-3 border-b px-4 text-start outline-none transition-colors hover:[background:var(--button-background-hover)] focus-visible:ring-2 sm:border-e sm:border-b-0 sm:last:border-e-0"
      onClick={onClick}
    >
      <span
        className={cn(
          "bg-muted flex size-[var(--button-height-large)] shrink-0 items-center justify-center rounded-[var(--button-radius)]",
          tone === "destructive" && "bg-destructive/10 text-destructive",
        )}
      >
        <Icon aria-hidden="true" className="size-[var(--icon-size-md)]" />
      </span>
      <span>
        <span className="block text-lg font-semibold tabular-nums">{count}</span>
        <span className="text-muted-foreground block text-xs">{label}</span>
      </span>
    </button>
  );
}

function WorkflowCard({
  workflow,
  graph,
  latestRun,
  projectName,
  onOpen,
  onOpenRuns,
  onDelete,
}: {
  workflow: WorkflowSummary;
  graph?: FlowGraph;
  latestRun?: WorkflowRunSummary;
  projectName?: string;
  onOpen(): void;
  onOpenRuns(): void;
  onDelete(): void;
}) {
  const { date, t } = useI18n();
  const published = Boolean(workflow.publishedRevisionId);
  const scopeLabel = t(
    workflow.scope.type === "personal"
      ? "extensions.workflows.workflowHome.personal"
      : "extensions.workflows.workflowHome.project",
  );
  const resolvedScopeLabel =
    workflow.scope.type === "project" ? (projectName ?? scopeLabel) : scopeLabel;
  const updatedAt = date(workflow.updatedAt, { dateStyle: "medium" });
  const ScopeIcon = workflow.scope.type === "personal" ? UserRoundIcon : FolderKanbanIcon;

  return (
    <article className="border-border bg-card text-card-foreground relative min-w-0 overflow-hidden rounded-[var(--radius-lg)] border transition-colors hover:border-foreground/20 focus-within:border-foreground/30">
      <button
        type="button"
        aria-label={t("extensions.workflows.workflowHome.openWorkflow", {
          name: workflow.name,
        })}
        className="focus-visible:ring-ring block w-full cursor-pointer text-start outline-none focus-visible:ring-2 focus-visible:ring-inset"
        onClick={onOpen}
      >
        <span className="border-border relative block h-36 w-full overflow-hidden border-b">
          <WorkflowGraphThumbnail graph={graph} />
          <span
            className={cn(
              "bg-background/90 absolute top-3 start-3 rounded-full border px-2 py-0.5 text-[11px] shadow-sm backdrop-blur-sm",
              published ? "border-primary/20 text-primary" : "border-border text-muted-foreground",
            )}
          >
            {t(
              published
                ? "extensions.workflows.workflowHome.published"
                : "extensions.workflows.workflowHome.draft",
            )}
          </span>
        </span>
      </button>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 p-3.5">
        <button
          type="button"
          className="focus-visible:ring-ring flex min-w-0 flex-1 basis-96 cursor-pointer items-center gap-3 rounded-[var(--button-radius)] text-start outline-none focus-visible:ring-2"
          onClick={onOpen}
        >
          <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-[var(--button-radius)]">
            <GitBranchIcon aria-hidden="true" className="size-[var(--icon-size-md)]" />
          </span>
          <span className="me-auto min-w-0 truncate text-sm font-semibold" title={workflow.name}>
            {workflow.name}
          </span>
          <span className="text-muted-foreground inline-flex min-w-0 max-w-40 shrink-0 items-center gap-1.5 text-xs">
            <ScopeIcon aria-hidden="true" className="size-[var(--icon-size-sm)]" />
            <span className="truncate" title={resolvedScopeLabel}>
              {resolvedScopeLabel}
            </span>
          </span>
          <span className="text-muted-foreground shrink-0 text-xs">
            {t("extensions.workflows.workflowHome.updated", { time: updatedAt })}
          </span>
          {latestRun ? (
            <span className="text-muted-foreground shrink-0 text-xs">
              <WorkflowRunStatus run={latestRun} />
            </span>
          ) : null}
        </button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t("extensions.workflows.workflowHome.viewRunsFor", {
            name: workflow.name,
          })}
          onClick={onOpenRuns}
        >
          <HistoryIcon aria-hidden="true" />
          {t("extensions.workflows.workflowHome.viewRuns")}
        </Button>
        {workflow.description ? (
          <button
            type="button"
            className="text-muted-foreground focus-visible:ring-ring -mt-0.5 w-full cursor-pointer rounded-[var(--button-radius)] text-start text-sm leading-5 outline-none focus-visible:ring-2"
            onClick={onOpen}
          >
            <span className="line-clamp-2">{workflow.description}</span>
          </button>
        ) : null}
      </div>
      <div className="absolute top-3 end-3 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="bg-background/90 text-muted-foreground shadow-sm backdrop-blur-sm hover:text-foreground"
                aria-label={t("extensions.workflows.workflowHome.moreActions", {
                  name: workflow.name,
                })}
              />
            }
          >
            <MoreHorizontalIcon aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom" sideOffset={4} className="min-w-40 p-1.5">
            <DropdownMenuItem className="min-h-9 gap-2 px-2.5" onClick={onOpen}>
              <PencilIcon aria-hidden="true" />
              {t("extensions.workflows.workflowHome.edit")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              className="min-h-9 gap-2 px-2.5"
              onClick={onDelete}
            >
              <Trash2Icon aria-hidden="true" />
              {t("extensions.workflows.workflowHome.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
}

function WorkflowRunStatus({ run }: { run: WorkflowRunSummary }) {
  const { date, t } = useI18n();
  const statusKey = RUN_STATUS_KEYS[run.status];
  const time = date(run.updatedAt, { dateStyle: "medium", timeStyle: "short" });
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5",
        run.status === "failed" || run.status === "interrupted"
          ? "text-destructive"
          : run.status === "succeeded"
            ? "text-foreground"
            : run.status === "cancelled"
              ? "text-muted-foreground"
              : "text-primary",
      )}
    >
      <CircleDotIcon aria-hidden="true" className="size-[var(--icon-size-sm)]" />
      {t("extensions.workflows.workflowHome.lastRun", {
        status: t(`extensions.workflows.workflowHome.runStatus.${statusKey}`),
        time,
      })}
    </span>
  );
}

function WorkflowEmptyState({
  onCreate,
  onOpenTemplates,
}: {
  onCreate(): void;
  onOpenTemplates(): void;
}) {
  const { t } = useI18n();
  return (
    <div className="border-border flex min-h-80 flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed p-6 text-center">
      <span className="bg-muted flex size-[var(--control-hit-touch)] items-center justify-center rounded-[var(--radius-lg)]">
        <GitBranchIcon aria-hidden="true" className="size-[var(--icon-size-lg)]" />
      </span>
      <h3 className="mt-4 text-sm font-semibold">{t("extensions.workflows.workflowHome.empty")}</h3>
      <p className="text-muted-foreground mt-2 max-w-md text-sm leading-6">
        {t("extensions.workflows.workflowHome.emptyDescription")}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button type="button" onClick={onCreate}>
          <PlusIcon aria-hidden="true" />
          {t("extensions.workflows.workflowHome.createBlank")}
        </Button>
        <Button type="button" variant="outline" onClick={onOpenTemplates}>
          <LayoutTemplateIcon aria-hidden="true" />
          {t("extensions.workflows.workflowHome.browseTemplates")}
        </Button>
      </div>
    </div>
  );
}
