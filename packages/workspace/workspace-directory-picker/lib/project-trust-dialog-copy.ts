import { directoryPickerTranslationBundle } from "../src/i18n";
import type { CatalogTranslate } from "@workbench/i18n/runtime";
import type { ProjectTrustDialogCopy } from "@workbench/ui";

type Translate = CatalogTranslate<(typeof directoryPickerTranslationBundle.messages)["en-US"]>;

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
