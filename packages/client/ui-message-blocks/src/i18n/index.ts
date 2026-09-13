import {
  defineTranslationBundle,
  createTranslationBundleMessageFactory,
} from "@workbench/i18n/runtime";
import { messages as enUS } from "./en-US";
import { messages as zhCN } from "./zh-CN";
export const conversationTranslationBundle = defineTranslationBundle({
  id: "workbench.ui-message-blocks",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});
export const defineConversationMessage = createTranslationBundleMessageFactory(
  conversationTranslationBundle,
);
import type { MessageKeyOf, MessageDescriptorFor } from "@workbench/i18n/runtime";
export type ConversationMessageDescriptor = {
  [K in MessageKeyOf<typeof enUS>]: MessageDescriptorFor<typeof enUS, K>;
}[MessageKeyOf<typeof enUS>];
