import { WorkbenchAgentCapabilityError } from "@workbench/agent-runtime-client/capabilities";
import { MAX_AUTOMATION_DURATION_SECONDS } from "@workbench/automation-contracts";
import type { Translate } from "@workbench/shell/i18n";

export function automationSaveErrorMessage(error: unknown, t: Translate, editing: boolean): string {
  if (error instanceof WorkbenchAgentCapabilityError) {
    if (error.code === "conflict") {
      return t("extensions.automations.automationTask.saveConflict");
    }
    if (error.code === "invalid-request") {
      switch (error.details?.field) {
        case "name":
          return t("extensions.automations.automationTask.taskTitleRequired");
        case "prompt":
          return t("extensions.automations.automationTask.instructionsRequired");
        case "workspaceId":
          return t("extensions.automations.automationTask.workspaceRequired");
        case "schedule.maxDurationSeconds":
          return t("extensions.automations.automationTask.maxRunDurationInvalid", {
            max: MAX_AUTOMATION_DURATION_SECONDS / 60,
          });
        case "schedule":
          return t("extensions.automations.automationTask.scheduleInvalid");
        default:
          return t("extensions.automations.automationTask.invalidConfiguration");
      }
    }
  }
  return t(
    editing
      ? "extensions.automations.automationTask.saveFailed"
      : "extensions.automations.automationTask.createFailed",
  );
}
