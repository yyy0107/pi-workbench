import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

import type { LocalizableText } from "@/i18n";

import type { Disposable } from "./disposable";

export type PanelLocation = "left" | "right" | "bottom";

export const PANEL_LOCATIONS = ["left", "right", "bottom"] as const;

export interface PanelComponentProps {
  panelId: string;
  close(): void;
}

export interface PanelTabComponentProps {
  panelId: string;
  isActive: boolean;
}

export type PanelTabClassName = string | ((context: PanelTabComponentProps) => string | undefined);

export interface PanelTabClassNames {
  root?: PanelTabClassName;
  trigger?: PanelTabClassName;
  closeButton?: PanelTabClassName;
}

export interface PanelDefinition {
  id: string;
  title?: LocalizableText;
  icon?: LucideIcon;
  tabComponent?: ComponentType<PanelTabComponentProps>;
  tabClassNames?: PanelTabClassNames;
  component: ComponentType<PanelComponentProps>;
  defaultLocation: PanelLocation;
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
}

export interface PanelRegistry {
  register(panel: PanelDefinition): Disposable;
  get(panelId: string): PanelDefinition | undefined;
  getAll(): readonly PanelDefinition[];
  subscribe(listener: () => void): () => void;
}
