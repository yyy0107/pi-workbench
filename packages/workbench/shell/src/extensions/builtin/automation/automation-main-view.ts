import type { MainViewBreadcrumbs, OpenMainViewRequest } from "@workbench/extension-sdk";

import { defineMessage } from "@workbench/shell/i18n";
import type { AutomationTaskPreset } from "./automation/automation-task-presets";

export const AUTOMATION_MAIN_VIEW_KIND = "automations";
const AUTOMATION_MAIN_VIEW_TITLE = defineMessage("extensions.automations.automationHome.title");
const NEW_AUTOMATION_TASK_TITLE = defineMessage("extensions.automations.breadcrumb.newTask");
const EDIT_AUTOMATION_TASK_TITLE = defineMessage("extensions.automations.breadcrumb.editor");

export type AutomationMainViewParams =
  | { page: "automations" }
  | { page: "automation-create"; preset?: AutomationTaskPreset }
  | { page: "automation-edit"; automationId: string };

function presentation(params: AutomationMainViewParams): {
  title: OpenMainViewRequest<AutomationMainViewParams>["title"];
  breadcrumbs: MainViewBreadcrumbs<AutomationMainViewParams>;
} {
  if (params.page === "automations") {
    return {
      title: AUTOMATION_MAIN_VIEW_TITLE,
      breadcrumbs: [{ label: AUTOMATION_MAIN_VIEW_TITLE }],
    };
  }
  const title =
    params.page === "automation-create" ? NEW_AUTOMATION_TASK_TITLE : EDIT_AUTOMATION_TASK_TITLE;
  return {
    title,
    breadcrumbs: [
      { label: AUTOMATION_MAIN_VIEW_TITLE, params: { page: "automations" } },
      { label: title },
    ],
  };
}

export function automationMainViewRequest(
  params: AutomationMainViewParams,
): OpenMainViewRequest<AutomationMainViewParams> {
  return {
    kind: AUTOMATION_MAIN_VIEW_KIND,
    ...presentation(params),
    params,
  };
}
