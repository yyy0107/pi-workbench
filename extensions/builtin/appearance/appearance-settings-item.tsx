"use client";

import { CheckIcon, ChevronDownIcon, ImagePlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { CodeThemePreview } from "@/components/assistant-ui/shiki-highlighter";
import { Button } from "@/components/ui/button";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import {
  SettingsDropdownContent,
  SettingsDropdownItem,
  SettingsDropdownTrigger,
} from "@/components/ui/settings-control";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/i18n";
import type { SettingsItemComponentProps } from "@/platform/extensions";

import {
  BACKGROUND_BLURS,
  BORDER_STYLES,
  CODE_FONT_FAMILIES,
  CODE_THEMES,
  COLOR_MODES,
  CORNER_RADIUS_STYLES,
  GLASS_BLURS,
  MAX_CODE_FONT_SIZE,
  MAX_SURFACE_OPACITY,
  MAX_THEME_CONTRAST,
  MAX_UI_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_SURFACE_OPACITY,
  MIN_THEME_CONTRAST,
  MIN_UI_FONT_SIZE,
  UI_FONT_FAMILIES,
  type BackgroundBlur,
  type BorderStyle,
  type CodeFontFamily,
  type CodeTheme,
  type ColorMode,
  type CornerRadiusStyle,
  type GlassBlur,
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

function SettingSubgroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h4 className="text-sm font-medium">{title}</h4>
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
          className="min-w-0 max-w-full rounded-full"
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
            className="rounded-full"
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

const RANGE_COMMIT_DELAY_MS = 100;

function RangeControl({
  label,
  value,
  formatValue,
  minimum,
  maximum,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  formatValue(value: number): string;
  minimum: number;
  maximum: number;
  disabled?: boolean;
  onChange(value: number): void;
}) {
  const [draftValue, setDraftValue] = useState(value);
  const draftValueRef = useRef(value);
  const committedValueRef = useRef(value);
  const interactingRef = useRef(false);
  const commitTimerRef = useRef<number | null>(null);
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
    },
    [],
  );

  const commitDraftValue = () => {
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    if (draftValueRef.current !== committedValueRef.current) {
      committedValueRef.current = draftValueRef.current;
      onChangeRef.current(draftValueRef.current);
    }
  };

  const finishInteraction = () => {
    interactingRef.current = false;
    commitDraftValue();
  };

  const updateDraftValue = (nextValue: number) => {
    interactingRef.current = true;
    draftValueRef.current = nextValue;
    setDraftValue(nextValue);
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
        onBlur={finishInteraction}
        onChange={(event) => updateDraftValue(Number(event.currentTarget.value))}
        onKeyUp={finishInteraction}
        onPointerCancel={finishInteraction}
        onPointerDown={() => {
          interactingRef.current = true;
        }}
        onPointerUp={finishInteraction}
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
      className="flex h-8 w-fit max-w-full items-center gap-2 rounded-full px-2.5 text-sm shadow-xs ring-1 ring-black/10 has-disabled:opacity-50"
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
  const uiFontLabel = (value: UiFontFamily): string =>
    t(`extensions.appearance.fontFamilies.ui.${value}`);
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
                  onChange={(uiFontSize) => appearanceStore.update({ uiFontSize })}
                />
              </SettingRow>
            </SettingGroup>

            <SettingGroup layout="cards" showHeading={false}>
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
                  <SelectControl
                    label={t("extensions.appearance.corners.radius")}
                    value={preferences.cornerRadius}
                    options={CORNER_RADIUS_STYLES}
                    optionLabel={cornerRadiusLabel}
                    onChange={(cornerRadius) => appearanceStore.update({ cornerRadius })}
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
