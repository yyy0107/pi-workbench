import type { ComponentType } from "react";

import type { LocalizableText } from "@/i18n";

import type { Disposable } from "./disposable";

export type MainViewKind = string;

export interface MainViewBreadcrumbItem<
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  label: LocalizableText;
  /** Target state for an ancestor item. Omit for the current page or a display-only ancestor. */
  params?: P;
}

export type MainViewBreadcrumbs<P extends Record<string, unknown> = Record<string, unknown>> =
  readonly [Readonly<MainViewBreadcrumbItem<P>>, ...Readonly<MainViewBreadcrumbItem<P>>[]];

export interface MainViewChromeOptions {
  /** Product identity rendered by the shared Sidebar toggle. */
  productIcon?: "visible" | "hidden";
  /** Conversation-scoped contributions mounted in the Workbench header-left Slot. */
  headerLeft?: "visible" | "hidden";
  /** RightWorkspace surface and its shared toggle control. */
  rightWorkspace?: "visible" | "hidden";
}

export interface MainViewInstance<P extends Record<string, unknown> = Record<string, unknown>> {
  /** Stable contribution kind resolved through MainViewRegistry. */
  kind: MainViewKind;
  /** Localizable title rendered by the Workbench header while this view is active. */
  title: LocalizableText;
  /** Optional location path rendered by the Workbench header from parent to current page. */
  breadcrumbs?: MainViewBreadcrumbs<P>;
  /** Feature-owned transient navigation state. */
  params: P;
  /** Feature-owned visibility choices for shared Workbench chrome. */
  chrome?: Readonly<MainViewChromeOptions>;
  /** Changes for every open request, including requests for the same kind. */
  revision: number;
}

export interface MainViewProps<P extends Record<string, unknown> = Record<string, unknown>> {
  view: MainViewInstance<P>;
  /** Return the central workspace to its default conversation. */
  close(): void;
}

export interface MainViewSidebarProps<
  P extends Record<string, unknown> = Record<string, unknown>,
> extends MainViewProps<P> {
  /** Whether the shared Workbench Sidebar is currently rendered as its mobile Sheet. */
  mobile: boolean;
  /** Close the mobile Sidebar after navigating to content in the main view. */
  onNavigate?(): void;
}

export type MainViewRenderer<P extends Record<string, unknown> = Record<string, unknown>> =
  ComponentType<MainViewProps<P>>;

export type MainViewSidebarRenderer<P extends Record<string, unknown> = Record<string, unknown>> =
  ComponentType<MainViewSidebarProps<P>>;

export interface MainViewDefinition<P extends Record<string, unknown> = Record<string, unknown>> {
  /** Stable, globally unique view kind such as `toolbox`. */
  kind: MainViewKind;
  /** Full-page renderer mounted in place of the conversation. */
  component: MainViewRenderer<P>;
  /** Optional feature navigation rendered inside the existing Workbench Sidebar frame. */
  sidebar?: MainViewSidebarRenderer<P>;
  /** Optional visibility choices for shared Workbench chrome while this view is active. */
  chrome?: MainViewChromeOptions;
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
  /** Optional location path rendered by the shared Workbench header. */
  breadcrumbs?: MainViewBreadcrumbs<P>;
  params: P;
}
