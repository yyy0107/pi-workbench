"use client";

import { FolderIcon, LoaderCircleIcon, SearchIcon, XIcon } from "lucide-react";
import type { ReactNode, Ref } from "react";

import {
  SearchableSelector,
  SearchableSelectorClear,
  SearchableSelectorContent,
  SearchableSelectorEmpty,
  SearchableSelectorInput,
  SearchableSelectorItem,
  SearchableSelectorList,
  SearchableSelectorTrigger,
} from "./searchable-selector";
import { cn } from "../utils";

export interface WorkspaceSelectorOption {
  id: string;
  name: string;
  rootPath: string;
}

export interface WorkspaceSelectorLabels {
  select: string;
  clear: string;
  selecting: string;
  selectError: string;
  empty: string;
  search: string;
  searchPlaceholder: string;
  noSearchResults: string;
}

export function WorkspaceSelector({
  canClear = false,
  disabled = false,
  error = false,
  footer,
  labels,
  open,
  picking = false,
  selectedWorkspace,
  triggerId,
  triggerRef,
  variant = "ghost",
  workspaces,
  onClear,
  onOpenChange,
  onValueChange,
}: {
  canClear?: boolean;
  disabled?: boolean;
  error?: boolean;
  footer?: ReactNode;
  labels: WorkspaceSelectorLabels;
  open?: boolean;
  picking?: boolean;
  selectedWorkspace?: WorkspaceSelectorOption;
  triggerId?: string;
  triggerRef?: Ref<HTMLButtonElement>;
  variant?: "ghost" | "outline";
  workspaces: readonly WorkspaceSelectorOption[];
  onClear?(): void;
  onOpenChange?(open: boolean): void;
  onValueChange(workspaceId: string): void;
}) {
  const clearable = canClear && selectedWorkspace !== undefined && !picking;

  return (
    <SearchableSelector<WorkspaceSelectorOption>
      items={workspaces}
      open={open}
      onOpenChange={onOpenChange}
      value={selectedWorkspace ?? null}
      itemToStringLabel={(workspace) => `${workspace.name} ${workspace.rootPath}`}
      isItemEqualToValue={(workspace, value) => workspace.id === value.id}
      onValueChange={(workspace) => {
        if (workspace) {
          onValueChange(workspace.id);
          return;
        }
        onClear?.();
      }}
      filter={(workspace, query) => {
        const normalizedQuery = query.trim().toLocaleLowerCase();
        return (
          workspace.name.toLocaleLowerCase().includes(normalizedQuery) ||
          workspace.rootPath.toLocaleLowerCase().includes(normalizedQuery)
        );
      }}
    >
      <div
        title={error ? labels.selectError : (selectedWorkspace?.rootPath ?? labels.select)}
        className={cn(
          "group/workspace inline-flex h-[var(--dropdown-control-height)] min-w-0 max-w-56 items-center text-base font-normal text-foreground transition-colors",
          variant === "outline"
            ? "rounded-[var(--input-control-radius)] border [border-color:var(--input-control-border)] [background:var(--input-control-background)] hover:[background:var(--button-background-hover)] focus-within:[background:var(--button-background-hover)]"
            : "rounded-full bg-transparent hover:bg-muted focus-within:bg-muted",
          error &&
            "bg-destructive/5 text-destructive ring-3 ring-destructive/20 dark:ring-destructive/40",
          error && variant === "outline" && "border-destructive dark:border-destructive/50",
        )}
      >
        {clearable ? (
          <SearchableSelectorClear
            aria-label={labels.clear}
            title={labels.clear}
            className={cn(
              "group/clear relative size-[var(--dropdown-control-height)] shrink-0",
              variant === "outline" ? "rounded-[var(--input-control-radius)]" : "rounded-full",
            )}
          >
            <FolderIcon
              aria-hidden="true"
              className="size-4 group-hover/workspace:hidden group-focus-visible/clear:hidden"
            />
            <XIcon
              aria-hidden="true"
              className="absolute hidden size-4 group-hover/workspace:block group-focus-visible/clear:block"
            />
          </SearchableSelectorClear>
        ) : null}

        <SearchableSelectorTrigger
          ref={triggerRef}
          id={triggerId}
          type="button"
          disabled={disabled || picking}
          aria-label={labels.select}
          aria-invalid={error || undefined}
          className={cn(
            "h-[var(--dropdown-control-height)] min-w-0 flex-1 cursor-pointer border-0 text-base font-normal focus-visible:-outline-offset-2 disabled:cursor-default disabled:opacity-100",
            variant === "outline" ? "rounded-[var(--input-control-radius)]" : "rounded-full",
            variant === "ghost" &&
              "[background:transparent] hover:[background:var(--button-background-hover)]",
            clearable ? "ps-0" : "ps-2.5",
          )}
        >
          {!clearable ? (
            picking ? (
              <LoaderCircleIcon aria-hidden="true" className="size-4 shrink-0 animate-spin" />
            ) : (
              <FolderIcon aria-hidden="true" className="size-4 shrink-0" />
            )
          ) : null}
          <span className="min-w-0 flex-1 truncate text-start">
            {picking
              ? labels.selecting
              : error
                ? labels.selectError
                : (selectedWorkspace?.name ?? labels.empty)}
          </span>
        </SearchableSelectorTrigger>
      </div>

      <SearchableSelectorContent
        align="start"
        alignOffset={clearable ? -32 : 0}
        side="bottom"
        sideOffset={6}
        className="grid max-h-[min(336px,var(--available-height))] w-80 max-w-[calc(100vw-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl p-0 shadow-xl ring-1 ring-foreground/15"
      >
        <div className="flex h-11 items-center gap-2 border-b px-3">
          <SearchIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <SearchableSelectorInput
            autoFocus
            aria-label={labels.search}
            placeholder={labels.searchPlaceholder}
            autoComplete="off"
            spellCheck={false}
            className="h-full min-w-0 flex-1 border-0 px-0"
          />
        </div>

        <SearchableSelectorEmpty>{labels.noSearchResults}</SearchableSelectorEmpty>
        <SearchableSelectorList className="min-h-0">
          {(workspace: WorkspaceSelectorOption) => (
            <SearchableSelectorItem
              key={workspace.id}
              value={workspace}
              className="min-h-9 gap-2.5 rounded-lg px-2.5 pe-9 text-sm"
              title={workspace.rootPath}
            >
              <FolderIcon aria-hidden="true" className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
            </SearchableSelectorItem>
          )}
        </SearchableSelectorList>

        {footer}
      </SearchableSelectorContent>
    </SearchableSelector>
  );
}
