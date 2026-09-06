"use client";

import { CheckIcon, ChevronDownIcon, ImagePlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { CodeThemePreview } from "../../../code-highlighting/code-theme-preview";
import { RunningThreadIndicator } from "../../../elements/running-thread-indicator";
import { Button } from "../../../ui/button";
import { ColorPicker } from "../../../ui/color-picker";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "../../../ui/popover";
import { DropdownMenu, DropdownMenuRadioGroup } from "../../../ui/dropdown-menu";
import {
  SettingsGroup as SharedSettingsGroup,
  SettingsRow as SharedSettingsRow,
} from "../../../ui/settings-layout";
import {
  SettingsDropdownContent,
  SettingsDropdownItem,
  SettingsDropdownRadioItem,
  SettingsDropdownTrigger,
} from "../../../ui/settings-control";
import { Switch } from "../../../ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../ui/tabs";
import { useMediaQuery } from "../../../hooks/use-media-query";
import { useI18n } from "../../../i18n";
import { RunningIndicator, useRunningIndicatorCatalog } from "../../../running-indicator";
import { cn } from "../../../utils";
import type { SettingsItemComponentProps } from "@workbench/extension-sdk";

import {
  BACKGROUND_BLURS,
  BORDER_STYLES,
  CODE_FONT_FAMILIES,
  CODE_THEMES,
  COLOR_MODES,
  CONTENT_FONT_FAMILIES,
  CORNER_RADIUS_STYLES,
  FONT_WEIGHTS,
  GLASS_BLURS,
  MAX_CODE_FONT_SIZE,
  MAX_RUNNING_INDICATOR_SIZE,
  MAX_SURFACE_OPACITY,
  MAX_THEME_CONTRAST,
  MAX_UI_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_RUNNING_INDICATOR_SIZE,
  MIN_SURFACE_OPACITY,
  MIN_THEME_CONTRAST,
  MIN_UI_FONT_SIZE,
  RUNNING_INDICATOR_IDS,
  UI_FONT_FAMILIES,
  type BackgroundBlur,
  type BorderStyle,
  type CodeFontFamily,
  type CodeTheme,
  type ColorMode,
  type ContentFontFamily,
  type CornerRadiusStyle,
  type GlassBlur,
  type FontWeight,
  type RunningIndicatorId,
  type UiFontFamily,
} from "../../../appearance";
import { useAppearanceController, useAppearancePreferences } from "../../../appearance";

import {
  useBackgroundImage,
  useBackgroundImageController,
  type BackgroundImageError,
  type BackgroundImageSnapshot,
} from "./background-image-store";
import { resolveAppearanceSettingsPage } from "./appearance-settings-pages";
import { withTooltip } from "../../../ui/tooltip";

const CODE_PREVIEW = [
  "const greet = (name: string) => {",
  "  const message = `Hello, ${name}!`;",
  "  return message;",
  "};",
].join("\n");

function SettingGroup({
  title,
  description,
  layout = "rows",
  showHeading = true,
  children,
}: {
  title?: string;
  description?: string;
  layout?: "rows" | "cards";
  showHeading?: boolean;
  children: ReactNode;
}) {
  return (
    <SharedSettingsGroup
      title={showHeading ? title : undefined}
      description={showHeading ? description : undefined}
      className="my-5 first:mt-1 last:mb-3"
      contentClassName={layout === "cards" ? "space-y-6 divide-y-0 py-4" : undefined}
    >
      {children}
    </SharedSettingsGroup>
  );
}

function SettingSubgroup({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-medium">{title}</h4>
        {action}
      </div>
      <SharedSettingsGroup className="mt-4">{children}</SharedSettingsGroup>
    </section>
  );
}

function SettingRow({
  label,
  description,
  wideControl = false,
  children,
}: {
  label: string;
  description?: string;
  wideControl?: boolean;
  children: ReactNode;
}) {
  return (
    <SharedSettingsRow
      label={label}
      description={description}
      className={cn(
        "min-h-14 sm:gap-8",
        wideControl
          ? "sm:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]"
          : "sm:grid-cols-[minmax(0,1fr)_minmax(12rem,15rem)]",
      )}
      controlClassName={cn(
        "flex min-w-0 w-full justify-end justify-self-end",
        wideControl ? undefined : "sm:w-60",
      )}
    >
      {children}
    </SharedSettingsRow>
  );
}

const COLOR_MODE_PREVIEW_PALETTES = {
  system: {
    shell: "linear-gradient(90deg, #a6a6a6 0 50%, #565656 50% 100%)",
    chrome: "linear-gradient(90deg, #c8c8c8 0 50%, #999999 50% 100%)",
    panel: "linear-gradient(90deg, #f7f7f7 0 50%, #3c3c3c 50% 100%)",
    line: "linear-gradient(90deg, #d4d4d4 0 50%, #777777 50% 100%)",
    divider: "linear-gradient(90deg, #e5e5e5 0 50%, #555555 50% 100%)",
  },
  light: {
    shell: "#f3f3f3",
    chrome: "#c7c7c7",
    panel: "#ffffff",
    line: "#d5d5d5",
    divider: "#e7e7e7",
  },
  dark: {
    shell: "#5c5c5c",
    chrome: "#adadad",
    panel: "#ffffff",
    line: "#d5d5d5",
    divider: "#e7e7e7",
  },
} satisfies Record<
  ColorMode,
  {
    shell: string;
    chrome: string;
    panel: string;
    line: string;
    divider: string;
  }
>;

function ColorModePreview({ mode }: { mode: ColorMode }) {
  const palette = COLOR_MODE_PREVIEW_PALETTES[mode];
  return (
    <div
      aria-hidden="true"
      className="relative aspect-[1.45] w-full overflow-hidden rounded-xl border-2 border-border shadow-xs transition-[border-color,box-shadow] group-hover:border-foreground peer-checked:border-foreground peer-checked:ring-1 peer-checked:ring-foreground peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50"
      style={{ background: palette.shell }}
    >
      <div
        className="absolute top-[22%] left-1/2 h-[5%] w-[43%] -translate-x-1/2 rounded-full"
        style={{ background: palette.chrome }}
      />
      <div
        className="absolute top-[30%] left-1/2 h-[3%] w-[62%] -translate-x-1/2 rounded-full opacity-70"
        style={{ background: palette.chrome }}
      />
      <div
        className="absolute inset-x-[8%] top-[38%] -bottom-px overflow-hidden rounded-t-xl"
        style={{ background: palette.panel }}
      >
        <div className="absolute inset-x-[6%] top-[14%] h-[5%]">
          <div className="h-full w-[34%] rounded-full" style={{ background: palette.line }} />
          <div
            className="mt-[4%] h-[35%] w-[55%] rounded-full opacity-55"
            style={{ background: palette.line }}
          />
        </div>
        <div
          className="absolute inset-x-0 top-[39%] h-px"
          style={{ background: palette.divider }}
        />
        <div className="absolute inset-x-[6%] top-[48%] h-[5%]">
          <div className="h-full w-[34%] rounded-full" style={{ background: palette.line }} />
          <div
            className="mt-[4%] h-[35%] w-[55%] rounded-full opacity-55"
            style={{ background: palette.line }}
          />
        </div>
        <div
          className="absolute inset-x-0 top-[73%] h-px"
          style={{ background: palette.divider }}
        />
        <div className="absolute inset-x-[6%] top-[82%] h-[5%]">
          <div className="h-full w-[34%] rounded-full" style={{ background: palette.line }} />
          <div
            className="mt-[4%] h-[35%] w-[55%] rounded-full opacity-55"
            style={{ background: palette.line }}
          />
        </div>
      </div>
    </div>
  );
}

function ColorModePicker({
  label,
  value,
  optionLabel,
  onChange,
}: {
  label: string;
  value: ColorMode;
  optionLabel(value: ColorMode): string;
  onChange(value: ColorMode): void;
}) {
  return (
    <fieldset>
      <legend className="sr-only">{label}</legend>
      <div className="grid grid-cols-3 gap-3">
        {COLOR_MODES.map((mode) => (
          <label key={mode} className="group min-w-0 cursor-pointer">
            <input
              type="radio"
              name="workbench-color-mode"
              value={mode}
              checked={value === mode}
              className="peer sr-only"
              onChange={() => onChange(mode)}
            />
            <ColorModePreview mode={mode} />
            <span className="text-muted-foreground mt-2 block text-center text-sm transition-colors peer-checked:font-medium peer-checked:text-foreground">
              {optionLabel(mode)}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function BackgroundImagePicker({ image }: { image: BackgroundImageSnapshot }) {
  const { t } = useI18n();
  const backgroundImage = useBackgroundImageController();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const errorLabel = (error: BackgroundImageError): string => {
    if (error === "unsupported") return t("extensions.appearance.background.unsupportedImage");
    if (error === "tooLarge") return t("extensions.appearance.background.imageTooLarge");
    return t("extensions.appearance.background.imageStorageError");
  };

  return (
    <div className="ms-auto flex w-48 max-w-full flex-col items-end gap-2">
      {image.url ? (
        <div
          role="img"
          aria-label={t("extensions.appearance.background.preview")}
          className="bg-muted aspect-video w-full rounded-xl bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: `url("${image.url}")` }}
        />
      ) : null}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label={t("extensions.appearance.background.chooseImage")}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void backgroundImage.setFile(file);
        }}
      />
      <div className="flex w-full items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={image.status === "loading"}
          className="min-w-0 max-w-full"
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlusIcon />
          <span className="truncate">
            {image.status === "loading"
              ? t("extensions.appearance.background.loadingImage")
              : image.url
                ? t("extensions.appearance.background.replaceImage")
                : t("extensions.appearance.background.chooseImage")}
          </span>
        </Button>
        {image.url ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={image.status === "loading"}
            aria-label={t("extensions.appearance.background.removeImage")}
            title={t("extensions.appearance.background.removeImage")}
            onClick={() => void backgroundImage.clear()}
          >
            <Trash2Icon />
          </Button>
        ) : null}
      </div>
      {image.name
        ? withTooltip(
            <p
              className="text-muted-foreground w-full truncate text-right text-xs"
              title={image.name}
            >
              {image.name}
            </p>,
          )
        : null}
      {image.error ? (
        <p className="text-destructive w-full text-right text-xs" role="alert">
          {errorLabel(image.error)}
        </p>
      ) : null}
    </div>
  );
}

function SelectControl<Value extends string | number>({
  label,
  value,
  options,
  optionLabel,
  disabled,
  onChange,
}: {
  label: string;
  value: Value;
  options: readonly Value[];
  optionLabel(value: Value): ReactNode;
  disabled?: boolean;
  onChange(value: Value): void;
}) {
  return (
    <DropdownMenu>
      <SettingsDropdownTrigger aria-label={label} disabled={disabled}>
        <span className="min-w-0 truncate">{optionLabel(value)}</span>
        <ChevronDownIcon className="text-muted-foreground size-3.5 shrink-0" />
      </SettingsDropdownTrigger>
      <SettingsDropdownContent align="end" side="bottom">
        {options.map((option) => (
          <SettingsDropdownItem key={option} onClick={() => onChange(option)}>
            <span className="min-w-0 flex-1">{optionLabel(option)}</span>
            {option === value ? <CheckIcon className="size-4" /> : null}
          </SettingsDropdownItem>
        ))}
      </SettingsDropdownContent>
    </DropdownMenu>
  );
}

function FontControl<Value extends string>({
  label,
  value,
  options,
  optionLabel,
  weight,
  weightDisabled,
  onChange,
  onWeightChange,
}: {
  label: string;
  value: Value;
  options: readonly Value[];
  optionLabel(value: Value): string;
  weight: FontWeight;
  weightDisabled?: boolean;
  onChange(value: Value): void;
  onWeightChange(value: FontWeight): void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex min-w-0 flex-wrap justify-end gap-2">
      <SelectControl
        label={label}
        value={value}
        options={options}
        optionLabel={optionLabel}
        onChange={onChange}
      />
      <SelectControl
        label={t("extensions.appearance.typography.fontWeightFor", { font: label })}
        value={weight}
        options={FONT_WEIGHTS}
        optionLabel={(value) => t(`extensions.appearance.fontWeights.${value}`)}
        disabled={weightDisabled}
        onChange={onWeightChange}
      />
    </div>
  );
}

const ACCENT_PALETTES = {
  neutral: { light: "#18181b", dark: "#f4f4f5" },
  blue: { light: "#2563eb", dark: "#60a5fa" },
  green: { light: "#15803d", dark: "#4ade80" },
  orange: { light: "#c2410c", dark: "#fb923c" },
  red: { light: "#dc2626", dark: "#f87171" },
  pink: { light: "#be185d", dark: "#f472b6" },
  purple: { light: "#7e22ce", dark: "#c084fc" },
} as const;
type AccentPreset = keyof typeof ACCENT_PALETTES;
const ACCENT_PRESETS = [...(Object.keys(ACCENT_PALETTES) as AccentPreset[]), "custom"] as const;

function AccentColorControl({
  mode,
  color,
  onChange,
}: {
  mode: "light" | "dark";
  color: string;
  onChange(color: string): void;
}) {
  const { t } = useI18n();
  const [custom, setCustom] = useState(false);
  const preset = ACCENT_PRESETS.find(
    (id) => id !== "custom" && ACCENT_PALETTES[id][mode] === color,
  );
  const selection = custom ? "custom" : (preset ?? "custom");
  return (
    <div className="flex min-w-0 flex-wrap justify-end gap-2">
      <SelectControl
        label={t("extensions.appearance.themeSettings.accent")}
        value={selection}
        options={ACCENT_PRESETS}
        optionLabel={(value) => (
          <span className="inline-flex items-center gap-2">
            {value !== "custom" ? (
              <span
                aria-hidden="true"
                className="size-[var(--input-control-icon-size)] shrink-0 rounded-full"
                style={{ backgroundColor: ACCENT_PALETTES[value][mode] }}
              />
            ) : null}
            {t(`extensions.appearance.accentColors.${value}`)}
          </span>
        )}
        onChange={(value) => {
          setCustom(value === "custom");
          if (value !== "custom") onChange(ACCENT_PALETTES[value][mode]);
        }}
      />
      {selection === "custom" ? (
        <ColorControl
          color={color}
          label={t("extensions.appearance.themeSettings.customAccent")}
          onChange={onChange}
        />
      ) : null}
    </div>
  );
}

function AnimatedPreviewSelect<Value extends string>({
  label,
  value,
  options,
  optionLabel,
  renderPreview,
  previewAspectRatio,
  previewOnly,
  previewClassName,
  onChange,
}: {
  label: string;
  value: Value;
  options: readonly Value[];
  optionLabel(value: Value): string;
  renderPreview(value: Value, animated: boolean): ReactNode;
  previewAspectRatio?(value: Value): number | undefined;
  previewOnly?(value: Value): boolean;
  previewClassName?(value: Value): string | undefined;
  onChange(value: Value): void;
}) {
  const [previewValue, setPreviewValue] = useState<Value | null>(null);
  const renderContainedPreview = (option: Value, animated: boolean) => {
    const aspectRatio = previewAspectRatio?.(option);
    const isPreviewOnly = previewOnly?.(option) ?? false;
    return (
      <span
        aria-hidden="true"
        className={cn(
          "flex shrink-0 items-center justify-center",
          isPreviewOnly ? "h-[var(--form-control-height)] w-44 px-2" : "h-5",
          previewClassName?.(option),
        )}
        style={
          isPreviewOnly ? undefined : { width: aspectRatio ? Math.min(96, 20 * aspectRatio) : 20 }
        }
      >
        {renderPreview(option, animated)}
      </span>
    );
  };

  return (
    <DropdownMenu onOpenChange={(open) => setPreviewValue(open ? value : null)}>
      <SettingsDropdownTrigger aria-label={label}>
        {renderContainedPreview(value, true)}
        {previewOnly?.(value) ? null : (
          <span className="min-w-0 truncate">{optionLabel(value)}</span>
        )}
        <ChevronDownIcon className="text-muted-foreground size-3.5 shrink-0" />
      </SettingsDropdownTrigger>
      <SettingsDropdownContent align="end" side="bottom" className="min-w-64">
        <DropdownMenuRadioGroup
          value={value}
          aria-label={label}
          onValueChange={(nextValue) => {
            const nextOption = options.find((option) => option === nextValue);
            if (nextOption) onChange(nextOption);
          }}
        >
          {options.map((option) => (
            <SettingsDropdownRadioItem
              key={option}
              value={option}
              aria-label={optionLabel(option)}
              className={previewOnly?.(option) ? "justify-center" : undefined}
              onFocus={() => setPreviewValue(option)}
              onPointerEnter={() => setPreviewValue(option)}
            >
              {renderContainedPreview(option, option === (previewValue ?? value))}
              {previewOnly?.(option) ? null : (
                <span className="min-w-0 flex-1">{optionLabel(option)}</span>
              )}
            </SettingsDropdownRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </SettingsDropdownContent>
    </DropdownMenu>
  );
}

const RANGE_COMMIT_DELAY_MS = 100;

function RangeControl({
  label,
  value,
  formatValue,
  renderPreview,
  minimum,
  maximum,
  disabled,
  commitOnInteractionEnd = false,
  onChange,
}: {
  label: string;
  value: number;
  formatValue(value: number): string;
  renderPreview?(value: number): ReactNode;
  minimum: number;
  maximum: number;
  disabled?: boolean;
  commitOnInteractionEnd?: boolean;
  onChange(value: number): void;
}) {
  const [draftValue, setDraftValue] = useState(value);
  const draftValueRef = useRef(value);
  const committedValueRef = useRef(value);
  const interactingRef = useRef(false);
  const commitTimerRef = useRef<number | null>(null);
  const commitFrameRef = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    committedValueRef.current = value;
    if (interactingRef.current) return;

    draftValueRef.current = value;
    setDraftValue(value);
  }, [value]);

  useEffect(
    () => () => {
      if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
      if (commitFrameRef.current !== null) window.cancelAnimationFrame(commitFrameRef.current);
    },
    [],
  );

  const commitDraftValue = () => {
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    if (commitFrameRef.current !== null) {
      window.cancelAnimationFrame(commitFrameRef.current);
      commitFrameRef.current = null;
    }
    if (draftValueRef.current !== committedValueRef.current) {
      committedValueRef.current = draftValueRef.current;
      onChangeRef.current(draftValueRef.current);
    }
  };

  const scheduleDraftCommit = () => {
    if (commitFrameRef.current !== null) window.cancelAnimationFrame(commitFrameRef.current);
    commitFrameRef.current = window.requestAnimationFrame(() => {
      commitFrameRef.current = null;
      commitDraftValue();
    });
  };

  const finishInteraction = (finalValue: number) => {
    draftValueRef.current = finalValue;
    setDraftValue(finalValue);
    interactingRef.current = false;
    if (commitOnInteractionEnd) scheduleDraftCommit();
    else commitDraftValue();
  };

  const updateDraftValue = (nextValue: number) => {
    draftValueRef.current = nextValue;
    setDraftValue(nextValue);

    if (commitOnInteractionEnd) return;

    if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = null;
      if (draftValueRef.current !== committedValueRef.current) {
        committedValueRef.current = draftValueRef.current;
        onChangeRef.current(draftValueRef.current);
      }
    }, RANGE_COMMIT_DELAY_MS);
  };

  const progress = ((draftValue - minimum) / (maximum - minimum)) * 100;
  const draftValueLabel = formatValue(draftValue);

  return (
    <div className="flex h-[var(--form-control-height)] w-full items-center gap-3">
      {renderPreview ? (
        <span
          aria-hidden="true"
          className="flex size-[var(--form-control-height)] shrink-0 items-center justify-center"
        >
          {renderPreview(draftValue)}
        </span>
      ) : null}
      <input
        type="range"
        min={minimum}
        max={maximum}
        step={1}
        value={draftValue}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={draftValueLabel}
        className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-foreground [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground"
        style={{
          background: `linear-gradient(to right, var(--foreground) 0%, var(--foreground) ${progress}%, var(--muted) ${progress}%, var(--muted) 100%)`,
        }}
        onBlur={(event) => finishInteraction(Number(event.currentTarget.value))}
        onChange={(event) => updateDraftValue(Number(event.currentTarget.value))}
        onKeyDown={() => {
          interactingRef.current = true;
        }}
        onKeyUp={(event) => finishInteraction(Number(event.currentTarget.value))}
        onPointerCancel={(event) => finishInteraction(Number(event.currentTarget.value))}
        onPointerDown={() => {
          interactingRef.current = true;
        }}
        onPointerUp={(event) => finishInteraction(Number(event.currentTarget.value))}
      />
      <output className="text-muted-foreground min-w-10 shrink-0 whitespace-nowrap text-right text-xs tabular-nums">
        {draftValueLabel}
      </output>
    </div>
  );
}

function SwitchControl({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange(checked: boolean): void;
}) {
  return (
    <Switch checked={checked} disabled={disabled} aria-label={label} onCheckedChange={onChange} />
  );
}

const COLOR_COMMIT_DELAY_MS = 50;

function ColorControl({
  color,
  disabled,
  label,
  onChange,
}: {
  color: string;
  disabled?: boolean;
  label: string;
  onChange(color: string): void;
}) {
  const [draftColor, setDraftColor] = useState(color);
  const draftColorRef = useRef(color);
  const commitTimerRef = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    draftColorRef.current = color;
    setDraftColor(color);
  }, [color]);

  useEffect(
    () => () => {
      if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
    },
    [],
  );

  const commitDraftColor = () => {
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    if (draftColorRef.current !== color) onChangeRef.current(draftColorRef.current);
  };

  const updateDraftColor = (nextColor: string) => {
    draftColorRef.current = nextColor;
    setDraftColor(nextColor);
    if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = null;
      onChangeRef.current(nextColor);
    }, COLOR_COMMIT_DELAY_MS);
  };

  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) commitDraftColor();
      }}
    >
      <PopoverTrigger
        render={<Button type="button" variant="outline" disabled={disabled} aria-label={label} />}
      >
        <span
          aria-hidden="true"
          className="size-[var(--icon-size-lg)] shrink-0 rounded-[var(--input-control-radius)] border border-border"
          style={{ backgroundColor: draftColor }}
        />
        <span className="font-mono text-xs uppercase">{draftColor}</span>
      </PopoverTrigger>
      <PopoverContent align="end">
        <PopoverTitle>{label}</PopoverTitle>
        <ColorPicker
          color={draftColor}
          onChange={updateDraftColor}
          onChangeEnd={commitDraftColor}
        />
      </PopoverContent>
    </Popover>
  );
}

