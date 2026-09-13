import {
  defineTranslationBundle,
  createTranslationBundleMessageFactory,
} from "@workbench/i18n/runtime";
import { messages as enUS } from "./i18n/en-US";
import { messages as zhCN } from "./i18n/zh-CN";
export const conversationTranslationBundle = defineTranslationBundle({
  id: "workbench.conversation",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});
export const defineConversationMessage = createTranslationBundleMessageFactory(
  conversationTranslationBundle,
);

import type { MessageKeyOf, MessageDescriptorFor } from "@workbench/i18n/runtime";
export type ConversationMessageDescriptor = {
  [K in MessageKeyOf<typeof enUS>]: MessageDescriptorFor<typeof enUS, K>;
}[MessageKeyOf<typeof enUS>];
