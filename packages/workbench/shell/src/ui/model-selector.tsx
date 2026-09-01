"use client";

import { ChevronDownIcon, SearchIcon } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Input } from "./input";
import { SelectorDropdownContent, useAnimatedSelectorDropdown } from "./selector-dropdown";
import { cn } from "../utils";
import {
  filterModelSelectorOptions,
  type ModelSelectorEffort,
  type ModelSelectorOption,
} from "./model-selector-models";

export type { ModelSelectorEffort, ModelSelectorOption } from "./model-selector-models";

export interface ModelSelectorLabels {
  select: string;
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

function ModelMenuItem({
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
      className="mx-1 h-8 gap-2 px-2 pe-8"
    >
      <span className="min-w-0 flex-1 truncate" title={model.name}>
        {model.name}
      </span>
    </DropdownMenuRadioItem>
  );
}

function ModelMenuGroup({
  disabled,
  groupRef,
  models,
  providerId,
  providerName,
  providers,
  selectedItemRef,
  selectedModelId,
  onModelChange,
  onProviderChange,
}: {
  disabled: boolean;
  groupRef: (element: HTMLDivElement | null) => void;
  models: readonly ModelSelectorOption[];
  providerId: string;
  providerName: string;
  providers: ReadonlyArray<readonly [string, string]>;
  selectedItemRef: React.RefObject<HTMLDivElement | null>;
  selectedModelId?: string;
  onModelChange(modelId: string): void;
  onProviderChange(providerId: string): void;
}) {
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);

  const changeProvider = (nextProviderId: string) => {
    setProviderMenuOpen(false);
    window.requestAnimationFrame(() => onProviderChange(nextProviderId));
  };

