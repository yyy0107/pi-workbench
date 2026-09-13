import {
  defineTranslationBundle,
  createTranslationBundleMessageFactory,
} from "@workbench/i18n/runtime";
import { messages as enUS } from "./en-US";
import { messages as zhCN } from "./zh-CN";
export const automationUiTranslationBundle = defineTranslationBundle({
  id: "workbench.automation-ui",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});
export const defineAutomationUiMessage = createTranslationBundleMessageFactory(
  automationUiTranslationBundle,
);

import type { CatalogTranslate } from "@workbench/i18n/runtime";
export type AutomationUiTranslate = CatalogTranslate<typeof enUS>;
