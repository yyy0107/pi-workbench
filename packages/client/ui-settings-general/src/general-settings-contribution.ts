import { MessagesSquareIcon } from "lucide-react";
import type {
  ExtensionContext,
  Disposable,
  SettingsSectionGroupDefinition,
} from "@workbench/extension-sdk";
import { defineSettingsGeneralMessage as defineMessage } from "./i18n";
import { ConversationSettingsItem } from "./conversation-settings-item";

/**
 * Registers the general settings contribution owned by this package.
 * The settings host supplies the shared group descriptor so this package does
 * not import the settings container or create a registry cycle.
 */
export function registerGeneralSettings(
  context: Pick<ExtensionContext, "settings">,
  group: SettingsSectionGroupDefinition,
): readonly Disposable[] {
  const section = context.settings.registerSection({
    id: "conversation",
    title: defineMessage("extensions.settings.conversation.title"),
    description: defineMessage("extensions.settings.conversation.description"),
    icon: MessagesSquareIcon,
    group,
    order: 0,
  });
  const preferences = context.settings.registerItem({
    sectionId: "conversation",
    id: "preferences",
    title: defineMessage("extensions.settings.conversation.title"),
    keywords: [
      defineMessage("extensions.settings.conversation.runningMessageMode"),
      defineMessage("extensions.settings.conversation.showReasoning"),
      defineMessage("extensions.settings.conversation.groupParallelTools"),
    ],
    component: ConversationSettingsItem,
  });
  return [section, preferences];
}
