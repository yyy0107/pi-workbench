"use client";

import { BoxIcon, LoaderCircleIcon, PlugIcon } from "lucide-react";
import { Fragment, useMemo } from "react";

import { useWorkspaceSelection } from "@workbench/agent-runtime-client/workspaces";
import type { WorkbenchToolboxScopePreference } from "@workbench/agent-runtime-contracts/settings";
import { useMainViewService } from "@workbench/extension-host";
import { useI18n } from "@workbench/i18n";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@workbench/ui";

import { definePiMessage, toolboxUiTranslationBundle } from "./i18n";
import { useToolboxCatalogs } from "./toolbox-catalog";
import { useSetToolboxScope } from "./toolbox-scope-store";
import { USER_TOOLBOX_SCOPE } from "../lib/toolbox-scope";

const COMPOSER_CATALOG_KINDS = ["skill", "extension"] as const;

/** Shows the enabled Pi capabilities for the current Toolbox resource scope in place. */
export function ToolboxComposerShortcuts() {
  const { number, t } = useI18n(toolboxUiTranslationBundle);
  const mainViews = useMainViewService();
  const setToolboxScope = useSetToolboxScope();
  const { activeWorkspaceId, draftWorkspaceId } = useWorkspaceSelection();
  const workspaceId = draftWorkspaceId ?? activeWorkspaceId;
  const scope = useMemo<WorkbenchToolboxScopePreference>(
    () => (workspaceId ? { kind: "project", workspaceId } : USER_TOOLBOX_SCOPE),
    [workspaceId],
  );
  const catalogs = useToolboxCatalogs(scope, COMPOSER_CATALOG_KINDS, {
    includeInherited: true,
  });
  const shortcuts = [
    {
      section: "skills",
      label: t("extensions.toolbox.skills.title"),
      actionLabel: t("extensions.toolbox.composerShortcuts.openSkills"),
      emptyLabel: t("extensions.toolbox.composerShortcuts.noSkillsEnabled"),
      catalog: catalogs.skillsCatalog,
      items: catalogs.skillItems.filter((item) => item.params.enabled !== false),
      icon: BoxIcon,
      title: definePiMessage("extensions.toolbox.skills.title"),
    },
    {
      section: "extensions",
      label: t("extensions.toolbox.extensions.title"),
      actionLabel: t("extensions.toolbox.composerShortcuts.openExtensions"),
      emptyLabel: t("extensions.toolbox.composerShortcuts.noExtensionsEnabled"),
      catalog: catalogs.extensionsCatalog,
      items: catalogs.extensionItems.filter((item) => item.params.enabled !== false),
      icon: PlugIcon,
      title: definePiMessage("extensions.toolbox.extensions.title"),
    },
  ] as const;

  return (
    <nav
      aria-label={t("extensions.toolbox.composerShortcuts.label")}
      className="flex min-w-0 items-center gap-1.5"
    >
      {shortcuts.map(
        ({ actionLabel, catalog, emptyLabel, icon: Icon, items, label, section, title }, index) => {
          const isLoading = catalog.loadState === "idle" || catalog.loadState === "loading";
          const countLabel =
            catalog.loadState === "ready" || items.length > 0
              ? number(items.length)
              : isLoading
                ? "…"
                : "—";

          return (
            <Fragment key={section}>
              {index > 0 ? (
                <span aria-hidden="true" className="bg-border h-3 w-px shrink-0" />
              ) : null}
              <Popover>
                <PopoverTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      data-frame="none"
                      data-selection="none"
                      aria-label={actionLabel}
                      title={actionLabel}
                      className="text-muted-foreground min-w-0 gap-1.5 px-1.5 font-normal hover:text-foreground max-[480px]:gap-1 max-[480px]:px-1"
                    />
                  }
                >
                  <Icon aria-hidden="true" className="opacity-80" />
                  <span
                    aria-hidden="true"
                    className="text-foreground/90 min-w-3 text-end font-semibold tabular-nums"
                  >
                    {countLabel}
                  </span>
                  <span className="min-w-0 truncate max-[480px]:sr-only">{label}</span>
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  align="end"
                  sideOffset={8}
                  className="max-h-[min(24rem,calc(100vh-1rem))] w-[min(20rem,calc(100vw-1rem))] gap-1.5 p-2"
                >
                  <PopoverHeader className="shrink-0 px-1 py-0.5">
                    <div className="flex items-center justify-between gap-3">
                      <PopoverTitle>{label}</PopoverTitle>
                      {isLoading ? (
                        <LoaderCircleIcon
                          aria-hidden="true"
                          className="text-muted-foreground size-[var(--icon-size-sm)] animate-spin"
                        />
                      ) : null}
                    </div>
                    <PopoverDescription>
                      {t("extensions.toolbox.composerShortcuts.enabledCount", {
                        count: items.length,
                      })}
                    </PopoverDescription>
                  </PopoverHeader>

                  {!catalog.hasTargets ? (
                    <p
                      role="status"
                      className="text-muted-foreground px-2 py-6 text-center text-xs"
                    >
                      {t("extensions.toolbox.scopeUnavailable")}
                    </p>
                  ) : isLoading && items.length === 0 ? (
                    <p
                      role="status"
                      aria-busy="true"
                      className="text-muted-foreground px-2 py-6 text-center text-xs"
                    >
                      {t("extensions.toolbox.composerShortcuts.loading")}
                    </p>
                  ) : catalog.loadState === "failed" ? (
                    <p role="alert" className="text-destructive px-2 py-6 text-center text-xs">
                      {t("extensions.toolbox.composerShortcuts.loadFailed")}
                    </p>
                  ) : items.length === 0 ? (
                    <p
                      role="status"
                      className="text-muted-foreground px-2 py-6 text-center text-xs"
                    >
                      {emptyLabel}
                    </p>
                  ) : (
                    <ul className="min-h-0 overflow-y-auto py-0.5">
                      {items.map((item) => (
                        <li
                          key={item.id}
                          className="flex min-h-[var(--dropdown-control-height)] min-w-0 items-start gap-2.5 rounded-[var(--button-radius)] px-2 py-[var(--control-content-padding-block-compact-start)]"
                        >
                          <Icon
                            aria-hidden="true"
                            className="text-muted-foreground mt-0.5 size-[var(--icon-size-sm)] shrink-0"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium" title={item.name}>
                              {item.name}
                            </span>
                            {item.description ? (
                              <span className="text-muted-foreground mt-0.5 line-clamp-2 text-xs leading-4">
                                {item.description}
                              </span>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-0.5 shrink-0 border-t pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full"
                      aria-label={t("extensions.toolbox.composerShortcuts.manageLabel", {
                        name: label,
                      })}
                      onClick={() => {
                        setToolboxScope(scope);
                        mainViews.open({ kind: "toolbox", title, params: { section } });
                      }}
                    >
                      {t("extensions.toolbox.composerShortcuts.manage")}
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </Fragment>
          );
        },
      )}
    </nav>
  );
}
