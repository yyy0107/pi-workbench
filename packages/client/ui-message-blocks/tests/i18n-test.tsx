import { createElement, type ReactNode } from "react";
import { I18nProvider as SharedI18nProvider } from "@workbench/i18n";
import { createI18n as createRuntime, type Locale } from "@workbench/i18n/runtime";
import { conversationTranslationBundle, defineConversationMessage } from "../src/i18n";
import { uiTranslationBundle } from "@workbench/ui/i18n";
import { codeHighlightingTranslationBundle } from "@workbench/code-highlighting/i18n";
import { markdownTranslationBundle } from "@workbench/markdown/i18n";
import { filesTranslationBundle } from "@workbench/workspace-files/i18n";
import { workspaceTranslationBundle } from "@workbench/workspace-runtime/i18n";
import { composerTranslationBundle as attachmentTranslationBundle } from "@workbench/ui-attachment/i18n";
const bundles = [
  conversationTranslationBundle,
  uiTranslationBundle,
  codeHighlightingTranslationBundle,
  markdownTranslationBundle,
  filesTranslationBundle,
  workspaceTranslationBundle,
  attachmentTranslationBundle,
];
export function I18nProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  return createElement(SharedI18nProvider, {
    locale: initialLocale,
    onLocaleChange: () => {},
    bundles,
    children,
  });
}
export function createI18n(locale: Locale) {
  return createRuntime(locale, bundles);
}
export const defineMessage = defineConversationMessage;
