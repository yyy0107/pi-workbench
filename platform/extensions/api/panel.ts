import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

import type { Disposable } from "./disposable";

export type PanelLocation = "left" | "right" | "bottom";

export const PANEL_LOCATIONS = ["left", "right", "bottom"] as const;

export interface PanelComponentProps {
  panelId: string;
  close(): void;
}

export interface PanelDefinition {
  id: string;
  title: string;
  icon?: LucideIcon;
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
