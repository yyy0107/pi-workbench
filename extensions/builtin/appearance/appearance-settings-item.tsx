"use client";

import { CheckIcon, ChevronDownIcon, ImagePlusIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { CodeThemePreview } from "@/components/assistant-ui/shiki-highlighter";
import {
  isPiWorkingWordmarkState,
  PI_WORKING_WORDMARK_ASPECT_RATIO,
  PiWorkingOrb,
} from "@/components/elements/pi-working-orb";
import { RunningThreadIndicator } from "@/components/elements/running-thread-indicator";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuRadioGroup } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  SettingsDropdownContent,
  SettingsDropdownItem,
  SettingsDropdownRadioItem,
  SettingsDropdownTrigger,
} from "@/components/ui/settings-control";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { SettingsItemComponentProps } from "@/platform/extensions";

import {
  BACKGROUND_BLURS,
  BORDER_STYLES,
  CODE_FONT_FAMILIES,
  CODE_THEMES,
  COLOR_MODES,
  CORNER_RADIUS_STYLES,
  DEFAULT_APPEARANCE_PREFERENCES,
  GLASS_BLURS,
  MAX_CODE_FONT_SIZE,
  MAX_CONTROL_HEIGHT,
  MAX_PI_WORKING_ORB_SIZE,
  MAX_SURFACE_OPACITY,
  MAX_SWITCH_CONTROL_HEIGHT,
  MAX_THEME_CONTRAST,
  MAX_UI_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_CONTROL_HEIGHT,
  MIN_PI_WORKING_ORB_SIZE,
  MIN_SURFACE_OPACITY,
  MIN_SWITCH_CONTROL_HEIGHT,
  MIN_THEME_CONTRAST,
  MIN_UI_FONT_SIZE,
  PI_WORKING_ORB_STATES,
  RUNNING_INDICATOR_IDS,
  UI_FONT_FAMILIES,
  type BackgroundBlur,
  type BorderStyle,
  type CodeFontFamily,
  type CodeTheme,
  type ColorMode,
  type CornerRadiusStyle,
  type GlassBlur,
  type PiWorkingOrbState,
  type RunningIndicatorId,
  type UiFontFamily,
} from "@/services/appearance/appearance-preferences";
import { appearanceStore, useAppearancePreferences } from "@/services/appearance/appearance-store";

import {
  backgroundImageStore,
  useBackgroundImage,
  type BackgroundImageError,
  type BackgroundImageSnapshot,
} from "./background-image-store";
import { resolveAppearanceSettingsPage } from "./appearance-settings-pages";

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
  const hasHeading = showHeading && Boolean(title);
  return (
    <section className="py-5 first:pt-1 last:pb-3">
      {hasHeading ? (
        <div>
          <h3 className="text-sm font-medium">{title}</h3>
          {description ? (
            <p className="text-muted-foreground mt-1 text-sm leading-5">{description}</p>
          ) : null}
        </div>
      ) : null}
      <div
        className={
          layout === "cards"
            ? hasHeading
              ? "mt-4 space-y-6"
              : "space-y-6"
            : hasHeading
              ? "mt-4 divide-y"
              : "divide-y"
        }
      >
        {children}
      </div>
    </section>
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
      <div className="mt-4 rounded-lg border px-4 py-1">
        <div className="divide-y">{children}</div>
      </div>
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
    <div
      className={
        wideControl
          ? "grid min-h-14 gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] sm:items-center sm:gap-8"
          : "grid min-h-14 gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,15rem)] sm:items-center sm:gap-8"
      }
    >
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {description ? (
          <p className="text-muted-foreground mt-0.5 text-xs leading-4">{description}</p>
        ) : null}
      </div>
      <div
        className={
          wideControl
            ? "flex min-w-0 w-full justify-end justify-self-end"
            : "flex min-w-0 w-full justify-end justify-self-end sm:w-60"
        }
      >
        {children}
      </div>
    </div>
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

function ThemeModeControls({
  lightLabel,
  darkLabel,
  lightControl,
  darkControl,
}: {
  lightLabel: string;
  darkLabel: string;
  lightControl: ReactNode;
  darkControl: ReactNode;
}) {
  return (
    <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="min-w-0 space-y-1.5">
        <div className="text-muted-foreground text-right text-xs">{lightLabel}</div>
        <div className="flex justify-end">{lightControl}</div>
      </div>
      <div className="min-w-0 space-y-1.5">
        <div className="text-muted-foreground text-right text-xs">{darkLabel}</div>
        <div className="flex justify-end">{darkControl}</div>
      </div>
    </div>
  );
}

function BackgroundImagePicker({ image }: { image: BackgroundImageSnapshot }) {
  const { t } = useI18n();
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
          if (file) void backgroundImageStore.setFile(file);
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
            onClick={() => void backgroundImageStore.clear()}
          >
            <Trash2Icon />
          </Button>
        ) : null}
      </div>
      {image.name ? (
        <p className="text-muted-foreground w-full truncate text-right text-xs" title={image.name}>
          {image.name}
        </p>
      ) : null}
      {image.error ? (
        <p className="text-destructive w-full text-right text-xs" role="alert">
          {errorLabel(image.error)}
        </p>
      ) : null}
    </div>
  );
}

