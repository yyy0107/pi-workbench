import type { ProjectTrustDialogCopy } from "@workbench/shell/ui";
import type { Translate } from "@workbench/shell/i18n";

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
