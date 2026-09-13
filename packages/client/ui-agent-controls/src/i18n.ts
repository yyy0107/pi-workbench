import {
  defineTranslationBundle,
  createTranslationBundleMessageFactory,
} from "@workbench/i18n/runtime";
import { messages as enUS } from "./i18n/en-US";
import { messages as zhCN } from "./i18n/zh-CN";
export const agentControlsTranslationBundle = defineTranslationBundle({
  id: "workbench.agent-controls",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});
export const defineAgentControlsMessage = createTranslationBundleMessageFactory(
  agentControlsTranslationBundle,
);

import type { CatalogTranslate, StaticMessageKeyOf } from "@workbench/i18n/runtime";
export type AgentControlsTranslate = CatalogTranslate<typeof enUS>;
export type AgentControlsStaticMessageKey = StaticMessageKeyOf<typeof enUS>;