  return (
    <div ref={groupRef}>
      <DropdownMenuSub open={providerMenuOpen} onOpenChange={setProviderMenuOpen}>
        <DropdownMenuSubTrigger
          openOnHover={false}
          className="bg-popover sticky top-0 z-10 h-[var(--button-height-default)] w-full cursor-pointer rounded-none px-2 pt-[var(--button-content-padding-block-start)] pb-[var(--button-content-padding-block-end)] text-xs font-medium text-muted-foreground focus:[background:var(--button-background-selected)] data-popup-open:[background:var(--button-background-selected)] data-popup-open:[color:var(--button-foreground-selected)] [&>svg:last-child]:hidden"
        >
          <span className="min-w-0 flex-1 truncate text-start">{providerName}</span>
          <ChevronDownIcon className="size-3.5 shrink-0 opacity-50" />
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent
          align="start"
          alignOffset={0}
          side="bottom"
          sideOffset={0}
          className="max-h-64 w-52 overflow-y-auto"
        >
          <DropdownMenuRadioGroup value={providerId} onValueChange={changeProvider}>
            {providers.map(([candidateId, candidateName]) => (
              <DropdownMenuRadioItem
                key={candidateId}
                value={candidateId}
                closeOnClick={false}
                className="h-8 px-2 pe-8"
              >
                <span className="min-w-0 flex-1 truncate" title={candidateName}>
                  {candidateName}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuRadioGroup value={selectedModelId} onValueChange={onModelChange}>
        {models.map((model) => (
          <ModelMenuItem
            key={model.id}
            model={model}
            disabled={disabled}
            itemRef={model.id === selectedModelId ? selectedItemRef : undefined}
          />
        ))}
      </DropdownMenuRadioGroup>
    </div>
  );
}

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
    <div className="bg-popover flex h-10 items-center px-1">
      <div className="relative w-full">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute start-2.5 top-1/2 size-[var(--input-control-icon-size)] -translate-y-1/2" />
        <Input
          type="search"
          value={value}
          aria-label={label}
          placeholder={placeholder}
          className="ps-8 shadow-none"
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
  const selectorDropdown = useAnimatedSelectorDropdown();
  const providerGroupRefs = useRef(new Map<string, HTMLDivElement>());
  const selectedModelRef = useRef<HTMLDivElement>(null);
  const filteredModels = useMemo(
    () => filterModelSelectorOptions(models, modelQuery),
    [modelQuery, models],
  );
  const selectedModel = models.find((model) => model.id === selectedModelId) ?? models[0];
  const reasoningLevels = selectedModel?.efforts ?? [];
  const selectedEffortOption = reasoningLevels.find((level) => level.id === selectedEffort);
  const providers = useMemo(
    () =>
      Array.from(
        new Map(filteredModels.map((model) => [model.provider, model.providerName])).entries(),
      ),
    [filteredModels],
  );
  const selectProviderGroup = useCallback((providerId: string) => {
    providerGroupRefs.current.get(providerId)?.scrollIntoView({ block: "start" });
  }, []);

  return (
    <fieldset
      className="min-w-0 shrink-0 disabled:pointer-events-none disabled:opacity-50"
      disabled={selectionLocked}
      title={selectionLocked ? labels.saving : undefined}
    >
      <DropdownMenu
        onOpenChange={(open) => {
          selectorDropdown.onOpenChange(open);
          if (open) onOpen?.();
          else setModelQuery("");
        }}
      >
        <DropdownMenuTrigger
          ref={selectorDropdown.triggerRef}
          disabled={selectionLocked}
          aria-label={labels.select}
          style={selectorDropdown.triggerStyle}
          className={cn(
            "group relative flex w-fit max-w-32 items-center justify-center rounded-md bg-transparent px-2 pt-[var(--button-content-padding-block-start)] pb-[var(--button-content-padding-block-end)] text-base leading-[var(--control-text-line-height)]! outline-none transition-[width,background-color,color] [transition-duration:400ms,200ms,200ms] ease-out hover:[background:var(--button-background-hover)] focus-visible:ring-2 focus-visible:ring-ring/50 data-popup-open:[background:var(--button-background-selected)] data-popup-open:[color:var(--button-foreground-selected)] disabled:cursor-not-allowed max-[360px]:max-w-24 sm:max-w-48",
            compact ? "h-[var(--button-height-compact)]" : "h-[var(--dropdown-control-height)]",
          )}
          onTransitionEnd={selectorDropdown.onTriggerTransitionEnd}
        >
          <span
            className="group-hover:pe-6 group-focus-visible:pe-6 group-data-popup-open:pe-6 block max-w-full min-w-0 truncate text-end font-mono font-medium transition-[padding] duration-200 ease-out"
            title={selectedModel?.name}
          >
            {selectedModel?.name ?? labels.select}
          </span>
          <ChevronDownIcon className="absolute end-2 size-3.5 shrink-0 opacity-0 transition-[opacity,transform] group-hover:opacity-50 group-focus-visible:opacity-50 group-data-popup-open:rotate-180 group-data-popup-open:opacity-50" />
        </DropdownMenuTrigger>

        <SelectorDropdownContent
          align="end"
          side="bottom"
          sideOffset={4}
          style={selectorDropdown.contentStyle}
        >
          {selectionFailed || currentUnavailable ? (
            <MenuStatus alert={selectionFailed}>
              {selectionFailed ? labels.selectFailed : labels.currentUnavailable}
            </MenuStatus>
          ) : null}

          <DropdownMenuSub
            onOpenChangeComplete={(open) => {
              if (open) selectedModelRef.current?.scrollIntoView({ block: "center" });
            }}
          >
            <DropdownMenuSubTrigger
              disabled={selectionLocked || !models.length}
              className="min-h-9 gap-3 px-2 pt-[var(--control-content-padding-block-default-start)] pb-[var(--control-content-padding-block-default-end)] [&>svg]:ml-1.5"
            >
              <span>{labels.model}</span>
              <MenuCurrentValue>{selectedModel?.name ?? labels.select}</MenuCurrentValue>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
              className="grid max-h-80 w-72 grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-0"
              sideOffset={4}
            >
              {!loadFailed && models.length > 0 ? (
                <ModelSearch
                  value={modelQuery}
                  onChange={setModelQuery}
                  label={labels.search}
                  placeholder={labels.searchPlaceholder}
                />
              ) : null}
              <div className="min-h-0 overflow-y-auto">
                {loadFailed || !models.length ? (
                  <MenuStatus alert={loadFailed}>
                    {loadFailed ? labels.loadFailed : labels.noModels}
                  </MenuStatus>
                ) : !filteredModels.length ? (
                  <MenuStatus>{labels.noSearchResults}</MenuStatus>
                ) : (
                  providers.map(([providerId, providerName], index) => {
                    const providerModels = filteredModels.filter(
                      (model) => model.provider === providerId,
                    );
                    if (!providerModels.length) return null;
                    return (
                      <div key={providerId}>
                        {index > 0 ? <DropdownMenuSeparator className="mx-0 my-0" /> : null}
                        <ModelMenuGroup
                          providerId={providerId}
                          providerName={providerName}
                          providers={providers}
                          models={providerModels}
                          selectedItemRef={selectedModelRef}
                          selectedModelId={selectedModel?.id}
                          disabled={selectionLocked}
                          groupRef={(element) => {
                            if (element) providerGroupRefs.current.set(providerId, element);
                            else providerGroupRefs.current.delete(providerId);
                          }}
                          onModelChange={onModelChange}
                          onProviderChange={selectProviderGroup}
                        />
                      </div>
                    );
                  })
                )}
              </div>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              disabled={selectionLocked || !reasoningLevels.length}
              className="min-h-9 gap-3 px-2 pt-[var(--control-content-padding-block-default-start)] pb-[var(--control-content-padding-block-default-end)] [&>svg]:ml-1.5"
            >
              <span>{labels.reasoningEffort}</span>
              <MenuCurrentValue>
                {selectedEffortOption ? getEffortLabel(selectedEffortOption) : "—"}
              </MenuCurrentValue>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-44" sideOffset={4}>
              <DropdownMenuRadioGroup value={selectedEffort} onValueChange={onEffortChange}>
                {reasoningLevels.map((level) => (
                  <DropdownMenuRadioItem
                    key={level.id}
                    value={level.id}
                    closeOnClick={false}
                    disabled={selectionLocked}
                    className="h-8 px-2 pe-8"
                  >
                    <span className="min-w-0 flex-1 truncate">{getEffortLabel(level)}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </SelectorDropdownContent>
      </DropdownMenu>
    </fieldset>
  );
}
