import { MessagesSquareIcon, SmartphoneIcon } from "lucide-react";
import type {
  ExtensionContext,
  Disposable,
  SettingsSectionGroupDefinition,
} from "@workbench/extension-sdk";
import { defineSettingsGeneralMessage as defineMessage } from "./i18n";
import { ConversationSettingsItem } from "./conversation-settings-item";
import { RemoteDeviceSettingsItem } from "./remote-device-settings-item";

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
  const remoteDevicesSection = context.settings.registerSection({
    id: "remote-devices",
    title: defineMessage("extensions.settings.remoteDevices.title"),
    description: defineMessage("extensions.settings.remoteDevices.description"),
    icon: SmartphoneIcon,
    group,
    order: 1,
  });
  const remoteDevices = context.settings.registerItem({
    sectionId: "remote-devices",
    id: "remote-devices",
    title: defineMessage("extensions.settings.remoteDevices.title"),
    keywords: [
      defineMessage("extensions.settings.remoteDevices.createPairing"),
      defineMessage("extensions.settings.remoteDevices.pairedDevices"),
    ],
    component: RemoteDeviceSettingsItem,
  });
  return [section, preferences, remoteDevicesSection, remoteDevices];
}
