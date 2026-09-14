import {
  createTranslationBundleMessageFactory,
  defineTranslationBundle,
} from "@workbench/i18n/runtime";

import { messages as enUS } from "./en-US";
import { messages as zhCN } from "./zh-CN";

export const remoteConversationTranslationBundle = defineTranslationBundle({
  id: "workbench.ui-remote-conversation",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});

export const defineRemoteConversationMessage = createTranslationBundleMessageFactory(
  remoteConversationTranslationBundle,
);
