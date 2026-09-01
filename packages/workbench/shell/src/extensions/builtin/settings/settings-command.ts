import { SettingsIcon } from "lucide-react";

import { defineMessage } from "../../../i18n";
import type { CommandDefinition } from "@workbench/extension-sdk";

import { createSettingsMainViewRequest } from "./settings-main-view";

export const openSettingsCommand = {
  id: "settings.open",
  title: defineMessage("extensions.settings.open"),
  description: defineMessage("extensions.settings.openDescription"),
  category: defineMessage("extensions.settings.category"),
  icon: SettingsIcon,
  run(context) {
    context.mainViews.open(createSettingsMainViewRequest());
  },
} satisfies CommandDefinition;
