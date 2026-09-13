import type { ProjectTrustDialogCopy } from "@workbench/ui";
import type { useDirectoryPickerI18n } from "../src/use-i18n";
type Translate = ReturnType<typeof useDirectoryPickerI18n>["t"];

export function workspaceProjectTrustDialogCopy(t: Translate): ProjectTrustDialogCopy {
  return {
    accept: t("extensions.workspaceDirectory.trustAccept"),
    cancel: t("extensions.workspaceDirectory.trustCancel"),
    decline: t("extensions.workspaceDirectory.trustDecline"),
    description: t("extensions.workspaceDirectory.trustDescription"),
    question: t("extensions.workspaceDirectory.trustQuestion"),
    saveError: t("extensions.workspaceDirectory.trustSaveError"),
    saving: t("extensions.workspaceDirectory.trustSaving"),
    securityDecision: t("extensions.workspaceDirectory.trustSecurityDecision"),
    selectError: t("extensions.workspaceDirectory.selectError"),
  };
}
