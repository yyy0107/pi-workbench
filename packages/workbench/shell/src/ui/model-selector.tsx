"use client";

import { ChevronDownIcon, SearchIcon } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible";
import { Input } from "./input";
import { SelectorDropdownContent } from "./selector-dropdown";
import { collapsePanel } from "./surface";
import { cn } from "../utils";
import {
  filterModelSelectorOptions,
  groupModelSelectorOptions,
  type ModelSelectorEffort,
  type ModelSelectorOption,
} from "./model-selector-models";
import { withTooltip } from "./tooltip";

export type { ModelSelectorEffort, ModelSelectorOption } from "./model-selector-models";

export interface ModelSelectorLabels {
  select: string;
  provider: string;
  model: string;
  reasoningEffort: string;
  search: string;
  searchPlaceholder: string;
  loadFailed: string;
  noModels: string;
  noSearchResults: string;
  selectFailed: string;
  currentUnavailable: string;
  saving: string;
}

function MenuStatus({ children, alert }: { children: React.ReactNode; alert?: boolean }) {
  return (
    <div
      role={alert ? "alert" : "status"}
      className="text-muted-foreground border-b px-2 py-2 text-xs leading-4"
    >
      {children}
    </div>
  );
}

const ModelMenuItem = memo(function ModelMenuItem({
  disabled,
  itemRef,
  model,
}: {
  disabled: boolean;
  itemRef?: React.Ref<HTMLDivElement>;
  model: ModelSelectorOption;
}) {
  return (
    <DropdownMenuRadioItem
      ref={itemRef}
      value={model.id}
      closeOnClick={false}
      disabled={disabled || model.unavailable}
      className="mx-1 h-[var(--dropdown-control-height)] gap-2 px-2 pe-8"
    >
      {withTooltip(
        <span className="min-w-0 flex-1 truncate" title={model.name}>
          {model.name}
        </span>,
      )}
    </DropdownMenuRadioItem>
  );
});

function ModelSearch({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange(value: string): void;
}) {
  return (
    <div className="flex h-10 items-center px-1">
      <div className="relative w-full">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute start-2.5 top-1/2 size-[var(--input-control-icon-size)] -translate-y-1/2" />
        <Input
          type="search"
          value={value}
          aria-label={label}
          placeholder={placeholder}
          className="ps-8 shadow-none transition-none"
          onChange={(event) => onChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") event.stopPropagation();
          }}
        />
      </div>
    </div>
  );
}

