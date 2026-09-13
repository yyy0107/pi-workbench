import { modelSelectionTranslationBundle as uiModelSelectionBundle } from "@workbench/ui-model-selection/i18n";
import { tokenUsageTranslationBundle as uiTokenUsageBundle } from "@workbench/ui-token-usage/i18n";
import { themeTranslationBundle as uiThemeBundle } from "@workbench/ui-theme/i18n";
import { settingsGeneralTranslationBundle as uiSettingsGeneralBundle } from "@workbench/ui-settings-general/i18n";
import { composerTranslationBundle as uiAttachmentBundle } from "@workbench/ui-attachment/i18n";
import { composerTranslationBundle as uiInputTriggerBundle } from "@workbench/ui-input-trigger/i18n";
import { userQuestionsTranslationBundle as uiUserQuestionsBundle } from "@workbench/ui-user-questions/i18n";
import { todoTranslationBundle as uiTodoBundle } from "@workbench/ui-todo/i18n";
import { conversationTranslationBundle as uiToolBundle } from "@workbench/ui-tool/i18n";
import { uiMessageQueueTranslationBundle as uiMessageQueueBundle } from "@workbench/ui-message-queue/i18n";
import { uiMessageActionsTranslationBundle as uiMessageActionsBundle } from "@workbench/ui-message-actions/i18n";
import { uiUserMessageIndexTranslationBundle as uiUserMessageIndexBundle } from "@workbench/ui-user-message-index/i18n";
import { uiSettingsArchivedChatsTranslationBundle as uiSettingsArchivedChatsBundle } from "@workbench/ui-settings-archived-chats/i18n";
import { uiSideChatTranslationBundle as uiSideChatBundle } from "@workbench/ui-side-chat/i18n";
import { layoutTranslationBundle } from "@workbench/ui-layout/i18n";
import { panelsTranslationBundle } from "@workbench/ui-panels/i18n";
import { sidebarTranslationBundle as conversationListTranslationBundle } from "@workbench/ui-conversation-list/i18n";
import { sidebarTranslationBundle } from "@workbench/ui-sidebar/i18n";
import { platformExtensionsTranslationBundle } from "@workbench/extension-host/i18n";
import { automationUiTranslationBundle } from "@workbench/ui-automation/i18n";
import { terminalUiTranslationBundle } from "@workbench/ui-terminal/i18n";
import { conversationTranslationBundle as nodesTranslationBundle } from "@workbench/ui-conversation-nodes/i18n";
import { conversationTranslationBundle as blocksTranslationBundle } from "@workbench/ui-message-blocks/i18n";
import { conversationTranslationBundle } from "@workbench/ui-conversation/i18n";
import { composerTranslationBundle } from "@workbench/ui-composer/i18n";
import { browserTranslationBundle } from "@workbench/workspace-browser/i18n";
import { settingsUiTranslationBundle } from "@workbench/ui-settings/i18n";
import { gitBranchTranslationBundle } from "@workbench/workspace-git-branch/i18n";
import { reviewTranslationBundle } from "@workbench/workspace-review/i18n";
import { artifactTranslationBundle } from "@workbench/workspace-artifact/i18n";
import { directoryPickerTranslationBundle } from "@workbench/workspace-directory-picker/i18n";
import { explorerTranslationBundle } from "@workbench/workspace-explorer/i18n";
import { fileViewTranslationBundle } from "@workbench/workspace-file-view/i18n";
import { filesTranslationBundle } from "@workbench/workspace-files/i18n";
import { workspaceTranslationBundle } from "@workbench/workspace-runtime/i18n";
import { markdownTranslationBundle } from "@workbench/markdown/i18n";
import { codeHighlightingTranslationBundle } from "@workbench/code-highlighting/i18n";
import { uiTranslationBundle } from "@workbench/ui/i18n";
import {
  createI18n as createInstalledI18n,
  createTranslationBundleMessageFactory,
  DEFAULT_LOCALE,
  defineTranslationBundle,
  type CatalogTranslate,
  type DescriptorTranslate,
  type Locale,
  type MessageDescriptorFor,
  type MessageKeyOf,
  type StaticMessageKeyOf,
  type TranslationBundle,
  type WorkbenchI18nRuntime as InstalledI18nRuntime,
} from "@workbench/i18n/runtime";
import { messages, type Messages } from "./messages";

// Transitional product catalog. Each capability removes its entries as its own bundle is extracted.
export const shellTranslationBundle = defineTranslationBundle({ id: "workbench.shell", messages });
export const shellTranslationBundles = Object.freeze([
  uiModelSelectionBundle,
  uiTokenUsageBundle,
  uiThemeBundle,
  uiSettingsGeneralBundle,
  uiAttachmentBundle,
  uiInputTriggerBundle,
  uiUserQuestionsBundle,
  uiTodoBundle,
  uiToolBundle,
  uiMessageQueueBundle,
  uiMessageActionsBundle,
  uiUserMessageIndexBundle,
  uiSettingsArchivedChatsBundle,
  uiSideChatBundle,

  layoutTranslationBundle,
  panelsTranslationBundle,
  sidebarTranslationBundle,
  conversationListTranslationBundle,
  platformExtensionsTranslationBundle,
  automationUiTranslationBundle,
  terminalUiTranslationBundle,
  conversationTranslationBundle,
  nodesTranslationBundle,
  blocksTranslationBundle,
  composerTranslationBundle,
  browserTranslationBundle,
  settingsUiTranslationBundle,
  gitBranchTranslationBundle,
  reviewTranslationBundle,
  artifactTranslationBundle,
  directoryPickerTranslationBundle,
  explorerTranslationBundle,
  uiTranslationBundle,
  codeHighlightingTranslationBundle,
  markdownTranslationBundle,
  workspaceTranslationBundle,
  filesTranslationBundle,
  fileViewTranslationBundle,
  shellTranslationBundle,
]);
export type MessageKey = MessageKeyOf<Messages>;
export type StaticMessageKey = StaticMessageKeyOf<Messages>;
export type Translate = CatalogTranslate<Messages> & DescriptorTranslate;
export type MessageDescriptor = {
  [TKey in MessageKey]: MessageDescriptorFor<Messages, TKey>;
}[MessageKey];
export type WorkbenchI18nRuntime = Omit<InstalledI18nRuntime, "t"> & { t: Translate };
export function createI18n(
  locale: Locale,
  bundles: readonly TranslationBundle[] = [],
): WorkbenchI18nRuntime {
  return createInstalledI18n(locale, [
    ...shellTranslationBundles,
    ...bundles,
  ]) as WorkbenchI18nRuntime;
}
export const defineMessage = createTranslationBundleMessageFactory(shellTranslationBundle);
export const isLocalizableText = createI18n(DEFAULT_LOCALE).isLocalizableText;
export {
  createTranslationBundleMessageFactory,
  resolveText,
  type LocalizableText,
  type TranslationBundleMessageFactory,
} from "@workbench/i18n/runtime";
