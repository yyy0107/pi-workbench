import type { ProjectTrustDialogCopy } from "@workbench/shell/ui";

import type { PiTranslate } from "../i18n";

export function workflowProjectTrustDialogCopy(t: PiTranslate): ProjectTrustDialogCopy {
  return {
    accept: t("extensions.workflows.trust.accept"),
    cancel: t("extensions.workflows.trust.cancel"),
    decline: t("extensions.workflows.trust.decline"),
    description: t("extensions.workflows.trust.description"),
    question: t("extensions.workflows.trust.question"),
    saveError: t("extensions.workflows.trust.saveError"),
    saving: t("extensions.workflows.trust.saving"),
    securityDecision: t("extensions.workflows.trust.securityDecision"),
    selectError: t("extensions.workflows.trust.selectError"),
  };
}

export function workspaceProjectTrustDialogCopy(t: PiTranslate): ProjectTrustDialogCopy {
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
