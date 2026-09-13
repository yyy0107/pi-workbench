import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

import type { LocalizableText } from "./localizable-text";

import type { Disposable } from "./disposable";

/** Stable navigation grouping shared by related settings sections. */
export interface SettingsSectionGroupDefinition {
  /** Stable id used to collect sections into one navigation group. */
  id: string;
  /** Localizable group heading shown in the settings navigation. */
  title: LocalizableText;
}

/** Props received by one independently registered settings item. */
export interface SettingsItemComponentProps {
  /** Stable id of the section currently hosting the item. */
  sectionId: string;
  /** Stable id of this item within its section. */
  itemId: string;
}

/** Props received by a feature-owned action rendered beside a settings section heading. */
export interface SettingsSectionHeaderActionComponentProps {
  /** Stable id of the section whose heading hosts the action. */
  sectionId: string;
}

/** A navigation destination in the shared settings panel. */
export interface SettingsSectionDefinition {
  /** Globally unique, stable section id. */
  id: string;
  /** Localizable navigation and content heading. */
  title: LocalizableText;
  /** Optional localizable description shown below the section heading. */
  description?: LocalizableText;
  /** Optional feature-owned action rendered beside the content heading. */
  headerAction?: ComponentType<SettingsSectionHeaderActionComponentProps>;
  /** Optional navigation icon. */
  icon?: LucideIcon;
  /** Optional navigation group for related settings sections. */
  group?: SettingsSectionGroupDefinition;
  /** Lower values appear first; registration order breaks ties. */
  order?: number;
}

/** One feature-owned row or surface rendered inside a settings section. */
export interface SettingsItemDefinition {
  /** Id of the section that receives this item. */
  sectionId: string;
  /** Stable id, unique within the target section. */
  id: string;
  /** Localizable item title used by settings search and accessibility navigation. */
  title: LocalizableText;
  /** Optional localizable explanation indexed by settings search. */
  description?: LocalizableText;
  /** Optional localizable aliases for controls represented by this item. */
  keywords?: readonly LocalizableText[];
  /** Item content. The settings host owns navigation, headings, and separators. */
  component: ComponentType<SettingsItemComponentProps>;
  /** Lower values appear first; registration order breaks ties. */
  order?: number;
}

/** Registry used by extensions to compose the shared settings experience. */
export interface SettingsRegistry {
  /** Register a settings navigation section. */
  registerSection(section: SettingsSectionDefinition): Disposable;
  /** Register a feature-owned item in a section. Registration order is activation-order agnostic. */
  registerItem(item: SettingsItemDefinition): Disposable;
  /** Stable ordered snapshot of registered sections. */
  getSections(): readonly SettingsSectionDefinition[];
  /** Stable ordered snapshot of all registered items. */
  getItems(): readonly SettingsItemDefinition[];
  /** Subscribe to section or item registration changes. */
  subscribe(listener: () => void): () => void;
}
