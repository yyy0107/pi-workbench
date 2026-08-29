import { defineMessage } from "@/i18n";
import type { MainViewBreadcrumbs, OpenMainViewRequest } from "@/platform/extensions/authoring";
import type { WorkflowKind, WorkflowScope } from "@/runtime/shared/execution";

import type { AutomationTaskPreset } from "./automation-task-presets";

export const WORKFLOW_MAIN_VIEW_KIND = "workflows";
export const WORKFLOW_MAIN_VIEW_TITLE = defineMessage("extensions.workflows.title");
const WORKFLOW_HOME_TITLE = defineMessage("extensions.workflows.workflowHome.title");
const AUTOMATION_MAIN_VIEW_TITLE = defineMessage("extensions.workflows.automationHome.title");
const NEW_AUTOMATION_TASK_TITLE = defineMessage("extensions.workflows.breadcrumb.newTask");
const CREATE_WORKFLOW_TITLE = defineMessage("extensions.workflows.create.title");
const EDIT_WORKFLOW_TITLE = defineMessage("extensions.workflows.breadcrumb.editor");
const WORKFLOW_RUNS_TITLE = defineMessage("extensions.workflows.runs.title");
const WORKFLOW_TEMPLATES_TITLE = defineMessage("extensions.workflows.templates.title");

export type WorkflowMainViewParams =
  | { page: "workflows" }
  | { page: "automations" }
  | { page: "automation-create"; preset?: AutomationTaskPreset }
  | { page: "automation-edit"; workflowId: string }
  | { page: "editor"; workflowId: string; kind?: Exclude<WorkflowKind, "automation"> }
  | { page: "create"; kind?: WorkflowKind; scope?: WorkflowScope }
  | { page: "runs"; workflowId?: string; runId?: string; kind?: WorkflowKind }
  | { page: "templates"; kind?: WorkflowKind };

function collectionBreadcrumb(
  kind: WorkflowKind | undefined,
): MainViewBreadcrumbs<WorkflowMainViewParams>[number] {
  if (kind === "workflow") return { label: WORKFLOW_HOME_TITLE, params: { page: "workflows" } };
  if (kind === "automation") {
    return { label: AUTOMATION_MAIN_VIEW_TITLE, params: { page: "automations" } };
  }
  return { label: WORKFLOW_MAIN_VIEW_TITLE, closeView: true };
}

function workflowMainViewPresentation(params: WorkflowMainViewParams): {
  title: OpenMainViewRequest<WorkflowMainViewParams>["title"];
  breadcrumbs: MainViewBreadcrumbs<WorkflowMainViewParams>;
} {
  switch (params.page) {
    case "workflows":
      return {
        title: WORKFLOW_HOME_TITLE,
        breadcrumbs: [{ label: WORKFLOW_HOME_TITLE }],
      };
    case "automations":
      return {
        title: AUTOMATION_MAIN_VIEW_TITLE,
        breadcrumbs: [{ label: AUTOMATION_MAIN_VIEW_TITLE }],
      };
    case "automation-create":
      return {
        title: NEW_AUTOMATION_TASK_TITLE,
        breadcrumbs: [
          { label: AUTOMATION_MAIN_VIEW_TITLE, params: { page: "automations" } },
          { label: NEW_AUTOMATION_TASK_TITLE },
        ],
      };
    case "automation-edit":
      return {
        title: EDIT_WORKFLOW_TITLE,
        breadcrumbs: [
          { label: AUTOMATION_MAIN_VIEW_TITLE, params: { page: "automations" } },
          { label: EDIT_WORKFLOW_TITLE },
        ],
      };
    case "create":
      return {
        title: CREATE_WORKFLOW_TITLE,
        breadcrumbs: [collectionBreadcrumb(params.kind), { label: CREATE_WORKFLOW_TITLE }],
      };
    case "editor":
      return {
        title: EDIT_WORKFLOW_TITLE,
        breadcrumbs: [collectionBreadcrumb(params.kind), { label: EDIT_WORKFLOW_TITLE }],
      };
    case "runs":
      return {
        title: WORKFLOW_RUNS_TITLE,
        breadcrumbs: [collectionBreadcrumb(params.kind), { label: WORKFLOW_RUNS_TITLE }],
      };
    case "templates":
      return {
        title: WORKFLOW_TEMPLATES_TITLE,
        breadcrumbs: [collectionBreadcrumb(params.kind), { label: WORKFLOW_TEMPLATES_TITLE }],
      };
  }
}

export function workflowMainViewRequest(
  params: WorkflowMainViewParams,
): OpenMainViewRequest<WorkflowMainViewParams> {
  return {
    kind: WORKFLOW_MAIN_VIEW_KIND,
    ...workflowMainViewPresentation(params),
    params,
  };
}