export function AppearanceSettingsItem({ sectionId, itemId }: SettingsItemComponentProps) {
  const { t, text, number } = useI18n();
  const appearanceController = useAppearanceController();
  const preferences = useAppearancePreferences();
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const [themeOverride, setThemeOverride] = useState<"light" | "dark" | null>(null);
  const editingTheme =
    themeOverride ??
    (preferences.colorMode === "dark" || (preferences.colorMode === "system" && systemDark)
      ? "dark"
      : "light");
  const activityIndicators = useRunningIndicatorCatalog();
  const activityIndicatorStyleId = activityIndicators.resolve(
    preferences.runningIndicatorStyleId,
  ).id;
  const activityIndicatorStyleIds = activityIndicators.definitions.map(
    (definition) => definition.id,
  );
  const backgroundImage = useBackgroundImage();
  const page = resolveAppearanceSettingsPage(sectionId);

  const colorModeLabel = (value: ColorMode): string =>
    t(`extensions.appearance.colorModes.${value}`);
  const backgroundBlurLabel = (value: BackgroundBlur): string =>
    t(`extensions.appearance.backgroundBlurs.${value}`);
  const surfaceOpacityLabel = (value: number): string =>
    t("extensions.appearance.surfaces.opacityValue", { opacity: value });
  const glassBlurLabel = (value: GlassBlur): string =>
    t(`extensions.appearance.backgroundBlurs.${value}`);
  const borderStyleLabel = (value: BorderStyle): string =>
    t(`extensions.appearance.borderStyles.${value}`);
  const cornerRadiusLabel = (value: CornerRadiusStyle): string =>
    t(`extensions.appearance.cornerRadiusStyles.${value}`);
  const cornerRadiusIndex = CORNER_RADIUS_STYLES.indexOf(preferences.cornerRadius);
  const cornerRadiusIndexLabel = (value: number): string =>
    cornerRadiusLabel(CORNER_RADIUS_STYLES[value] ?? preferences.cornerRadius);
  const uiFontLabel = (value: UiFontFamily): string =>
    t(`extensions.appearance.fontFamilies.ui.${value}`);
  const contentFontLabel = (value: ContentFontFamily): string =>
    value === "inherit" ? t("extensions.appearance.typography.inheritUiFont") : uiFontLabel(value);
  const runningIndicatorLabel = (value: RunningIndicatorId): string =>
    t(`extensions.appearance.runningIndicator.styles.${value}`);
  const activityIndicatorLabel = (value: string): string =>
    text(activityIndicators.resolve(value).label);
  const activityIndicatorSizeLabel = (value: number): string =>
    t("extensions.appearance.activityAnimation.sizeValue", { size: value });
  const codeFontLabel = (value: CodeFontFamily): string =>
    t(`extensions.appearance.fontFamilies.code.${value}`);
  const codeThemeLabel = (value: CodeTheme): string =>
    t(`extensions.appearance.codeThemes.${value}`);
  const contrastLabel = (value: number): string =>
    t("extensions.appearance.themeSettings.contrastValue", { contrast: value });
  const fontSizeLabel = (value: number): string =>
    t("extensions.appearance.preferences.fontSizeValue", { size: value });
  return (
    <div data-settings-section={sectionId} data-settings-item={itemId} className="py-4">
      <div className="divide-y">
        {page === "appearance" ? (
          <>
            <SettingGroup title={t("extensions.appearance.theme.mode")}>
              <ColorModePicker
                label={t("extensions.appearance.theme.mode")}
                value={preferences.colorMode}
                optionLabel={colorModeLabel}
                onChange={(colorMode) => {
                  setThemeOverride(null);
                  appearanceController.update({ colorMode });
                }}
              />
            </SettingGroup>

            <Tabs
              value={editingTheme}
              onValueChange={(value) => {
                if (value === "light" || value === "dark") setThemeOverride(value);
              }}
            >
              <TabsList aria-label={t("extensions.appearance.palette.title")}>
                <TabsTrigger value="light">{colorModeLabel("light")}</TabsTrigger>
                <TabsTrigger value="dark">{colorModeLabel("dark")}</TabsTrigger>
              </TabsList>
              <p className="mt-2 text-xs text-muted-foreground">
                {t("extensions.appearance.palette.description")}
              </p>
              <TabsContent key={editingTheme} value={editingTheme}>
                <SharedSettingsGroup className="mt-4">
                  <SettingRow label={t("extensions.appearance.themeSettings.accent")} wideControl>
                    <AccentColorControl
                      mode={editingTheme}
                      color={preferences[`${editingTheme}AccentColor`]}
                      onChange={(color) =>
                        appearanceController.update({ [`${editingTheme}AccentColor`]: color })
                      }
                    />
                  </SettingRow>
                  <SettingRow label={t("extensions.appearance.themeSettings.background")}>
                    <ColorControl
                      color={preferences[`${editingTheme}BackgroundColor`]}
                      label={t(`extensions.appearance.themeSettings.${editingTheme}Background`)}
                      onChange={(color) =>
                        appearanceController.update({ [`${editingTheme}BackgroundColor`]: color })
                      }
                    />
                  </SettingRow>
                  <SettingRow label={t("extensions.appearance.themeSettings.foreground")}>
                    <ColorControl
                      color={preferences[`${editingTheme}ForegroundColor`]}
                      label={t(`extensions.appearance.themeSettings.${editingTheme}Foreground`)}
                      onChange={(color) =>
                        appearanceController.update({ [`${editingTheme}ForegroundColor`]: color })
                      }
                    />
                  </SettingRow>
                  <SettingRow label={t("extensions.appearance.typography.font")} wideControl>
                    <FontControl
                      label={t("extensions.appearance.typography.font")}
                      value={preferences.uiFont}
                      options={UI_FONT_FAMILIES}
                      optionLabel={uiFontLabel}
                      weight={preferences.uiFontWeight}
                      onChange={(uiFont) => appearanceController.update({ uiFont })}
                      onWeightChange={(uiFontWeight) =>
                        appearanceController.update({ uiFontWeight })
                      }
                    />
                  </SettingRow>
                  <SettingRow
                    label={t("extensions.appearance.preferences.uiFontSize")}
                    description={t("extensions.appearance.preferences.uiFontSizeDescription")}
                  >
                    <RangeControl
                      label={t("extensions.appearance.preferences.uiFontSize")}
                      value={preferences.uiFontSize}
                      formatValue={fontSizeLabel}
                      minimum={MIN_UI_FONT_SIZE}
                      maximum={MAX_UI_FONT_SIZE}
                      commitOnInteractionEnd
                      onChange={(uiFontSize) => appearanceController.update({ uiFontSize })}
                    />
                  </SettingRow>
                  <SettingRow
                    label={t("extensions.appearance.typography.contentFont")}
                    description={
                      preferences.contentFont === "inherit"
                        ? t("extensions.appearance.typography.inheritedWeightDescription")
                        : undefined
                    }
                    wideControl
                  >
                    <FontControl
                      label={t("extensions.appearance.typography.contentFont")}
                      value={preferences.contentFont}
                      options={CONTENT_FONT_FAMILIES}
                      optionLabel={contentFontLabel}
                      weight={
                        preferences.contentFont === "inherit"
                          ? preferences.uiFontWeight
                          : preferences.contentFontWeight
                      }
                      weightDisabled={preferences.contentFont === "inherit"}
                      onChange={(contentFont) => appearanceController.update({ contentFont })}
                      onWeightChange={(contentFontWeight) =>
                        appearanceController.update({ contentFontWeight })
                      }
                    />
                  </SettingRow>
                  <SettingRow label={t("extensions.appearance.code.font")} wideControl>
                    <FontControl
                      label={t("extensions.appearance.code.font")}
                      value={preferences.codeFont}
                      options={CODE_FONT_FAMILIES}
                      optionLabel={codeFontLabel}
                      weight={preferences.codeFontWeight}
                      onChange={(codeFont) => appearanceController.update({ codeFont })}
                      onWeightChange={(codeFontWeight) =>
                        appearanceController.update({ codeFontWeight })
                      }
                    />
                  </SettingRow>
                  <SettingRow
                    label={t("extensions.appearance.preferences.codeFontSize")}
                    description={t("extensions.appearance.preferences.codeFontSizeDescription")}
                  >
                    <RangeControl
                      label={t("extensions.appearance.preferences.codeFontSize")}
                      value={preferences.codeFontSize}
                      formatValue={fontSizeLabel}
                      minimum={MIN_CODE_FONT_SIZE}
                      maximum={MAX_CODE_FONT_SIZE}
                      onChange={(codeFontSize) => appearanceController.update({ codeFontSize })}
                    />
                  </SettingRow>
                  <SettingRow
                    label={t("extensions.appearance.preferences.codeTheme")}
                    description={t("extensions.appearance.preferences.codeThemeDescription")}
                  >
                    <SelectControl
                      label={t("extensions.appearance.preferences.codeTheme")}
                      value={preferences.codeTheme}
                      options={CODE_THEMES}
                      optionLabel={codeThemeLabel}
                      onChange={(codeTheme) => appearanceController.update({ codeTheme })}
                    />
                  </SettingRow>
                  <div className="py-3">
                    <CodeThemePreview
                      code={CODE_PREVIEW}
                      language="tsx"
                      label={t("extensions.appearance.preferences.codePreview")}
                      codeTheme={preferences.codeTheme}
                    />
                  </div>
                  <SettingRow label={t("extensions.appearance.themeSettings.contrast")}>
                    <RangeControl
                      label={t(`extensions.appearance.themeSettings.${editingTheme}Contrast`)}
                      value={preferences[`${editingTheme}Contrast`] - 100}
                      formatValue={contrastLabel}
                      minimum={MIN_THEME_CONTRAST - 100}
                      maximum={MAX_THEME_CONTRAST - 100}
                      onChange={(contrast) =>
                        appearanceController.update({ [`${editingTheme}Contrast`]: contrast + 100 })
                      }
                    />
                  </SettingRow>
                </SharedSettingsGroup>
              </TabsContent>
            </Tabs>
          </>
        ) : null}

        {page === "interface" ? (
          <>
            <SettingGroup
              title={t("extensions.appearance.runningIndicator.title")}
              description={t("extensions.appearance.runningIndicator.description")}
            >
              <SettingRow label={t("extensions.appearance.runningIndicator.style")}>
                <AnimatedPreviewSelect
                  label={t("extensions.appearance.runningIndicator.style")}
                  value={preferences.runningIndicatorId}
                  options={RUNNING_INDICATOR_IDS}
                  optionLabel={runningIndicatorLabel}
                  renderPreview={(runningIndicatorId, animated) => (
                    <RunningThreadIndicator id={runningIndicatorId} animated={animated} />
                  )}
                  onChange={(runningIndicatorId) =>
                    appearanceController.update({ runningIndicatorId })
                  }
                />
              </SettingRow>
            </SettingGroup>

            <SettingGroup
              title={t("extensions.appearance.activityAnimation.title")}
              description={t("extensions.appearance.activityAnimation.description")}
            >
              <SettingRow label={t("extensions.appearance.activityAnimation.style")}>
                <AnimatedPreviewSelect
                  label={t("extensions.appearance.activityAnimation.style")}
                  value={activityIndicatorStyleId}
                  options={activityIndicatorStyleIds}
                  optionLabel={activityIndicatorLabel}
                  renderPreview={(styleId, animated) => (
                    <RunningIndicator styleId={styleId} paused={!animated} className="size-full" />
                  )}
                  previewAspectRatio={(styleId) =>
                    activityIndicators.resolve(styleId).presentation?.aspectRatio
                  }
                  previewOnly={(styleId) =>
                    activityIndicators.resolve(styleId).presentation?.previewOnly ?? false
                  }
                  previewClassName={(styleId) =>
                    activityIndicators.resolve(styleId).presentation?.previewClassName
                  }
                  onChange={(runningIndicatorStyleId) =>
                    appearanceController.update({ runningIndicatorStyleId })
                  }
                />
              </SettingRow>
              <SettingRow
                label={t("extensions.appearance.activityAnimation.size")}
                description={t("extensions.appearance.activityAnimation.sizeDescription")}
              >
                <RangeControl
                  label={t("extensions.appearance.activityAnimation.size")}
                  value={preferences.runningIndicatorSize}
                  formatValue={activityIndicatorSizeLabel}
                  renderPreview={(size) => (
                    <span
                      className="flex shrink-0 items-center justify-center"
                      style={{ width: size, height: size }}
                    >
                      <RunningIndicator styleId={activityIndicatorStyleId} />
                    </span>
                  )}
                  minimum={MIN_RUNNING_INDICATOR_SIZE}
                  maximum={MAX_RUNNING_INDICATOR_SIZE}
                  onChange={(runningIndicatorSize) =>
                    appearanceController.update({ runningIndicatorSize })
                  }
                />
              </SettingRow>
            </SettingGroup>

            <SettingGroup layout="cards" showHeading={false}>
              <SettingSubgroup title={t("extensions.appearance.borders.title")}>
                <SettingRow label={t("extensions.appearance.borders.style")}>
                  <SelectControl
                    label={t("extensions.appearance.borders.style")}
                    value={preferences.borderStyle}
                    options={BORDER_STYLES}
                    optionLabel={borderStyleLabel}
                    onChange={(borderStyle) => appearanceController.update({ borderStyle })}
                  />
                </SettingRow>
                <SettingRow label={t("extensions.appearance.borders.customColor")}>
                  <SwitchControl
                    checked={preferences.customBorderColor}
                    label={t("extensions.appearance.borders.customColor")}
                    onChange={(customBorderColor) =>
                      appearanceController.update({ customBorderColor })
                    }
                  />
                </SettingRow>
                <SettingRow
                  label={t("extensions.appearance.borders.color")}
                  description={
                    !preferences.customBorderColor
                      ? t("extensions.appearance.borders.colorRequiresCustom")
                      : undefined
                  }
                >
                  <ColorControl
                    color={preferences.borderColor}
                    disabled={!preferences.customBorderColor}
                    label={t("extensions.appearance.borders.color")}
                    onChange={(borderColor) => appearanceController.update({ borderColor })}
                  />
                </SettingRow>
              </SettingSubgroup>

              <SettingSubgroup title={t("extensions.appearance.corners.title")}>
                <SettingRow label={t("extensions.appearance.corners.radius")}>
                  <RangeControl
                    label={t("extensions.appearance.corners.radius")}
                    value={cornerRadiusIndex}
                    formatValue={cornerRadiusIndexLabel}
                    minimum={0}
                    maximum={CORNER_RADIUS_STYLES.length - 1}
                    onChange={(index) => {
                      const cornerRadius = CORNER_RADIUS_STYLES[index];
                      if (cornerRadius) appearanceController.update({ cornerRadius });
                    }}
                  />
                </SettingRow>
              </SettingSubgroup>
            </SettingGroup>
          </>
        ) : null}

        {page === "background" ? (
          <SettingGroup
            title={t("extensions.appearance.background.title")}
            description={t("extensions.appearance.background.description")}
            layout="cards"
            showHeading={false}
          >
            <SettingSubgroup title={t("extensions.appearance.background.colorTitle")}>
              <SettingRow
                label={t("extensions.appearance.background.custom")}
                description={t("extensions.appearance.background.customDescription")}
              >
                <SwitchControl
                  checked={preferences.customBackground}
                  label={t("extensions.appearance.background.custom")}
                  onChange={(customBackground) => appearanceController.update({ customBackground })}
                />
              </SettingRow>
              <SettingRow label={t("extensions.appearance.background.color")}>
                <ColorControl
                  color={preferences.backgroundColor}
                  disabled={!preferences.customBackground}
                  label={t("extensions.appearance.background.color")}
                  onChange={(backgroundColor) => appearanceController.update({ backgroundColor })}
                />
              </SettingRow>
              <SettingRow label={t("extensions.appearance.background.syncSurfaces")}>
                <SwitchControl
                  checked={preferences.syncSurfaceColors}
                  disabled={!preferences.customBackground}
                  label={t("extensions.appearance.background.syncSurfaces")}
                  onChange={(syncSurfaceColors) =>
                    appearanceController.update({ syncSurfaceColors })
                  }
                />
              </SettingRow>
              <SettingRow
                label={t("extensions.appearance.background.surfaceColorBlend")}
                description={t("extensions.appearance.background.surfaceColorBlendDescription")}
              >
                <RangeControl
                  label={t("extensions.appearance.background.surfaceColorBlend")}
                  value={preferences.surfaceColorBlend}
                  formatValue={(value) => number(value / 100, { style: "percent" })}
                  minimum={0}
                  maximum={100}
                  disabled={!preferences.customBackground || !preferences.syncSurfaceColors}
                  onChange={(surfaceColorBlend) =>
                    appearanceController.update({ surfaceColorBlend })
                  }
                />
              </SettingRow>
            </SettingSubgroup>

            <SettingSubgroup title={t("extensions.appearance.background.imageTitle")}>
              <SettingRow label={t("extensions.appearance.background.image")}>
                <BackgroundImagePicker image={backgroundImage} />
              </SettingRow>
              <SettingRow
                label={t("extensions.appearance.background.blur")}
                description={
                  !backgroundImage.url
                    ? t("extensions.appearance.background.blurRequiresImage")
                    : undefined
                }
              >
                <SelectControl
                  label={t("extensions.appearance.background.blur")}
                  value={preferences.backgroundBlur}
                  options={BACKGROUND_BLURS}
                  optionLabel={backgroundBlurLabel}
                  disabled={!backgroundImage.url}
                  onChange={(backgroundBlur) => appearanceController.update({ backgroundBlur })}
                />
              </SettingRow>
            </SettingSubgroup>

            <SettingSubgroup title={t("extensions.appearance.surfaces.title")}>
              <SettingRow
                label={t("extensions.appearance.surfaces.opacity")}
                description={t("extensions.appearance.surfaces.requiresBackground")}
              >
                <RangeControl
                  label={t("extensions.appearance.surfaces.opacity")}
                  value={preferences.surfaceOpacity}
                  formatValue={surfaceOpacityLabel}
                  minimum={MIN_SURFACE_OPACITY}
                  maximum={MAX_SURFACE_OPACITY}
                  disabled={!preferences.customBackground && !backgroundImage.url}
                  onChange={(surfaceOpacity) => appearanceController.update({ surfaceOpacity })}
                />
              </SettingRow>
              <SettingRow label={t("extensions.appearance.surfaces.glassBlur")}>
                <SelectControl
                  label={t("extensions.appearance.surfaces.glassBlur")}
                  value={preferences.glassBlur}
                  options={GLASS_BLURS}
                  optionLabel={glassBlurLabel}
                  disabled={!preferences.customBackground && !backgroundImage.url}
                  onChange={(glassBlur) => appearanceController.update({ glassBlur })}
                />
              </SettingRow>
            </SettingSubgroup>
          </SettingGroup>
        ) : null}
      </div>
    </div>
  );
}
