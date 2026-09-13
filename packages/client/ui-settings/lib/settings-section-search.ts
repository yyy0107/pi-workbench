import type { LocalizableText } from "@workbench/i18n";
import type {
  SettingsSectionDefinition,
  SettingsSectionGroupDefinition,
} from "@workbench/extension-sdk";

interface SettingsNavigationGroup {
  id: string;
  title?: SettingsSectionGroupDefinition["title"];
  sections: SettingsSectionDefinition[];
}

export function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, "");
}

export function matchesSearchText(
  value: LocalizableText | undefined,
  query: string,
  resolve: (message: LocalizableText) => string,
): boolean {
  return value !== undefined && normalizeSearchText(resolve(value)).includes(query);
}

export function groupSettingsSections(
  sections: readonly SettingsSectionDefinition[],
): SettingsNavigationGroup[] {
  const groups: SettingsNavigationGroup[] = [];
  const groupsById = new Map<string, SettingsNavigationGroup>();

  for (const section of sections) {
    const groupId = section.group ? `group:${section.group.id}` : "ungrouped";
    let group = groupsById.get(groupId);
    if (!group) {
      group = {
        id: groupId,
        title: section.group?.title,
        sections: [],
      };
      groupsById.set(groupId, group);
      groups.push(group);
    }
    group.sections.push(section);
  }

  return groups;
}
