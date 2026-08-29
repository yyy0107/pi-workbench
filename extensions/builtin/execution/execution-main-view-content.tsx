"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleStopIcon,
  FolderKanbanIcon,
  GitBranchIcon,
  HistoryIcon,
  LayoutTemplateIcon,
  PlayIcon,
  RefreshCwIcon,
  SaveIcon,
  UploadIcon,
  UserRoundIcon,
  type LucideIcon,
} from "lucide-react";

import { useRightWorkspace, useWorkspaceContext } from "@/components/right-workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { WorkspaceSelector } from "@/components/ui/workspace-selector";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { useMainViewService, type MainViewProps } from "@/platform/extensions";
import { usePiWorkspaces } from "@/runtime/pi/client/runtime/context";
import { workflowClient } from "@/runtime/pi/client/workflows/workflow-client";
import { PiApiError } from "@/runtime/pi/client/transport/api";
import type {
  FlowNode,
  WorkflowDocument,
  WorkflowKind,
  WorkflowRunEvent,
  WorkflowRunSummary,
  WorkflowScope,
} from "@/runtime/shared/execution";

import { AutomationHome } from "./automation/automation-home";
import { AutomationTaskForm } from "./automation/automation-task-form";
import { ProjectTrustDialog } from "@/components/ui/project-trust-dialog";
import { type WorkflowInspectorParams } from "./workflow/workflow-inspector";
import { workflowMainViewRequest, type WorkflowMainViewParams } from "./execution-main-view";
import { useWorkflowCatalogStore, useWorkflowEditorStore } from "./execution-state";
import { WorkflowRendererRouter } from "./execution-renderer-router";
import { WorkflowHome } from "./workflow/workflow-home";
import { createLinearWorkflowGraph } from "./workflow/workflow-template-utils";
import { useExecutionTrustAdmission } from "./use-execution-trust-admission";

const KIND_ICONS: Record<WorkflowKind, LucideIcon> = {
  workflow: GitBranchIcon,
};

export function ExecutionMainView({ view }: MainViewProps<WorkflowMainViewParams>) {
  switch (view.params.page) {
    case "workflows":
      return <WorkflowHome />;
    case "automations":
      return <AutomationHome />;
    case "automation-create":
      return <AutomationTaskForm key={view.params.preset ?? "blank"} params={view.params} />;
    case "automation-edit":
      return <AutomationTaskForm key={view.params.automationId} params={view.params} />;
    case "create":
      return <CreateWorkflowPage params={view.params} />;
    case "runs":
      return <RunsPage params={view.params} />;
    case "templates":
      return <TemplatesPage params={view.params} />;
    case "editor":
      return <WorkflowEditorPage workflowId={view.params.workflowId} />;
  }
}

function PageFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="bg-background flex h-full min-h-0 flex-col overflow-hidden">{children}</main>
  );
}

