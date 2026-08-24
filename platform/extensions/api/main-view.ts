import type { ComponentType } from "react";

import type { LocalizableText } from "@/i18n";

import type { Disposable } from "./disposable";

export type MainViewKind = string;

export interface MainViewInstance<P extends Record<string, unknown> = Record<string, unknown>> {
  /** Stable contribution kind resolved through MainViewRegistry. */
  kind: MainViewKind;
  /** Localizable title rendered by the Workbench header while this view is active. */
  title: LocalizableText;
  /** Feature-owned transient navigation state. */
  params: P;
  /** Changes for every open request, including requests for the same kind. */
  revision: number;
}

export interface MainViewProps<P extends Record<string, unknown> = Record<string, unknown>> {
  view: MainViewInstance<P>;
  /** Return the central workspace to its default conversation. */
  close(): void;
}

export type MainViewRenderer<P extends Record<string, unknown> = Record<string, unknown>> =
  ComponentType<MainViewProps<P>>;

export interface MainViewDefinition<P extends Record<string, unknown> = Record<string, unknown>> {
  /** Stable, globally unique view kind such as `toolbox`. */
  kind: MainViewKind;
  /** Full-page renderer mounted in place of the conversation. */
  component: MainViewRenderer<P>;
}

export type AnyMainViewDefinition = MainViewDefinition<Record<string, unknown>>;

export interface MainViewRegistry {
  register<P extends Record<string, unknown>>(definition: MainViewDefinition<P>): Disposable;
  get(kind: MainViewKind): AnyMainViewDefinition | undefined;
  getAll(): readonly AnyMainViewDefinition[];
  subscribe(listener: () => void): () => void;
}

export interface OpenMainViewRequest<P extends Record<string, unknown> = Record<string, unknown>> {
  kind: MainViewKind;
  /** Header title for this navigation state. */
  title: LocalizableText;
  params: P;
}