function MenuCurrentValue({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground ms-auto max-w-32 truncate">{children}</span>;
}

export function ModelSelector({
  compact = false,
  currentUnavailable = false,
  labels,
  loadFailed = false,
  models,
  selectedEffort,
  selectedModelId,
  selectionFailed = false,
  selectionLocked = false,
  getEffortLabel,
  onEffortChange,
  onModelChange,
  onOpen,
}: {
  compact?: boolean;
  currentUnavailable?: boolean;
  labels: ModelSelectorLabels;
  loadFailed?: boolean;
  models: readonly ModelSelectorOption[];
  selectedEffort?: string;
  selectedModelId?: string;
  selectionFailed?: boolean;
  selectionLocked?: boolean;
  getEffortLabel(effort: ModelSelectorEffort): string;
  onEffortChange(effort: string): void;
  onModelChange(modelId: string): void;
  onOpen?(): void;
}) {
  const [modelQuery, setModelQuery] = useState("");
  const [browsedProviderId, setBrowsedProviderId] = useState<string>();
  const [expandedSection, setExpandedSection] = useState<"provider" | "model" | "effort">();
  const selectedModelRef = useCallback((node: HTMLDivElement | null) => {
    const list = node?.closest<HTMLElement>("[data-model-selector-scroll]");
    if (list) list.scrollTop = node!.offsetTop;
  }, []);
  const modelsByProvider = useMemo(() => groupModelSelectorOptions(models), [models]);
  const selectedModel = models.find((model) => model.id === selectedModelId) ?? models[0];
  const providerId =
    browsedProviderId && modelsByProvider.has(browsedProviderId)
      ? browsedProviderId
      : selectedModel?.provider;
  const providerModel = selectedModel?.provider === providerId ? selectedModel : undefined;
  const filteredModels = useMemo(
    () => filterModelSelectorOptions(modelsByProvider.get(providerId ?? "") ?? [], modelQuery),
    [modelQuery, modelsByProvider, providerId],
  );
  const reasoningLevels = providerModel?.efforts ?? [];
  const selectedEffortOption = reasoningLevels.find((level) => level.id === selectedEffort);
  const providers = useMemo(
    () => Array.from(modelsByProvider, ([id, group]) => [id, group[0]!.providerName] as const),
    [modelsByProvider],
  );

  return withTooltip(
    <fieldset
      className="min-w-0 shrink-0 disabled:pointer-events-none disabled:opacity-50"
      disabled={selectionLocked}
      title={selectionLocked ? labels.saving : undefined}
    >
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) onOpen?.();
          else {
            setModelQuery("");
            setBrowsedProviderId(undefined);
            setExpandedSection(undefined);
          }
        }}
      >
        <DropdownMenuTrigger
          openOnHover={false}
          disabled={selectionLocked}
          aria-label={labels.select}
          className={cn(
            "group relative flex w-fit max-w-32 items-center justify-center rounded-md bg-transparent px-2 pt-[var(--button-content-padding-block-start)] pb-[var(--button-content-padding-block-end)] font-sans [font-size:var(--workbench-ui-font-size,1rem)] leading-[var(--control-text-line-height)]! outline-none hover:[background:var(--button-background-hover)] focus-visible:ring-2 focus-visible:ring-ring/50 data-popup-open:[background:var(--button-background-selected)] data-popup-open:[color:var(--button-foreground-selected)] disabled:cursor-not-allowed max-[360px]:max-w-24 sm:max-w-48",
            compact ? "h-[var(--button-height-compact)]" : "h-[var(--dropdown-control-height)]",
          )}
        >
          {withTooltip(
            <span
              className="block max-w-full min-w-0 truncate pe-6 text-end font-medium"
              title={selectedModel?.name}
            >
              {selectedModel?.name ?? labels.select}
            </span>,
          )}
          <ChevronDownIcon className="absolute end-2 size-3.5 shrink-0 opacity-50 transition-transform group-data-popup-open:rotate-180" />
        </DropdownMenuTrigger>

        <SelectorDropdownContent
          className="[&_[data-checked]]:bg-accent [&_[data-checked]]:font-medium [&_[data-checked]]:text-accent-foreground"
          align="center"
          side="top"
          sideOffset={4}
          collisionAvoidance={{ side: "none", align: "shift" }}
        >
          {selectionFailed || currentUnavailable ? (
            <MenuStatus alert={selectionFailed}>
              {selectionFailed ? labels.selectFailed : labels.currentUnavailable}
            </MenuStatus>
          ) : null}

          {loadFailed || !models.length ? (
            <MenuStatus alert={loadFailed}>
              {loadFailed ? labels.loadFailed : labels.noModels}
            </MenuStatus>
          ) : null}

          <Collapsible
            className="rounded-md data-open:bg-muted/40 data-open:ring-1 data-open:ring-border data-open:ring-inset"
            open={expandedSection === "provider"}
            onOpenChange={(open) => setExpandedSection(open ? "provider" : undefined)}
          >
            <CollapsibleContent className={collapsePanel}>
              <div className="max-h-64 overflow-y-auto">
                <DropdownMenuRadioGroup
                  value={providerId ?? ""}
                  onValueChange={(nextProviderId) => {
                    setBrowsedProviderId(nextProviderId);
                    setModelQuery("");
                    setExpandedSection(undefined);
                  }}
                >
                  {providers.map(([id, name]) => (
                    <DropdownMenuRadioItem
                      key={id}
                      value={id}
                      closeOnClick={false}
                      disabled={selectionLocked}
                      className="h-[var(--dropdown-control-height)] px-2 pe-8"
                    >
                      {withTooltip(
                        <span className="min-w-0 flex-1 truncate" title={name}>
                          {name}
                        </span>,
                      )}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </div>
            </CollapsibleContent>
            <CollapsibleTrigger
              render={<DropdownMenuItem nativeButton render={<button />} closeOnClick={false} />}
              disabled={selectionLocked || !providers.length}
              className="group h-[var(--dropdown-control-height)] w-full gap-3 px-2 data-panel-open:font-medium"
            >
              <span>{labels.provider}</span>
              <MenuCurrentValue>
                {modelsByProvider.get(providerId ?? "")?.[0]?.providerName ?? "—"}
              </MenuCurrentValue>
              <ChevronDownIcon
                aria-hidden="true"
                className="ms-1.5 transition-transform duration-200 group-data-panel-open:rotate-180 motion-reduce:transition-none"
              />
            </CollapsibleTrigger>
          </Collapsible>

          <Collapsible
            className="rounded-md data-open:bg-muted/40 data-open:ring-1 data-open:ring-border data-open:ring-inset"
            open={expandedSection === "model"}
            onOpenChange={(open) => setExpandedSection(open ? "model" : undefined)}
          >
            <CollapsibleContent className={collapsePanel}>
              <div data-model-selector-scroll className="relative max-h-80 overflow-y-auto">
                {!loadFailed && models.length > 0 ? (
                  <ModelSearch
                    value={modelQuery}
                    onChange={setModelQuery}
                    label={labels.search}
                    placeholder={labels.searchPlaceholder}
                  />
                ) : null}
                <div className="min-h-0 overflow-y-auto">
                  {!filteredModels.length ? (
                    <MenuStatus>{labels.noSearchResults}</MenuStatus>
                  ) : (
                    <DropdownMenuRadioGroup
                      value={providerModel?.id ?? ""}
                      onValueChange={onModelChange}
                    >
                      {filteredModels.map((model) => (
                        <ModelMenuItem
                          key={model.id}
                          model={model}
                          disabled={selectionLocked}
                          itemRef={model.id === providerModel?.id ? selectedModelRef : undefined}
                        />
                      ))}
                    </DropdownMenuRadioGroup>
                  )}
                </div>
              </div>
            </CollapsibleContent>
            <CollapsibleTrigger
              render={<DropdownMenuItem nativeButton render={<button />} closeOnClick={false} />}
              disabled={selectionLocked || !models.length}
              className="group h-[var(--dropdown-control-height)] w-full gap-3 px-2 data-panel-open:font-medium"
            >
              <span>{labels.model}</span>
              <MenuCurrentValue>{providerModel?.name ?? labels.select}</MenuCurrentValue>
              <ChevronDownIcon
                aria-hidden="true"
                className="ms-1.5 transition-transform duration-200 group-data-panel-open:rotate-180 motion-reduce:transition-none"
              />
            </CollapsibleTrigger>
          </Collapsible>

          {reasoningLevels.length > 0 ? (
            <Collapsible
              className="rounded-md data-open:bg-muted/40 data-open:ring-1 data-open:ring-border data-open:ring-inset"
              open={expandedSection === "effort"}
              onOpenChange={(open) => setExpandedSection(open ? "effort" : undefined)}
            >
              <CollapsibleContent className={collapsePanel}>
                <div className="max-h-64 overflow-y-auto">
                  <DropdownMenuRadioGroup
                    value={selectedEffort ?? ""}
                    onValueChange={onEffortChange}
                  >
                    {reasoningLevels.map((level) => (
                      <DropdownMenuRadioItem
                        key={level.id}
                        value={level.id}
                        closeOnClick={false}
                        disabled={selectionLocked}
                        className="h-[var(--dropdown-control-height)] px-2 pe-8"
                      >
                        <span className="min-w-0 flex-1 truncate">{getEffortLabel(level)}</span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </div>
              </CollapsibleContent>
              <CollapsibleTrigger
                render={<DropdownMenuItem nativeButton render={<button />} closeOnClick={false} />}
                disabled={selectionLocked}
                className="group h-[var(--dropdown-control-height)] w-full gap-3 px-2 data-panel-open:font-medium"
              >
                <span>{labels.reasoningEffort}</span>
                <MenuCurrentValue>
                  {selectedEffortOption ? getEffortLabel(selectedEffortOption) : "—"}
                </MenuCurrentValue>
                <ChevronDownIcon
                  aria-hidden="true"
                  className="ms-1.5 transition-transform duration-200 group-data-panel-open:rotate-180 motion-reduce:transition-none"
                />
              </CollapsibleTrigger>
            </Collapsible>
          ) : null}
        </SelectorDropdownContent>
      </DropdownMenu>
    </fieldset>,
    0,
  );
}
