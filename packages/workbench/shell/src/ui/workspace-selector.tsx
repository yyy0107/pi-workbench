"use client";

import { ChevronDownIcon, FolderIcon, LoaderCircleIcon, SearchIcon, XIcon } from "lucide-react";
import { useMemo, useState, type ReactNode, type Ref } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
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
  picking = false,
  selectedWorkspace,
  triggerId,
  triggerRef,
  variant = "ghost",
  workspaces,
  onClear,
  onValueChange,
}: {
  canClear?: boolean;
  disabled?: boolean;
  error?: boolean;
  footer?: ReactNode;
  labels: WorkspaceSelectorLabels;
  picking?: boolean;
  selectedWorkspace?: WorkspaceSelectorOption;
  triggerId?: string;
  triggerRef?: Ref<HTMLButtonElement>;
  variant?: "ghost" | "outline";
  workspaces: readonly WorkspaceSelectorOption[];
  onClear?(): void;
  onValueChange(workspaceId: string): void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const clearable = canClear && selectedWorkspace !== undefined && !picking;
  const filteredWorkspaces = useMemo(() => {
    const normalizedQuery = workspaceQuery.trim().toLocaleLowerCase();
    if (!normalizedQuery) return workspaces;
    return workspaces.filter(
      (workspace) =>
        workspace.name.toLocaleLowerCase().includes(normalizedQuery) ||
        workspace.rootPath.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [workspaceQuery, workspaces]);

  return (
    <DropdownMenu
      open={menuOpen}
      onOpenChange={(open) => {
        setMenuOpen(open);
        if (!open) setWorkspaceQuery("");
      }}
    >
      <div
        title={error ? labels.selectError : (selectedWorkspace?.rootPath ?? labels.select)}
        className={cn(
          "group/workspace inline-flex h-[var(--dropdown-control-height)] min-w-0 max-w-56 items-center text-base font-normal text-foreground transition-colors",
          variant === "outline"
            ? "rounded-[var(--input-control-radius)] border [border-color:var(--input-control-border)] [background:var(--input-control-background)] hover:[background:var(--button-background-hover)] focus-within:[background:var(--button-background-hover)]"
            : "rounded-full bg-transparent hover:bg-muted focus-within:bg-muted",
          menuOpen &&
            (variant === "outline"
              ? "[background:var(--button-background-selected)] [color:var(--button-foreground-selected)]"
              : "bg-muted"),
          error &&
            "bg-destructive/5 text-destructive ring-3 ring-destructive/20 dark:ring-destructive/40",
          error && variant === "outline" && "border-destructive dark:border-destructive/50",
        )}
      >
        {clearable ? (
          <button
            type="button"
            aria-label={labels.clear}
            title={labels.clear}
            className={cn(
              "group/clear relative grid size-[var(--dropdown-control-height)] shrink-0 cursor-pointer place-items-center outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              variant === "outline" ? "rounded-[var(--input-control-radius)]" : "rounded-full",
            )}
            onClick={() => {
              setMenuOpen(false);
              setWorkspaceQuery("");
              onClear?.();
            }}
          >
            <FolderIcon
              aria-hidden="true"
              className="size-4 group-hover/workspace:hidden group-focus-visible/clear:hidden"
            />
            <XIcon
              aria-hidden="true"
              className="absolute hidden size-4 group-hover/workspace:block group-focus-visible/clear:block"
            />
          </button>
        ) : null}

        <DropdownMenuTrigger
          ref={triggerRef}
          id={triggerId}
          type="button"
          disabled={disabled || picking}
          aria-label={labels.select}
          aria-invalid={error || undefined}
          className={cn(
            "inline-flex h-[var(--dropdown-control-height)] min-w-0 flex-1 cursor-pointer items-center gap-2 pe-2 pt-[var(--button-content-padding-block-start)] pb-[var(--button-content-padding-block-end)] text-base leading-[var(--control-text-line-height)]! font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:cursor-default disabled:opacity-100",
            variant === "outline" ? "rounded-[var(--input-control-radius)]" : "rounded-full",
            clearable ? "ps-0" : "ps-2",
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
          <ChevronDownIcon aria-hidden="true" className="size-3.5 shrink-0 opacity-60" />
        </DropdownMenuTrigger>
      </div>

      <DropdownMenuContent
        align="start"
        alignOffset={clearable ? -32 : 0}
        side="bottom"
        sideOffset={6}
        className="grid max-h-[min(336px,var(--available-height))] w-80 max-w-[calc(100vw-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl p-0 shadow-xl ring-1 ring-foreground/15"
      >
        <div className="flex h-11 items-center gap-2 border-b px-3">
          <SearchIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={workspaceQuery}
            type="search"
            aria-label={labels.search}
            placeholder={labels.searchPlaceholder}
            autoComplete="off"
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            onChange={(event) => setWorkspaceQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete") {
                event.stopPropagation();
              }
            }}
          />
        </div>

        <div className="min-h-0 overflow-y-auto p-1">
          {filteredWorkspaces.length ? (
            <DropdownMenuRadioGroup
              value={selectedWorkspace?.id ?? ""}
              onValueChange={onValueChange}
            >
              {filteredWorkspaces.map((workspace) => (
                <DropdownMenuRadioItem
                  key={workspace.id}
                  value={workspace.id}
                  className="min-h-9 gap-2.5 rounded-lg px-2.5 pe-9 text-sm"
                  title={workspace.rootPath}
                >
                  <FolderIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          ) : (
            <DropdownMenuItem disabled className="min-h-9 px-2.5 text-sm">
              {labels.noSearchResults}
            </DropdownMenuItem>
          )}
        </div>

        {footer}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
