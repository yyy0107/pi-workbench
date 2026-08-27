import { defineMessage } from "@/i18n";
import type { OpenMainViewRequest } from "@/platform/extensions/authoring";

export const SETTINGS_MAIN_VIEW_KIND = "settings";
export const SETTINGS_MAIN_VIEW_TITLE = defineMessage("extensions.settings.title");

export type SettingsMainViewParams = {
  sectionId?: string;
  itemId?: string;
};

export function createSettingsMainViewRequest(
  sectionId?: string,
  itemId?: string,
): OpenMainViewRequest<SettingsMainViewParams> {
  return {
    kind: SETTINGS_MAIN_VIEW_KIND,
    title: SETTINGS_MAIN_VIEW_TITLE,
    params: sectionId ? { sectionId, ...(itemId ? { itemId } : {}) } : {},
  };
}

export function settingsItemDomId(sectionId: string, itemId: string): string {
  const sectionToken = encodeURIComponent(sectionId);
  const itemToken = encodeURIComponent(itemId);
  return `settings-item-${sectionToken.length}-${sectionToken}-${itemToken}`;
}