function PageHeader({
  icon: Icon,
  title,
  description,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="border-border flex min-h-14 shrink-0 items-center gap-3 border-b px-4">
      <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-[var(--button-radius)]">
        <Icon aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold">{title}</h1>
        {description ? (
          <p className="text-muted-foreground truncate text-xs">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </header>
  );
}

function CreateWorkflowPage({
  params,
}: {
  params: Extract<WorkflowMainViewParams, { page: "create" }>;
}) {
  const { t } = useI18n();
  const mainViews = useMainViewService();
  const workspaces = usePiWorkspaces();
  const kind = params.kind ?? "workflow";
  const [scopeType, setScopeType] = useState<WorkflowScope["type"]>(
    params.scope?.type ?? "personal",
  );
  const [workspaceId, setWorkspaceId] = useState(
    params.scope?.type === "project" ? params.scope.workspaceId : (workspaces[0]?.id ?? ""),
  );
  useEffect(() => {
    if (workspaces[0] && !workspaces.some(({ id }) => id === workspaceId)) {
      setWorkspaceId(workspaces[0].id);
    }
  }, [workspaceId, workspaces]);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();
  const selectedWorkspace = workspaces.find(({ id }) => id === workspaceId);

  const cancel = () => {
    if (kind === "workflow") {
      mainViews.open(workflowMainViewRequest({ page: "workflows" }));
    } else {
      mainViews.close();
    }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creating || (scopeType === "project" && !selectedWorkspace)) return;
    const scope: WorkflowScope =
      scopeType === "project"
        ? { type: "project", workspaceId: selectedWorkspace!.id }
        : { type: "personal" };
    setCreating(true);
    setError(undefined);
    try {
      const created = await workflowClient.create({
        kind,
        scope,
        name: name.trim() || t("extensions.workflows.create.namePlaceholder"),
      });
      await useWorkflowCatalogStore.getState().refresh();
      mainViews.open(
        workflowMainViewRequest({ page: "editor", workflowId: created.document.id, kind }),
      );
    } catch {
      setError(t("extensions.workflows.create.createFailed"));
    } finally {
      setCreating(false);
    }
  };
  return (
    <section
      aria-labelledby="workflow-create-title"
      className="bg-background h-full min-h-0 overflow-y-auto"
    >
      <form
        className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-10"
        onSubmit={(event) => void submit(event)}
      >
        <header>
          <h1
            id="workflow-create-title"
            className="text-foreground text-2xl font-semibold tracking-tight"
          >
            {t("extensions.workflows.create.title")}
          </h1>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            {t("extensions.workflows.create.description")}
          </p>
        </header>

        <section aria-labelledby="new-workflow-details-title" className="mt-8">
          <h2 id="new-workflow-details-title" className="text-base font-semibold">
            {t("extensions.workflows.create.details")}
          </h2>
          <div className="mt-4 flex flex-col gap-1.5">
            <label htmlFor="new-workflow-name" className="text-sm font-medium">
              {t("extensions.workflows.create.name")}
            </label>
            <Input
              id="new-workflow-name"
              autoFocus
              value={name}
              placeholder={t("extensions.workflows.create.namePlaceholder")}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </div>

          <fieldset className="mt-5">
            <legend className="text-sm font-medium">
              {t("extensions.workflows.create.scope")}
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <WorkflowScopeOption
                value="personal"
                selected={scopeType === "personal"}
                icon={UserRoundIcon}
                title={t("extensions.workflows.create.personal")}
                description={t("extensions.workflows.create.personalDescription")}
                onSelect={() => {
                  setScopeType("personal");
                  setError(undefined);
                }}
              />
              <WorkflowScopeOption
                value="project"
                selected={scopeType === "project"}
                disabled={workspaces.length === 0}
                icon={FolderKanbanIcon}
                title={t("extensions.workflows.create.project")}
                description={t(
                  workspaces.length === 0
                    ? "extensions.workflows.create.noWorkspace"
                    : "extensions.workflows.create.projectDescription",
                )}
                onSelect={() => {
                  setScopeType("project");
                  setError(undefined);
                }}
              />
            </div>
          </fieldset>

          {scopeType === "project" ? (
            <div className="mt-4 flex flex-col gap-1.5">
              <label htmlFor="new-workflow-workspace" className="text-sm font-medium">
                {t("extensions.workflows.create.workspace")}
              </label>
              <WorkspaceSelector
                triggerId="new-workflow-workspace"
                variant="outline"
                disabled={workspaces.length === 0}
                error={!selectedWorkspace}
                labels={{
                  select: t("extensions.workspaceDirectory.selectTitle"),
                  clear: t("extensions.workspaceDirectory.clearWorkspace"),
                  selecting: t("extensions.workspaceDirectory.selecting"),
                  selectError: t("extensions.workspaceDirectory.selectError"),
                  empty: t("extensions.workflows.create.noWorkspace"),
                  search: t("extensions.workspaceDirectory.searchLabel"),
                  searchPlaceholder: t("extensions.workspaceDirectory.searchPlaceholder"),
                  noSearchResults: t("extensions.workspaceDirectory.noSearchResults"),
                }}
                selectedWorkspace={selectedWorkspace}
                workspaces={workspaces}
                onValueChange={(value) => {
                  setWorkspaceId(value);
                  setError(undefined);
                }}
              />
              {!selectedWorkspace ? (
                <p className="text-destructive text-xs" role="alert">
                  {t("extensions.workflows.create.noWorkspace")}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="bg-muted/60 text-muted-foreground mt-5 flex items-start gap-2 rounded-[var(--button-radius)] p-3 text-xs leading-5">
            {scopeType === "project" ? (
              <FolderKanbanIcon
                aria-hidden="true"
                className="mt-0.5 size-[var(--icon-size-sm)] shrink-0"
              />
            ) : (
              <UserRoundIcon
                aria-hidden="true"
                className="mt-0.5 size-[var(--icon-size-sm)] shrink-0"
              />
            )}
            <span>
              {scopeType === "project"
                ? selectedWorkspace
                  ? t("extensions.workflows.create.projectSummary", {
                      project: selectedWorkspace.name,
                    })
                  : t("extensions.workflows.create.noWorkspace")
                : t("extensions.workflows.create.personalSummary")}
            </span>
          </div>

          <div className="min-h-5 pt-3">
            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}
          </div>

          <div className="border-border mt-3 flex flex-wrap justify-end gap-2 border-t pt-4">
            <Button type="button" variant="outline" disabled={creating} onClick={cancel}>
              {t("extensions.workflows.create.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={creating || (scopeType === "project" && !selectedWorkspace)}
            >
              {creating ? (
                <RefreshCwIcon aria-hidden="true" className="animate-spin" />
              ) : (
                <GitBranchIcon aria-hidden="true" />
              )}
              {t(
                creating
                  ? "extensions.workflows.create.creating"
                  : "extensions.workflows.create.submit",
              )}
            </Button>
          </div>
        </section>
      </form>
    </section>
  );
}

function WorkflowScopeOption({
  value,
  selected,
  disabled = false,
  icon: Icon,
  title,
  description,
  onSelect,
}: {
  value: WorkflowScope["type"];
  selected: boolean;
  disabled?: boolean;
  icon: LucideIcon;
  title: string;
  description: string;
  onSelect(): void;
}) {
  return (
    <label className={cn("min-w-0", disabled ? "cursor-not-allowed" : "cursor-pointer")}>
      <input
        type="radio"
        name="workflow-scope"
        value={value}
        checked={selected}
        disabled={disabled}
        className="peer sr-only"
        onChange={onSelect}
      />
      <span
        className={cn(
          "border-border flex min-h-[var(--control-hit-touch)] items-start gap-2 rounded-[var(--button-radius)] border p-2.5 transition-colors peer-focus-visible:ring-ring peer-focus-visible:ring-2",
          !disabled && "hover:bg-muted/50",
          selected && "border-primary bg-primary/5",
          disabled && "opacity-50",
        )}
      >
        <Icon aria-hidden="true" className="mt-0.5 size-[var(--icon-size-md)] shrink-0" />
        <span className="min-w-0">
          <span className="block text-sm font-medium">{title}</span>
          <span className="text-muted-foreground mt-0.5 block text-xs leading-4">
            {description}
          </span>
        </span>
      </span>
    </label>
  );
}

async function saveCurrentDraft(): Promise<WorkflowDocument | undefined> {
  const state = useWorkflowEditorStore.getState();
  if (!state.document) return undefined;
  if (state.saveState !== "dirty" && state.saveState !== "error") return state.document;
  const document = state.document;
  const version = state.beginSave();
  try {
    const saved = await workflowClient.saveDraft({
      workflowId: document.id,
      baseDraftRevision: document.draftRevision,
      draft: document,
    });
    useWorkflowEditorStore.getState().finishSave(saved.document, version);
    return saved.document;
  } catch (error) {
    useWorkflowEditorStore
      .getState()
      .failSave(
        error instanceof Error ? error.message : "workflow-save-failed",
        error instanceof PiApiError && error.code === "workflow-conflict",
      );
    return undefined;
  }
}

function WorkflowEditorPage({ workflowId }: { workflowId: string }) {
  const { t } = useI18n();
  const mainViews = useMainViewService();
  const workspaces = usePiWorkspaces();
  const rightWorkspace = useRightWorkspace();
  const workspaceContext = useWorkspaceContext();
  const workspaceApplicationId = workspaceContext.applicationId;
  const inspectorSurfaceIdRef = useRef<string | undefined>(undefined);
  const document = useWorkflowEditorStore((state) => state.document);
  const saveState = useWorkflowEditorStore((state) => state.saveState);
  const error = useWorkflowEditorStore((state) => state.error);
  const editVersion = useWorkflowEditorStore((state) => state.editVersion);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [action, setAction] = useState<"copy" | "publish" | "run">();
  const [notice, setNotice] = useState<string>();
  const [targetWorkspaceId, setTargetWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const trustAdmission = useExecutionTrustAdmission((nextError) => {
    setNotice(nextError instanceof Error ? nextError.message : "workflow-run-failed");
  });

  useEffect(() => {
    if (!targetWorkspaceId && workspaces[0]) setTargetWorkspaceId(workspaces[0].id);
  }, [targetWorkspaceId, workspaces]);

  const revealInspector = useCallback(() => {
    const currentDocument = useWorkflowEditorStore.getState().document;
    if (!currentDocument || currentDocument.id !== workflowId) return;

    inspectorSurfaceIdRef.current = rightWorkspace.reveal({
      kind: "workflow-inspector",
      title: currentDocument.name,
      params: { workflowId } satisfies WorkflowInspectorParams,
      context: { applicationId: workspaceApplicationId },
      scope: { type: "application", key: workspaceApplicationId },
      status: "ready",
      policy: "reveal",
    });
  }, [rightWorkspace, workflowId, workspaceApplicationId]);

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    void workflowClient
      .read({ workflowId })
      .then((value) => {
        if (cancelled) return;
        useWorkflowEditorStore.getState().load(value.document);
        setLoadState("ready");
      })
      .catch(() => !cancelled && setLoadState("error"));
    return () => {
      cancelled = true;
      const state = useWorkflowEditorStore.getState();
      if (state.document?.id === workflowId && state.saveState === "dirty") void saveCurrentDraft();
    };
  }, [workflowId]);

  useEffect(() => {
    if (!document || document.id !== workflowId) return;
    revealInspector();
  }, [document?.id, document?.name, revealInspector, workflowId]);

  useEffect(
    () => () => {
      if (inspectorSurfaceIdRef.current) {
        rightWorkspace.close(inspectorSurfaceIdRef.current);
      }
    },
    [rightWorkspace, workflowId],
  );

  useEffect(() => {
    if (!document || document.id !== workflowId || saveState !== "dirty") return;
    const timer = setTimeout(() => void saveCurrentDraft(), 500);
    return () => clearTimeout(timer);
  }, [document, editVersion, saveState, workflowId]);

  if (loadState === "error")
    return (
      <CenteredState icon={AlertTriangleIcon} label={t("extensions.workflows.editor.loadFailed")} />
    );
  if (loadState === "loading" || !document || document.id !== workflowId) {
    return (
      <CenteredState
        icon={RefreshCwIcon}
        label={t("extensions.workflows.editor.loading")}
        spin={loadState === "loading"}
      />
    );
  }
  const needsWorkspace = document.graph.nodes.some(({ type }) => type === "command");
  const run = async () => {
    setAction("run");
    setNotice(undefined);
    const saved = await saveCurrentDraft();
    if (!saved) {
      setAction(undefined);
      return;
    }
    try {
      const { workflowDirectory } = await workflowClient.read({ workflowId: saved.id });
      await trustAdmission.admit(workflowDirectory, async () => {
        await workflowClient.startRun({
          workflowId: saved.id,
          revisionSource: "draft",
          ...(saved.scope.type === "personal" && targetWorkspaceId ? { targetWorkspaceId } : {}),
        });
        setNotice(t("extensions.workflows.editor.runStarted"));
      });
    } catch (nextError) {
      setNotice(nextError instanceof Error ? nextError.message : "workflow-run-failed");
    } finally {
      setAction(undefined);
    }
  };
  const publish = async () => {
    setAction("publish");
    setNotice(undefined);
    const saved = await saveCurrentDraft();
    if (!saved) {
      setAction(undefined);
      return;
    }
    try {
      const result = await workflowClient.publish({
        workflowId: saved.id,
        baseDraftRevision: saved.draftRevision,
      });
      useWorkflowEditorStore.getState().load(result.document);
      setNotice(t("extensions.workflows.editor.publishSucceeded"));
      await useWorkflowCatalogStore.getState().refresh();
    } catch (nextError) {
      setNotice(
        nextError instanceof Error
          ? nextError.message
          : t("extensions.workflows.editor.validationFailed"),
      );
    } finally {
      setAction(undefined);
    }
  };
  const saveAsCopy = async () => {
    setAction("copy");
    setNotice(undefined);
    try {
      const created = await workflowClient.create({
        kind: document.kind,
        scope: document.scope,
        name: t("extensions.workflows.editor.copyName", { name: document.name }),
      });
      const copied = await workflowClient.saveDraft({
        workflowId: created.document.id,
        baseDraftRevision: created.document.draftRevision,
        draft: {
          ...created.document,
          ...(document.description === undefined ? {} : { description: document.description }),
          agents: document.agents,
          graph: document.graph,
          concurrency: document.concurrency,
        },
      });
      const resourceReferences = new Map(
        [
          ...document.agents.map((agent) => ({
            agentId: agent.id,
            promptTemplate: "default",
          })),
          ...document.graph.nodes.flatMap((node) =>
            node.type === "agent"
              ? [
                  {
                    agentId: node.config.agentId,
                    promptTemplate: node.config.promptTemplate ?? "default",
                  },
                ]
              : [],
          ),
        ].map((reference) => [`${reference.agentId}\0${reference.promptTemplate}`, reference]),
      );
      await Promise.all(
        [...resourceReferences.values()].map(async (reference) => {
          const resources = await workflowClient.readAgentResources({
            workflowId: document.id,
            ...reference,
          });
          await workflowClient.updateAgentResources({
            workflowId: copied.document.id,
            ...reference,
            prompt: resources.prompt,
            ...(resources.model ? { model: resources.model } : {}),
          });
        }),
      );
      await useWorkflowCatalogStore.getState().refresh();
      mainViews.open(
        workflowMainViewRequest({
          page: "editor",
          workflowId: copied.document.id,
          kind: copied.document.kind,
        }),
      );
    } catch (nextError) {
      setNotice(nextError instanceof Error ? nextError.message : "workflow-copy-failed");
    } finally {
      setAction(undefined);
    }
  };

  return (
    <>
      <PageFrame>
        <PageHeader
          icon={KIND_ICONS[document.kind]}
          title={document.name}
          description={`${t(`extensions.workflows.kind.${document.kind}`)} · ${t(`extensions.workflows.save.${saveState}`)}`}
          actions={
            <>
              {document.scope.type === "personal" && needsWorkspace ? (
                <Select
                  aria-label={t("extensions.workflows.create.workspace")}
                  className="hidden w-auto max-w-40 text-xs sm:block"
                  value={targetWorkspaceId}
                  onChange={(event) => setTargetWorkspaceId(event.currentTarget.value)}
                >
                  <option value="">—</option>
                  {workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </Select>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                disabled={
                  Boolean(action) ||
                  (document.scope.type === "personal" && needsWorkspace && !targetWorkspaceId)
                }
                onClick={() => void run()}
              >
                {action === "run" ? <RefreshCwIcon className="animate-spin" /> : <PlayIcon />}
                <span className="hidden sm:inline">
                  {t(
                    action === "run"
                      ? "extensions.workflows.actions.running"
                      : "extensions.workflows.actions.run",
                  )}
                </span>
              </Button>
              <Button
                size="sm"
                disabled={Boolean(action) || saveState === "conflict"}
                onClick={() => void publish()}
              >
                {action === "publish" ? <RefreshCwIcon className="animate-spin" /> : <UploadIcon />}
                <span className="hidden sm:inline">
                  {t(
                    action === "publish"
                      ? "extensions.workflows.actions.publishing"
                      : "extensions.workflows.actions.publish",
                  )}
                </span>
              </Button>
            </>
          }
        />
        {saveState === "conflict" || saveState === "error" || notice ? (
          <div
            role="status"
            className={cn(
              "border-border flex shrink-0 items-center gap-2 border-b px-4 py-2 text-xs",
              saveState === "conflict" || saveState === "error"
                ? "text-destructive"
                : "text-muted-foreground",
            )}
          >
            {saveState === "conflict" ? (
              <AlertTriangleIcon className="size-4" />
            ) : (
              <SaveIcon className="size-4" />
            )}
            <span className="min-w-0 flex-1 truncate">{error ?? notice}</span>
            {saveState === "conflict" ? (
              <div className="flex shrink-0 gap-1">
                <Button size="xs" variant="outline" disabled={Boolean(action)} onClick={saveAsCopy}>
                  {action === "copy" ? <RefreshCwIcon className="animate-spin" /> : null}
                  {t("extensions.workflows.actions.copy")}
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={Boolean(action)}
                  onClick={() => {
                    setLoadState("loading");
                    void workflowClient.read({ workflowId }).then((value) => {
                      useWorkflowEditorStore.getState().load(value.document);
                      setLoadState("ready");
                    });
                  }}
                >
                  {t("extensions.workflows.actions.reload")}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="min-h-0 flex-1">
          <WorkflowRendererRouter document={document} onNodeSelect={revealInspector} />
        </div>
      </PageFrame>
      <ProjectTrustDialog variant="workflow" {...trustAdmission.dialog} />
    </>
  );
}

function CenteredState({
  icon: Icon,
  label,
  spin = false,
}: {
  icon: LucideIcon;
  label: string;
  spin?: boolean;
}) {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center gap-3 text-sm">
      <Icon className={cn("size-5", spin && "animate-spin")} />
      {label}
    </div>
  );
}

function RunsPage({ params }: { params: Extract<WorkflowMainViewParams, { page: "runs" }> }) {
  const { t } = useI18n();
  const mainViews = useMainViewService();
  const catalogRuns = useWorkflowCatalogStore((state) => state.runs);
  const [runs, setRuns] = useState(() =>
    params.kind
      ? catalogRuns.filter(({ workflowKind }) => workflowKind === params.kind)
      : catalogRuns,
  );
  const [events, setEvents] = useState<WorkflowRunEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const selected = runs.find(({ id }) => id === params.runId);
  useEffect(() => {
    setRuns(
      params.kind
        ? catalogRuns.filter(({ workflowKind }) => workflowKind === params.kind)
        : catalogRuns,
    );
  }, [catalogRuns, params.kind]);
  useEffect(() => {
    setLoading(true);
    void workflowClient
      .listRuns({ workflowId: params.workflowId, limit: 200 })
      .then(({ items }) => {
        setRuns(
          params.kind ? items.filter(({ workflowKind }) => workflowKind === params.kind) : items,
        );
        setLoading(false);
      });
  }, [params.kind, params.workflowId]);
  useEffect(() => {
    if (!params.runId) {
      setEvents([]);
      return;
    }
    void workflowClient
      .readRun({ runId: params.runId, afterSeq: 0, limit: 1000 })
      .then((value) => setEvents(value.events));
  }, [params.runId]);
  return (
    <PageFrame>
      <PageHeader icon={HistoryIcon} title={t("extensions.workflows.runs.title")} />
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(16rem,22rem)_1fr]">
        <div className="border-border min-h-0 overflow-y-auto border-e p-2">
          {loading ? (
            <p className="text-muted-foreground p-3 text-sm">
              {t("extensions.workflows.runs.loading")}
            </p>
          ) : runs.length === 0 ? (
            <p className="text-muted-foreground p-3 text-sm">
              {t("extensions.workflows.runs.empty")}
            </p>
          ) : (
            runs.map((run) => (
              <button
                key={run.id}
                type="button"
                aria-current={run.id === params.runId ? "page" : undefined}
                className={cn(
                  "hover:bg-muted focus-visible:ring-ring mb-1 flex w-full flex-col rounded-[var(--button-radius)] px-3 py-2 text-start outline-none focus-visible:ring-2",
                  run.id === params.runId && "bg-muted",
                )}
                onClick={() =>
                  mainViews.open(
                    workflowMainViewRequest({
                      page: "runs",
                      workflowId: params.workflowId,
                      runId: run.id,
                      ...(params.kind ? { kind: params.kind } : {}),
                    }),
                  )
                }
              >
                <span className="flex w-full items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {run.workflowName}
                  </span>
                  <RunStatus status={run.status} />
                </span>
                <span className="text-muted-foreground mt-1 text-xs">
                  {new Date(run.createdAt).toLocaleString()} · {run.source}
                </span>
              </button>
            ))
          )}
        </div>
        <div className="min-h-0 overflow-y-auto p-4 sm:p-6">
          {selected ? (
            <RunDetail run={selected} events={events} />
          ) : (
            <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
              {t("extensions.workflows.runs.detail")}
            </div>
          )}
        </div>
      </div>
    </PageFrame>
  );
}

function RunStatus({ status }: { status: WorkflowRunSummary["status"] }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px]",
        status === "succeeded"
          ? "bg-emerald-500/10 text-emerald-600"
          : status === "failed" || status === "cancelled" || status === "interrupted"
            ? "bg-destructive/10 text-destructive"
            : "bg-primary/10 text-primary",
      )}
    >
      {status}
    </span>
  );
}

function RunDetail({ run, events }: { run: WorkflowRunSummary; events: WorkflowRunEvent[] }) {
  const { t } = useI18n();
  const waiting = run.attempts.find(({ status }) => status === "waiting-for-approval");
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold">{run.workflowName}</h2>
        <div className="text-muted-foreground mt-2 flex flex-wrap gap-3 text-xs">
          <span>
            {t("extensions.workflows.runs.status")}: {run.status}
          </span>
          <span>
            {t("extensions.workflows.runs.source")}: {run.source}
          </span>
          <span>{run.id}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {waiting ? (
          <>
            <Button
              size="sm"
              onClick={() =>
                void workflowClient.resolveApproval({
                  runId: run.id,
                  nodeId: waiting.nodeId,
                  approved: true,
                })
              }
            >
              <CheckCircle2Icon />
              {t("extensions.workflows.runs.approve")}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() =>
                void workflowClient.resolveApproval({
                  runId: run.id,
                  nodeId: waiting.nodeId,
                  approved: false,
                })
              }
            >
              <CircleStopIcon />
              {t("extensions.workflows.runs.reject")}
            </Button>
          </>
        ) : null}
        {["queued", "running", "waiting-for-approval"].includes(run.status) ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void workflowClient.cancelRun({ runId: run.id })}
          >
            {t("extensions.workflows.runs.cancel")}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void workflowClient.startRun({
              workflowId: run.workflowId,
              revisionSource: "published",
              revisionId: run.revisionId,
              source: "replay",
              ...(run.targetWorkspaceId ? { targetWorkspaceId: run.targetWorkspaceId } : {}),
              ...(run.input === undefined ? {} : { input: run.input }),
            })
          }
        >
          <PlayIcon />
          {t("extensions.workflows.runs.runAgain")}
        </Button>
      </div>
      <section>
        <h3 className="mb-2 text-sm font-medium">{t("extensions.workflows.runs.events")}</h3>
        <ol className="border-border ms-2 border-s ps-4">
          {events.map((event) => (
            <li key={event.seq} className="relative pb-4 text-xs last:pb-0">
              <span className="bg-border absolute top-1.5 -left-[1.19rem] size-2 rounded-full" />
              <div className="font-medium">
                {event.type}
                {event.nodeId ? ` · ${event.nodeId}` : ""}
              </div>
              <div className="text-muted-foreground mt-0.5">
                #{event.seq} · {new Date(event.time).toLocaleString()}
                {event.status ? ` · ${event.status}` : ""}
              </div>
              {event.message ? (
                <pre className="bg-muted mt-2 overflow-x-auto rounded p-2 whitespace-pre-wrap">
                  {event.message}
                </pre>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

interface WorkflowTemplate {
  id: string;
  kind: WorkflowKind;
  nameKey: "prReview";
  descriptionKey: "prReviewDescription";
  apply(document: WorkflowDocument, labels: Record<FlowNode["type"], string>): WorkflowDocument;
}

const TEMPLATES: WorkflowTemplate[] = [
  {
    id: "pr-review",
    kind: "workflow",
    nameKey: "prReview",
    descriptionKey: "prReviewDescription",
    apply(document, labels) {
      return createLinearWorkflowGraph(document, [
        {
          id: globalThis.crypto.randomUUID(),
          type: "command",
          name: "Inspect changes",
          position: { x: 0, y: 0 },
          config: { command: "git diff --stat && git diff --check" },
        },
        {
          id: globalThis.crypto.randomUUID(),
          type: "agent",
          name: labels.agent,
          position: { x: 0, y: 0 },
          config: {
            agentId: "reviewer",
            promptTemplate: "default",
            output: { schema: {} },
          },
        },
        {
          id: globalThis.crypto.randomUUID(),
          type: "approval",
          name: labels.approval,
          position: { x: 0, y: 0 },
          config: { message: "Approve the review summary?" },
        },
      ]);
    },
  },
];

function templateAgentPrompt(
  templateId: string,
  node: Extract<FlowNode, { type: "agent" }>,
): string {
  switch (templateId) {
    case "daily-summary":
      return "Summarize today's workspace activity, decisions, risks, and next actions.";
    case "pr-review":
      return "Review the current changes for correctness, regressions, security issues, and missing tests.";
    default:
      return `Complete the ${node.name} step and report findings.`;
  }
}

function TemplatesPage({
  params,
}: {
  params: Extract<WorkflowMainViewParams, { page: "templates" }>;
}) {
  const { t } = useI18n();
  const mainViews = useMainViewService();
  const [creating, setCreating] = useState<string>();
  const labels: Record<FlowNode["type"], string> = {
    start: t("extensions.workflows.node.start"),
    end: t("extensions.workflows.node.end"),
    agent: t("extensions.workflows.node.agent"),
    command: t("extensions.workflows.node.command"),
    condition: t("extensions.workflows.node.condition"),
    approval: t("extensions.workflows.node.approval"),
  };
  const templates = params.kind ? TEMPLATES.filter(({ kind }) => kind === params.kind) : TEMPLATES;
  const useTemplate = async (template: WorkflowTemplate) => {
    setCreating(template.id);
    try {
      const created = await workflowClient.create({
        kind: template.kind,
        scope: { type: "personal" },
        name: t(`extensions.workflows.templates.${template.nameKey}`),
      });
      const saved = await workflowClient.saveDraft({
        workflowId: created.document.id,
        baseDraftRevision: created.document.draftRevision,
        draft: template.apply(created.document, labels),
      });
      await Promise.all(
        saved.document.graph.nodes.flatMap((node) =>
          node.type === "agent"
            ? [
                workflowClient.updateAgentResources({
                  workflowId: saved.document.id,
                  agentId: node.config.agentId,
                  promptTemplate: node.config.promptTemplate ?? "default",
                  prompt: templateAgentPrompt(template.id, node),
                }),
              ]
            : [],
        ),
      );
      await useWorkflowCatalogStore.getState().refresh();
      mainViews.open(workflowMainViewRequest({ page: "editor", workflowId: saved.document.id }));
    } finally {
      setCreating(undefined);
    }
  };
  return (
    <PageFrame>
      <PageHeader
        icon={LayoutTemplateIcon}
        title={t("extensions.workflows.templates.title")}
        description={t("extensions.workflows.templates.description")}
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-8">
        <div className="mx-auto grid max-w-5xl gap-3 md:grid-cols-3">
          {templates.map((template) => {
            const Icon = KIND_ICONS[template.kind];
            return (
              <section
                key={template.id}
                className="flex min-h-56 flex-col rounded-[var(--radius-xl)] border p-5"
              >
                <span className="bg-muted flex size-9 items-center justify-center rounded-[var(--button-radius)]">
                  <Icon />
                </span>
                <h2 className="mt-4 text-sm font-semibold">
                  {t(`extensions.workflows.templates.${template.nameKey}`)}
                </h2>
                <p className="text-muted-foreground mt-2 flex-1 text-xs leading-relaxed">
                  {t(`extensions.workflows.templates.${template.descriptionKey}`)}
                </p>
                <Button
                  className="mt-4 self-start"
                  variant="outline"
                  disabled={creating === template.id}
                  onClick={() => void useTemplate(template)}
                >
                  {creating === template.id ? (
                    <RefreshCwIcon className="animate-spin" />
                  ) : (
                    <LayoutTemplateIcon />
                  )}
                  {t("extensions.workflows.templates.use")}
                </Button>
              </section>
            );
          })}
        </div>
      </div>
    </PageFrame>
  );
}