function ControlHeightPreview() {
  const { t } = useI18n();
  const [dropdownSelection, setDropdownSelection] = useState<"primary" | "secondary">("primary");
  const dropdownLabels = {
    primary: t("extensions.appearance.controls.preview.dropdownPrimary"),
    secondary: t("extensions.appearance.controls.preview.dropdownSecondary"),
  } as const;

  return (
    <div className="py-4">
      <div
        role="group"
        aria-label={t("extensions.appearance.controls.preview.title")}
        className="rounded-[var(--radius-lg)] border [background:color-mix(in_oklab,var(--muted)_45%,transparent)] p-4"
      >
        <div className="text-muted-foreground text-xs font-medium">
          {t("extensions.appearance.controls.preview.title")}
        </div>
        <div className="mt-3 grid items-end gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <label className="min-w-0 space-y-1.5">
            <span className="text-muted-foreground block text-xs">
              {t("extensions.appearance.controls.preview.inputLabel")}
            </span>
            <Input
              aria-label={t("extensions.appearance.controls.preview.inputLabel")}
              placeholder={t("extensions.appearance.controls.preview.inputPlaceholder")}
            />
          </label>

          <div className="min-w-0 space-y-1.5">
            <div className="text-muted-foreground text-xs">
              {t("extensions.appearance.controls.preview.dropdownLabel")}
            </div>
            <DropdownMenu>
              <SettingsDropdownTrigger
                aria-label={t("extensions.appearance.controls.preview.dropdownLabel")}
                className="w-full justify-between"
              >
                <span className="min-w-0 truncate">{dropdownLabels[dropdownSelection]}</span>
                <ChevronDownIcon className="text-muted-foreground size-3.5 shrink-0" />
              </SettingsDropdownTrigger>
              <SettingsDropdownContent align="start" side="bottom">
                {(["primary", "secondary"] as const).map((option) => (
                  <SettingsDropdownItem key={option} onClick={() => setDropdownSelection(option)}>
                    <span className="min-w-0 flex-1">{dropdownLabels[option]}</span>
                    {option === dropdownSelection ? <CheckIcon className="size-4" /> : null}
                  </SettingsDropdownItem>
                ))}
              </SettingsDropdownContent>
            </DropdownMenu>
          </div>

          <div className="min-w-0 space-y-1.5">
            <div className="text-muted-foreground text-xs">
              {t("extensions.appearance.controls.preview.buttonLabel")}
            </div>
            <Button type="button" className="w-full">
              {t("extensions.appearance.controls.preview.buttonValue")}
            </Button>
          </div>

          <div className="min-w-0 space-y-1.5">
            <div className="text-muted-foreground text-xs">
              {t("extensions.appearance.controls.preview.switchLabel")}
            </div>
            <label className="flex min-h-[var(--dropdown-control-height)] cursor-pointer items-center justify-between gap-3 rounded-[var(--input-control-radius)] border [border-color:var(--input-control-border)] [background:var(--input-control-background)] px-3 py-1">
              <span className="min-w-0 truncate text-sm">
                {t("extensions.appearance.controls.preview.switchValue")}
              </span>
              <Switch
                defaultChecked
                aria-label={t("extensions.appearance.controls.preview.switchValue")}
              />
            </label>
          </div>
        </div>
      </div>
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
  optionLabel(value: Value): string;
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
          isPreviewOnly ? "h-8 w-44 px-2" : "h-5",
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
    <div className="flex h-8 w-full items-center gap-3">
      {renderPreview ? (
        <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center">
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

function getColorControlForeground(color: string): "#18181b" | "#ffffff" {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
  if (channels.some(Number.isNaN)) return "#18181b";

  const [red = 0, green = 0, blue = 0] = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  return luminance > 0.179 ? "#18181b" : "#ffffff";
}

const COLOR_COMMIT_DELAY_MS = 160;

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
    <label
      className="flex h-8 w-fit max-w-full items-center gap-2 rounded-[var(--input-control-radius)] px-2.5 text-sm shadow-xs ring-1 ring-black/10 has-disabled:opacity-50"
      style={{
        backgroundColor: draftColor,
        color: getColorControlForeground(draftColor),
      }}
    >
      <input
        type="color"
        value={draftColor}
        disabled={disabled}
        aria-label={label}
        className="size-5 shrink-0 cursor-pointer appearance-none overflow-hidden rounded-full border border-current bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0"
        onBlur={commitDraftColor}
        onChange={(event) => updateDraftColor(event.currentTarget.value)}
      />
      <span className="font-mono text-xs uppercase opacity-80">{draftColor}</span>
    </label>
  );
}

export function AppearanceSettingsItem({ sectionId, itemId }: SettingsItemComponentProps) {
  const { t } = useI18n();
  const preferences = useAppearancePreferences();
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
  const runningIndicatorLabel = (value: RunningIndicatorId): string =>
    t(`extensions.appearance.runningIndicator.styles.${value}`);
  const piWorkingOrbLabel = (value: PiWorkingOrbState): string =>
    t(`extensions.appearance.piWorkingAnimation.styles.${value}`);
  const piWorkingOrbSizeLabel = (value: number): string =>
    t("extensions.appearance.piWorkingAnimation.sizeValue", { size: value });
  const codeFontLabel = (value: CodeFontFamily): string =>
    t(`extensions.appearance.fontFamilies.code.${value}`);
  const codeThemeLabel = (value: CodeTheme): string =>
    t(`extensions.appearance.codeThemes.${value}`);
  const contrastLabel = (value: number): string =>
    t("extensions.appearance.themeSettings.contrastValue", { contrast: value });
  const fontSizeLabel = (value: number): string =>
    t("extensions.appearance.preferences.fontSizeValue", { size: value });
  const controlHeightLabel = (value: number): string =>
    t("extensions.appearance.controls.heightValue", { height: value });
  const controlHeightsAreDefault =
    preferences.controlHeight === DEFAULT_APPEARANCE_PREFERENCES.controlHeight &&
    preferences.switchControlHeight === DEFAULT_APPEARANCE_PREFERENCES.switchControlHeight;
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
                onChange={(colorMode) => appearanceStore.update({ colorMode })}
              />
            </SettingGroup>

            <SettingGroup
              title={t("extensions.appearance.palette.title")}
              description={t("extensions.appearance.palette.description")}
            >
              <SettingRow label={t("extensions.appearance.themeSettings.accent")} wideControl>
                <ThemeModeControls
                  lightLabel={colorModeLabel("light")}
                  darkLabel={colorModeLabel("dark")}
                  lightControl={
                    <ColorControl
                      color={preferences.lightAccentColor}
                      label={t("extensions.appearance.themeSettings.lightAccent")}
                      onChange={(lightAccentColor) => appearanceStore.update({ lightAccentColor })}
                    />
                  }
                  darkControl={
                    <ColorControl
                      color={preferences.darkAccentColor}
                      label={t("extensions.appearance.themeSettings.darkAccent")}
                      onChange={(darkAccentColor) => appearanceStore.update({ darkAccentColor })}
                    />
                  }
                />
              </SettingRow>
              <SettingRow label={t("extensions.appearance.themeSettings.background")} wideControl>
                <ThemeModeControls
                  lightLabel={colorModeLabel("light")}
                  darkLabel={colorModeLabel("dark")}
                  lightControl={
                    <ColorControl
                      color={preferences.lightBackgroundColor}
                      label={t("extensions.appearance.themeSettings.lightBackground")}
                      onChange={(lightBackgroundColor) =>
                        appearanceStore.update({ lightBackgroundColor })
                      }
                    />
                  }
                  darkControl={
                    <ColorControl
                      color={preferences.darkBackgroundColor}
                      label={t("extensions.appearance.themeSettings.darkBackground")}
                      onChange={(darkBackgroundColor) =>
                        appearanceStore.update({ darkBackgroundColor })
                      }
                    />
                  }
                />
              </SettingRow>
              <SettingRow label={t("extensions.appearance.themeSettings.foreground")} wideControl>
                <ThemeModeControls
                  lightLabel={colorModeLabel("light")}
                  darkLabel={colorModeLabel("dark")}
                  lightControl={
                    <ColorControl
                      color={preferences.lightForegroundColor}
                      label={t("extensions.appearance.themeSettings.lightForeground")}
                      onChange={(lightForegroundColor) =>
                        appearanceStore.update({ lightForegroundColor })
                      }
                    />
                  }
                  darkControl={
                    <ColorControl
                      color={preferences.darkForegroundColor}
                      label={t("extensions.appearance.themeSettings.darkForeground")}
                      onChange={(darkForegroundColor) =>
                        appearanceStore.update({ darkForegroundColor })
                      }
                    />
                  }
                />
              </SettingRow>
              <SettingRow label={t("extensions.appearance.themeSettings.contrast")} wideControl>
                <ThemeModeControls
                  lightLabel={colorModeLabel("light")}
                  darkLabel={colorModeLabel("dark")}
                  lightControl={
                    <RangeControl
                      label={t("extensions.appearance.themeSettings.lightContrast")}
                      value={preferences.lightContrast}
                      formatValue={contrastLabel}
                      minimum={MIN_THEME_CONTRAST}
                      maximum={MAX_THEME_CONTRAST}
                      onChange={(lightContrast) => appearanceStore.update({ lightContrast })}
                    />
                  }
                  darkControl={
                    <RangeControl
                      label={t("extensions.appearance.themeSettings.darkContrast")}
                      value={preferences.darkContrast}
                      formatValue={contrastLabel}
                      minimum={MIN_THEME_CONTRAST}
                      maximum={MAX_THEME_CONTRAST}
                      onChange={(darkContrast) => appearanceStore.update({ darkContrast })}
                    />
                  }
                />
              </SettingRow>
            </SettingGroup>
          </>
        ) : null}

        {page === "interface" ? (
          <>
            <SettingGroup
              title={t("extensions.appearance.typography.title")}
              description={t("extensions.appearance.typography.description")}
            >
              <SettingRow label={t("extensions.appearance.typography.font")}>
                <SelectControl
                  label={t("extensions.appearance.typography.font")}
                  value={preferences.uiFont}
                  options={UI_FONT_FAMILIES}
                  optionLabel={uiFontLabel}
                  onChange={(uiFont) => appearanceStore.update({ uiFont })}
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
                  onChange={(uiFontSize) => appearanceStore.update({ uiFontSize })}
                />
              </SettingRow>
            </SettingGroup>

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
                  onChange={(runningIndicatorId) => appearanceStore.update({ runningIndicatorId })}
                />
              </SettingRow>
            </SettingGroup>

            <SettingGroup
              title={t("extensions.appearance.piWorkingAnimation.title")}
              description={t("extensions.appearance.piWorkingAnimation.description")}
            >
              <SettingRow label={t("extensions.appearance.piWorkingAnimation.style")}>
                <AnimatedPreviewSelect
                  label={t("extensions.appearance.piWorkingAnimation.style")}
                  value={preferences.piWorkingOrbState}
                  options={PI_WORKING_ORB_STATES}
                  optionLabel={piWorkingOrbLabel}
                  renderPreview={(piWorkingOrbState, animated) => (
                    <PiWorkingOrb
                      state={piWorkingOrbState}
                      paused={!animated}
                      className="size-full"
                    />
                  )}
                  previewAspectRatio={(piWorkingOrbState) =>
                    isPiWorkingWordmarkState(piWorkingOrbState)
                      ? PI_WORKING_WORDMARK_ASPECT_RATIO
                      : undefined
                  }
                  previewOnly={isPiWorkingWordmarkState}
                  previewClassName={(piWorkingOrbState) => {
                    if (piWorkingOrbState === "pi-wordmark-on-light") {
                      return "rounded-md border border-black/10 bg-white";
                    }
                    if (piWorkingOrbState === "pi-wordmark-on-dark") {
                      return "rounded-md border border-white/10 bg-zinc-950";
                    }
                    return undefined;
                  }}
                  onChange={(piWorkingOrbState) => appearanceStore.update({ piWorkingOrbState })}
                />
              </SettingRow>
              <SettingRow
                label={t("extensions.appearance.piWorkingAnimation.size")}
                description={t("extensions.appearance.piWorkingAnimation.sizeDescription")}
              >
                <RangeControl
                  label={t("extensions.appearance.piWorkingAnimation.size")}
                  value={preferences.piWorkingOrbSize}
                  formatValue={piWorkingOrbSizeLabel}
                  renderPreview={(size) => (
                    <span
                      className="flex shrink-0 items-center justify-center"
                      style={{ width: size, height: size }}
                    >
                      <PiWorkingOrb state={preferences.piWorkingOrbState} />
                    </span>
                  )}
                  minimum={MIN_PI_WORKING_ORB_SIZE}
                  maximum={MAX_PI_WORKING_ORB_SIZE}
                  onChange={(piWorkingOrbSize) => appearanceStore.update({ piWorkingOrbSize })}
                />
              </SettingRow>
            </SettingGroup>

            <SettingGroup layout="cards" showHeading={false}>
              <SettingSubgroup
                title={t("extensions.appearance.controls.title")}
                action={
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={controlHeightsAreDefault}
                    onClick={() => {
                      appearanceStore.update({
                        controlHeight: DEFAULT_APPEARANCE_PREFERENCES.controlHeight,
                        switchControlHeight: DEFAULT_APPEARANCE_PREFERENCES.switchControlHeight,
                      });
                    }}
                  >
                    <RotateCcwIcon />
                    {t("extensions.appearance.reset")}
                  </Button>
                }
              >
                <ControlHeightPreview />
                <SettingRow
                  label={t("extensions.appearance.controls.controlHeight")}
                  description={t("extensions.appearance.controls.controlHeightDescription")}
                >
                  <RangeControl
                    label={t("extensions.appearance.controls.controlHeight")}
                    value={preferences.controlHeight}
                    formatValue={controlHeightLabel}
                    minimum={MIN_CONTROL_HEIGHT}
                    maximum={MAX_CONTROL_HEIGHT}
                    onChange={(controlHeight) => appearanceStore.update({ controlHeight })}
                  />
                </SettingRow>
                <SettingRow
                  label={t("extensions.appearance.controls.switchHeight")}
                  description={t("extensions.appearance.controls.switchHeightDescription")}
                >
                  <RangeControl
                    label={t("extensions.appearance.controls.switchHeight")}
                    value={preferences.switchControlHeight}
                    formatValue={controlHeightLabel}
                    minimum={MIN_SWITCH_CONTROL_HEIGHT}
                    maximum={MAX_SWITCH_CONTROL_HEIGHT}
                    onChange={(switchControlHeight) =>
                      appearanceStore.update({ switchControlHeight })
                    }
                  />
                </SettingRow>
              </SettingSubgroup>

              <SettingSubgroup title={t("extensions.appearance.surfaces.title")}>
                <SettingRow label={t("extensions.appearance.surfaces.opacity")}>
                  <RangeControl
                    label={t("extensions.appearance.surfaces.opacity")}
                    value={preferences.surfaceOpacity}
                    formatValue={surfaceOpacityLabel}
                    minimum={MIN_SURFACE_OPACITY}
                    maximum={MAX_SURFACE_OPACITY}
                    disabled={!preferences.customBackground && !backgroundImage.url}
                    onChange={(surfaceOpacity) => appearanceStore.update({ surfaceOpacity })}
                  />
                </SettingRow>
                <SettingRow label={t("extensions.appearance.surfaces.glassBlur")}>
                  <SelectControl
                    label={t("extensions.appearance.surfaces.glassBlur")}
                    value={preferences.glassBlur}
                    options={GLASS_BLURS}
                    optionLabel={glassBlurLabel}
                    disabled={!preferences.customBackground && !backgroundImage.url}
                    onChange={(glassBlur) => appearanceStore.update({ glassBlur })}
                  />
                </SettingRow>
              </SettingSubgroup>

              <SettingSubgroup title={t("extensions.appearance.borders.title")}>
                <SettingRow label={t("extensions.appearance.borders.style")}>
                  <SelectControl
                    label={t("extensions.appearance.borders.style")}
                    value={preferences.borderStyle}
                    options={BORDER_STYLES}
                    optionLabel={borderStyleLabel}
                    onChange={(borderStyle) => appearanceStore.update({ borderStyle })}
                  />
                </SettingRow>
                <SettingRow label={t("extensions.appearance.borders.customColor")}>
                  <SwitchControl
                    checked={preferences.customBorderColor}
                    label={t("extensions.appearance.borders.customColor")}
                    onChange={(customBorderColor) => appearanceStore.update({ customBorderColor })}
                  />
                </SettingRow>
                <SettingRow label={t("extensions.appearance.borders.color")}>
                  <ColorControl
                    color={preferences.borderColor}
                    disabled={!preferences.customBorderColor}
                    label={t("extensions.appearance.borders.color")}
                    onChange={(borderColor) => appearanceStore.update({ borderColor })}
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
                      if (cornerRadius) appearanceStore.update({ cornerRadius });
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
              <SettingRow label={t("extensions.appearance.background.custom")}>
                <SwitchControl
                  checked={preferences.customBackground}
                  label={t("extensions.appearance.background.custom")}
                  onChange={(customBackground) => appearanceStore.update({ customBackground })}
                />
              </SettingRow>
              <SettingRow label={t("extensions.appearance.background.color")}>
                <ColorControl
                  color={preferences.backgroundColor}
                  disabled={!preferences.customBackground}
                  label={t("extensions.appearance.background.color")}
                  onChange={(backgroundColor) => appearanceStore.update({ backgroundColor })}
                />
              </SettingRow>
              <SettingRow label={t("extensions.appearance.background.syncSurfaces")}>
                <SwitchControl
                  checked={preferences.syncSurfaceColors}
                  disabled={!preferences.customBackground}
                  label={t("extensions.appearance.background.syncSurfaces")}
                  onChange={(syncSurfaceColors) => appearanceStore.update({ syncSurfaceColors })}
                />
              </SettingRow>
            </SettingSubgroup>

            <SettingSubgroup title={t("extensions.appearance.background.imageTitle")}>
              <SettingRow label={t("extensions.appearance.background.image")}>
                <BackgroundImagePicker image={backgroundImage} />
              </SettingRow>
              <SettingRow label={t("extensions.appearance.background.blur")}>
                <SelectControl
                  label={t("extensions.appearance.background.blur")}
                  value={preferences.backgroundBlur}
                  options={BACKGROUND_BLURS}
                  optionLabel={backgroundBlurLabel}
                  disabled={!backgroundImage.url}
                  onChange={(backgroundBlur) => appearanceStore.update({ backgroundBlur })}
                />
              </SettingRow>
            </SettingSubgroup>
          </SettingGroup>
        ) : null}

        {page === "code" ? (
          <SettingGroup
            title={t("extensions.appearance.code.title")}
            description={t("extensions.appearance.code.description")}
            showHeading={false}
          >
            <SettingRow label={t("extensions.appearance.code.font")}>
              <SelectControl
                label={t("extensions.appearance.code.font")}
                value={preferences.codeFont}
                options={CODE_FONT_FAMILIES}
                optionLabel={codeFontLabel}
                onChange={(codeFont) => appearanceStore.update({ codeFont })}
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
                onChange={(codeFontSize) => appearanceStore.update({ codeFontSize })}
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
                onChange={(codeTheme) => appearanceStore.update({ codeTheme })}
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
            <SettingRow
              label={t("extensions.appearance.preferences.diffMarkers")}
              description={t("extensions.appearance.preferences.diffMarkersDescription")}
            >
              <SwitchControl
                checked={preferences.showDiffMarkers}
                label={t("extensions.appearance.preferences.diffMarkers")}
                onChange={(showDiffMarkers) => appearanceStore.update({ showDiffMarkers })}
              />
            </SettingRow>
          </SettingGroup>
        ) : null}
      </div>
    </div>
  );
}
