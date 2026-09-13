import type { ReactNode } from "react";
import { I18nProvider, type Locale } from "@workbench/i18n";
import { browserTranslationBundle } from "../src/i18n";
import { uiTranslationBundle } from "@workbench/ui/i18n";
import { workspaceTranslationBundle } from "@workbench/ui-workspace/i18n";
import { directoryPickerTranslationBundle } from "@workbench/workspace-directory-picker/i18n";
import { settingsUiTranslationBundle } from "@workbench/ui-settings/i18n";
const bundles = [
  browserTranslationBundle,
  uiTranslationBundle,
  workspaceTranslationBundle,
  directoryPickerTranslationBundle,
  settingsUiTranslationBundle,
];
export function BrowserTestI18nProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  return (
    <I18nProvider locale={initialLocale} onLocaleChange={() => {}} bundles={bundles}>
      {children}
    </I18nProvider>
  );
}
