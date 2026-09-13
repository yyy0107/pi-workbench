import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

import type { Disposable } from "./disposable";
import type { LocalizableText } from "./localizable-text";

/** Props supplied by the shared Sidebar host to one complete navigation section. */
export interface SidebarSectionComponentProps {
  /** Whether the shared Sidebar is currently rendered as the mobile Sheet. */
  mobile: boolean;
  /** Raw host-owned search input. Filtering semantics remain feature-owned. */
  searchQuery: string;
  /** Close the mobile Sidebar after navigating to content. */
  onNavigate?(): void;
}

/** Optional search affordance rendered by the shared Sidebar chrome. */
export interface SidebarSectionSearchDefinition {
  /** Accessible label for the search control. */
  label: LocalizableText;
  /** Placeholder shown in the search input. */
  placeholder: LocalizableText;
}

/**
 * One complete, independently owned Sidebar destination.
 *
 * The shared Shell owns navigation, selection and search chrome. The contribution owns the
 * section body and any feature-specific Main Views it opens.
 */
export interface SidebarSectionDefinition {
  /** Globally unique stable section id. */
  id: string;
  /** Localizable navigation label. */
  title: LocalizableText;
  /** Navigation icon. */
  icon: LucideIcon;
  /** Complete section body rendered below shared Sidebar chrome. */
  component: ComponentType<SidebarSectionComponentProps>;
  /** Optional ascending navigation order; registration order breaks ties. */
  order?: number;
  /** Main View kinds that should select this section while active. */
  mainViewKinds?: readonly string[];
  /** Enables host-owned search chrome for this section. */
  search?: SidebarSectionSearchDefinition;
}

/** Observable registry of complete Sidebar destinations. */
export interface SidebarSectionRegistry {
  register(definition: SidebarSectionDefinition): Disposable;
  get(sectionId: string): SidebarSectionDefinition | undefined;
  getAll(): readonly SidebarSectionDefinition[];
  subscribe(listener: () => void): () => void;
}
