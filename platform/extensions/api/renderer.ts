import type { DataMessagePartComponent, ToolCallMessagePartComponent } from "@assistant-ui/react";

import type { Disposable } from "./disposable";

export type ToolRendererComponent = ToolCallMessagePartComponent;
export type DataRendererComponent = DataMessagePartComponent;

export interface NamedRendererRegistry<TComponent> {
  register(name: string, component: TComponent): Disposable;
  get(name: string): TComponent | undefined;
  getComponentMap(): Readonly<Record<string, TComponent>>;
  subscribe(listener: () => void): () => void;
}

export interface RendererRegistry {
  readonly tools: NamedRendererRegistry<ToolRendererComponent>;
  readonly data: NamedRendererRegistry<DataRendererComponent>;
}
