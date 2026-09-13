import {
  defineTranslationBundle,
  createTranslationBundleMessageFactory,
} from "@workbench/i18n/runtime";
import { messages as enUS } from "./i18n/en-US";
import { messages as zhCN } from "./i18n/zh-CN";
export const artifactTranslationBundle = defineTranslationBundle({
  id: "workbench.artifact",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});
export const defineArtifactMessage =
  createTranslationBundleMessageFactory(artifactTranslationBundle);
