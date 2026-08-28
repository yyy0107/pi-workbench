import { defineMessage } from "@/i18n";
import type { MainViewBreadcrumbs, OpenMainViewRequest } from "@/platform/extensions/authoring";
import type { WorkflowKind, WorkflowScope } from "@/runtime/shared/execution";

export const WORKFLOW_MAIN_VIEW_KIND = "workflows";
export const WORKFLOW_MAIN_VIEW_TITLE = defineMessage("extensions.workflows.title");
const AUTOMATION_MAIN_VIEW_TITLE = defineMessage("extensions.workflows.automationHome.title");
const NEW_AUTOMATION_TASK_TITLE = defineMessage("extensions.workflows.breadcrumb.newTask");
const CREATE_WORKFLOW_TITLE = defineMessage("extensions.workflows.create.title");
const EDIT_WORKFLOW_TITLE = defineMessage("extensions.workflows.breadcrumb.editor");
const WORKFLOW_RUNS_TITLE = defineMessage("extensions.workflows.runs.title");
const WORKFLOW_TEMPLATES_TITLE = defineMessage("extensions.workflows.templates.title");

export type AutomationTaskPreset = "morning-briefing" | "risk-scan";

export type WorkflowMainViewParams =
  | { page: "automations" }
  | { page: "automation-create"; preset?: AutomationTaskPreset }
  | { page: "automation-edit"; workflowId: string }
  | { page: "editor"; workflowId: string }
  | { page: "create"; kind?: WorkflowKind; scope?: WorkflowScope }
  | { page: "runs"; workflowId?: string; runId?: string }
  | { page: "templates"; kind?: WorkflowKind };

function workflowMainViewPresentation(params: WorkflowMainViewParams): {
  title: OpenMainViewRequest<WorkflowMainViewParams>["title"];
  breadcrumbs: MainViewBreadcrumbs<WorkflowMainViewParams>;
} {
  switch (params.page) {
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
        breadcrumbs: [{ label: WORKFLOW_MAIN_VIEW_TITLE }, { label: CREATE_WORKFLOW_TITLE }],
      };
    case "editor":
      return {
        title: EDIT_WORKFLOW_TITLE,
        breadcrumbs: [{ label: WORKFLOW_MAIN_VIEW_TITLE }, { label: EDIT_WORKFLOW_TITLE }],
      };
    case "runs":
      return {
        title: WORKFLOW_RUNS_TITLE,
        breadcrumbs: [{ label: WORKFLOW_MAIN_VIEW_TITLE }, { label: WORKFLOW_RUNS_TITLE }],
      };
    case "templates":
      return {
        title: WORKFLOW_TEMPLATES_TITLE,
        breadcrumbs: [{ label: WORKFLOW_MAIN_VIEW_TITLE }, { label: WORKFLOW_TEMPLATES_TITLE }],
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
