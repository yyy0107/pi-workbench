import { SettingsIcon } from "lucide-react";

import { defineMessage } from "@/i18n";
import type { CommandDefinition } from "@/platform/extensions";

import { settingsOverlayStore } from "./settings-overlay-store";

export const openSettingsCommand = {
  id: "settings.open",
  title: defineMessage("extensions.settings.open"),
  description: defineMessage("extensions.settings.openDescription"),
  category: defineMessage("extensions.settings.category"),
  icon: SettingsIcon,
  run() {
    settingsOverlayStore.open();
  },
} satisfies CommandDefinition;
