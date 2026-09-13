import type { ProjectTrustDialogCopy } from "@workbench/ui";

import type { AutomationUiTranslate as Translate } from "../src/i18n";

export function automationProjectTrustDialogCopy(t: Translate): ProjectTrustDialogCopy {
  return {
    accept: t("extensions.automations.trust.accept"),
    cancel: t("extensions.automations.trust.cancel"),
    decline: t("extensions.automations.trust.decline"),
    description: t("extensions.automations.trust.description"),
    question: t("extensions.automations.trust.question"),
    saveError: t("extensions.automations.trust.saveError"),
    saving: t("extensions.automations.trust.saving"),
    securityDecision: t("extensions.automations.trust.securityDecision"),
    selectError: t("extensions.automations.trust.selectError"),
  };
}
