"use client";

import { CheckIcon, ChevronDownIcon, ImagePlusIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n";
import type { SettingsItemComponentProps } from "@/platform/extensions";

import {
  BACKGROUND_BLURS,
  BORDER_STYLES,
  CODE_FONT_FAMILIES,
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
  isDefaultAppearancePreferences,
  type BackgroundBlur,
  type BorderStyle,
  type CodeFontFamily,
  type ColorMode,
  type CornerRadiusStyle,
  type GlassBlur,
  type UiFontFamily,
} from "./appearance-preferences";
import { appearanceStore, useAppearancePreferences } from "./appearance-store";
import {
  backgroundImageStore,
  useBackgroundImage,
  type BackgroundImageError,
  type BackgroundImageSnapshot,
} from "./background-image-store";

function SettingGroup({
  title,
  description,
  lowerLeft,
  children,
}: {
  title: string;
  description: string;
  lowerLeft?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="py-5 first:pt-1 last:pb-3">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-muted-foreground mt-1 text-sm leading-5">{description}</p>
      </div>
      <div className="mt-4 divide-y">{children}</div>
      {lowerLeft ? <div className="mt-4">{lowerLeft}</div> : null}
    </section>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-14 gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,15rem)] sm:items-center sm:gap-8">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {description ? (
          <p className="text-muted-foreground mt-0.5 text-xs leading-4">{description}</p>
        ) : null}
      </div>
      <div className="min-w-0 w-full sm:w-60 sm:justify-self-end">{children}</div>
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
    <div className="w-48 max-w-full space-y-2">
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
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={image.status === "loading"}
          className="min-w-0 flex-1"
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
        <p className="text-muted-foreground truncate text-xs" title={image.name}>
          {image.name}
        </p>
      ) : null}
      {image.error ? (
        <p className="text-destructive text-xs" role="alert">
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
      <DropdownMenuTrigger
        aria-label={label}
        disabled={disabled}
        className="bg-muted hover:bg-muted/80 flex h-9 w-full items-center justify-between gap-2 rounded-full px-3 text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-muted/80 disabled:pointer-events-none disabled:opacity-50"
      >
        <span className="min-w-0 truncate">{optionLabel(value)}</span>
        <ChevronDownIcon className="text-muted-foreground size-3.5 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" className="min-w-48">
        {options.map((option) => (
          <DropdownMenuItem key={option} className="gap-2 py-1.5" onClick={() => onChange(option)}>
            <span className="min-w-0 flex-1">{optionLabel(option)}</span>
            {option === value ? <CheckIcon className="size-4" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RangeControl({
  label,
  value,
  valueLabel,
  minimum,
  maximum,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  valueLabel: string;
  minimum: number;
  maximum: number;
  disabled?: boolean;
  onChange(value: number): void;
}) {
  const progress = ((value - minimum) / (maximum - minimum)) * 100;

  return (
    <div className="flex h-9 items-center gap-3">
      <input
        type="range"
        min={minimum}
        max={maximum}
        step={1}
        value={value}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={valueLabel}
        className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-foreground [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground"
        style={{
          background: `linear-gradient(to right, var(--foreground) 0%, var(--foreground) ${progress}%, var(--muted) ${progress}%, var(--muted) 100%)`,
        }}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <output className="text-muted-foreground w-10 text-right text-xs tabular-nums">
        {valueLabel}
      </output>
    </div>
  );
}

function CheckboxControl({
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
    <label className="flex h-9 w-full cursor-pointer items-center justify-end has-disabled:cursor-not-allowed has-disabled:opacity-50">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        className="size-4 accent-foreground"
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    </label>
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
      className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm shadow-xs ring-1 ring-black/10 has-disabled:opacity-50"
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
  const contrastLabel = (value: number): string =>
    t("extensions.appearance.themeSettings.contrastValue", { contrast: value });
  const fontSizeLabel = (value: number): string =>
    t("extensions.appearance.preferences.fontSizeValue", { size: value });
  return (
    <div data-settings-section={sectionId} data-settings-item={itemId} className="py-4">
      <div className="divide-y">
        <SettingGroup
          title={t("extensions.appearance.theme.title")}
          description={t("extensions.appearance.theme.description")}
        >
          <SettingRow label={t("extensions.appearance.theme.mode")}>
            <SelectControl
              label={t("extensions.appearance.theme.mode")}
              value={preferences.colorMode}
              options={COLOR_MODES}
              optionLabel={colorModeLabel}
              onChange={(colorMode) => appearanceStore.update({ colorMode })}
            />
          </SettingRow>
        </SettingGroup>

        <SettingGroup
          title={t("extensions.appearance.themeSettings.lightTitle")}
          description={t("extensions.appearance.themeSettings.lightDescription")}
        >
          <SettingRow label={t("extensions.appearance.themeSettings.accent")}>
            <ColorControl
              color={preferences.lightAccentColor}
              label={t("extensions.appearance.themeSettings.lightAccent")}
              onChange={(lightAccentColor) => appearanceStore.update({ lightAccentColor })}
            />
          </SettingRow>
          <SettingRow label={t("extensions.appearance.themeSettings.background")}>
            <ColorControl
              color={preferences.lightBackgroundColor}
              label={t("extensions.appearance.themeSettings.lightBackground")}
              onChange={(lightBackgroundColor) => appearanceStore.update({ lightBackgroundColor })}
            />
          </SettingRow>
          <SettingRow label={t("extensions.appearance.themeSettings.foreground")}>
            <ColorControl
              color={preferences.lightForegroundColor}
              label={t("extensions.appearance.themeSettings.lightForeground")}
              onChange={(lightForegroundColor) => appearanceStore.update({ lightForegroundColor })}
            />
          </SettingRow>
          <SettingRow label={t("extensions.appearance.themeSettings.uiFont")}>
            <SelectControl
              label={t("extensions.appearance.themeSettings.lightUiFont")}
              value={preferences.lightUiFont}
              options={UI_FONT_FAMILIES}
              optionLabel={uiFontLabel}
              onChange={(lightUiFont) => appearanceStore.update({ lightUiFont })}
            />
          </SettingRow>
          <SettingRow label={t("extensions.appearance.themeSettings.codeFont")}>
            <SelectControl
              label={t("extensions.appearance.themeSettings.lightCodeFont")}
              value={preferences.lightCodeFont}
              options={CODE_FONT_FAMILIES}
              optionLabel={codeFontLabel}
              onChange={(lightCodeFont) => appearanceStore.update({ lightCodeFont })}
            />
          </SettingRow>
          <SettingRow label={t("extensions.appearance.themeSettings.contrast")}>
            <RangeControl
              label={t("extensions.appearance.themeSettings.lightContrast")}
              value={preferences.lightContrast}
              valueLabel={contrastLabel(preferences.lightContrast)}
              minimum={MIN_THEME_CONTRAST}
              maximum={MAX_THEME_CONTRAST}
              onChange={(lightContrast) => appearanceStore.update({ lightContrast })}
            />
          </SettingRow>
        </SettingGroup>

        <SettingGroup
          title={t("extensions.appearance.themeSettings.darkTitle")}
          description={t("extensions.appearance.themeSettings.darkDescription")}
        >
          <SettingRow label={t("extensions.appearance.themeSettings.accent")}>
            <ColorControl
              color={preferences.darkAccentColor}
              label={t("extensions.appearance.themeSettings.darkAccent")}
              onChange={(darkAccentColor) => appearanceStore.update({ darkAccentColor })}
            />
          </SettingRow>
          <SettingRow label={t("extensions.appearance.themeSettings.background")}>
            <ColorControl
              color={preferences.darkBackgroundColor}
              label={t("extensions.appearance.themeSettings.darkBackground")}
              onChange={(darkBackgroundColor) => appearanceStore.update({ darkBackgroundColor })}
            />
          </SettingRow>
          <SettingRow label={t("extensions.appearance.themeSettings.foreground")}>
            <ColorControl
              color={preferences.darkForegroundColor}
              label={t("extensions.appearance.themeSettings.darkForeground")}
              onChange={(darkForegroundColor) => appearanceStore.update({ darkForegroundColor })}
            />
          </SettingRow>
          <SettingRow label={t("extensions.appearance.themeSettings.uiFont")}>
            <SelectControl
              label={t("extensions.appearance.themeSettings.darkUiFont")}
              value={preferences.darkUiFont}
              options={UI_FONT_FAMILIES}
              optionLabel={uiFontLabel}
              onChange={(darkUiFont) => appearanceStore.update({ darkUiFont })}
            />
          </SettingRow>
          <SettingRow label={t("extensions.appearance.themeSettings.codeFont")}>
            <SelectControl
              label={t("extensions.appearance.themeSettings.darkCodeFont")}
              value={preferences.darkCodeFont}
              options={CODE_FONT_FAMILIES}
              optionLabel={codeFontLabel}
              onChange={(darkCodeFont) => appearanceStore.update({ darkCodeFont })}
            />
          </SettingRow>
          <SettingRow label={t("extensions.appearance.themeSettings.contrast")}>
            <RangeControl
              label={t("extensions.appearance.themeSettings.darkContrast")}
              value={preferences.darkContrast}
              valueLabel={contrastLabel(preferences.darkContrast)}
              minimum={MIN_THEME_CONTRAST}
              maximum={MAX_THEME_CONTRAST}
              onChange={(darkContrast) => appearanceStore.update({ darkContrast })}
            />
          </SettingRow>
        </SettingGroup>

        <SettingGroup
          title={t("extensions.appearance.background.title")}
          description={t("extensions.appearance.background.description")}
          lowerLeft={<BackgroundImagePicker image={backgroundImage} />}
        >
          <SettingRow label={t("extensions.appearance.background.custom")}>
            <CheckboxControl
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
            <CheckboxControl
              checked={preferences.syncSurfaceColors}
              disabled={!preferences.customBackground}
              label={t("extensions.appearance.background.syncSurfaces")}
              onChange={(syncSurfaceColors) => appearanceStore.update({ syncSurfaceColors })}
            />
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
        </SettingGroup>

        <SettingGroup
          title={t("extensions.appearance.surfaces.title")}
          description={t("extensions.appearance.surfaces.description")}
        >
          <SettingRow label={t("extensions.appearance.surfaces.opacity")}>
            <RangeControl
              label={t("extensions.appearance.surfaces.opacity")}
              value={preferences.surfaceOpacity}
              valueLabel={surfaceOpacityLabel(preferences.surfaceOpacity)}
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
        </SettingGroup>

        <SettingGroup
          title={t("extensions.appearance.borders.title")}
          description={t("extensions.appearance.borders.description")}
        >
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
            <CheckboxControl
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
        </SettingGroup>

        <SettingGroup
          title={t("extensions.appearance.corners.title")}
          description={t("extensions.appearance.corners.description")}
        >
          <SettingRow label={t("extensions.appearance.corners.radius")}>
            <SelectControl
              label={t("extensions.appearance.corners.radius")}
              value={preferences.cornerRadius}
              options={CORNER_RADIUS_STYLES}
              optionLabel={cornerRadiusLabel}
              onChange={(cornerRadius) => appearanceStore.update({ cornerRadius })}
            />
          </SettingRow>
        </SettingGroup>

        <SettingGroup
          title={t("extensions.appearance.preferences.title")}
          description={t("extensions.appearance.preferences.description")}
        >
          <SettingRow
            label={t("extensions.appearance.preferences.pointerCursor")}
            description={t("extensions.appearance.preferences.pointerCursorDescription")}
          >
            <CheckboxControl
              checked={preferences.usePointerCursor}
              label={t("extensions.appearance.preferences.pointerCursor")}
              onChange={(usePointerCursor) => appearanceStore.update({ usePointerCursor })}
            />
          </SettingRow>
          <SettingRow
            label={t("extensions.appearance.preferences.reduceMotion")}
            description={t("extensions.appearance.preferences.reduceMotionDescription")}
          >
            <CheckboxControl
              checked={preferences.reduceMotion}
              label={t("extensions.appearance.preferences.reduceMotion")}
              onChange={(reduceMotion) => appearanceStore.update({ reduceMotion })}
            />
          </SettingRow>
          <SettingRow
            label={t("extensions.appearance.preferences.uiFontSize")}
            description={t("extensions.appearance.preferences.uiFontSizeDescription")}
          >
            <RangeControl
              label={t("extensions.appearance.preferences.uiFontSize")}
              value={preferences.uiFontSize}
              valueLabel={fontSizeLabel(preferences.uiFontSize)}
              minimum={MIN_UI_FONT_SIZE}
              maximum={MAX_UI_FONT_SIZE}
              onChange={(uiFontSize) => appearanceStore.update({ uiFontSize })}
            />
          </SettingRow>
          <SettingRow
            label={t("extensions.appearance.preferences.codeFontSize")}
            description={t("extensions.appearance.preferences.codeFontSizeDescription")}
          >
            <RangeControl
              label={t("extensions.appearance.preferences.codeFontSize")}
              value={preferences.codeFontSize}
              valueLabel={fontSizeLabel(preferences.codeFontSize)}
              minimum={MIN_CODE_FONT_SIZE}
              maximum={MAX_CODE_FONT_SIZE}
              onChange={(codeFontSize) => appearanceStore.update({ codeFontSize })}
            />
          </SettingRow>
          <SettingRow
            label={t("extensions.appearance.preferences.diffMarkers")}
            description={t("extensions.appearance.preferences.diffMarkersDescription")}
          >
            <CheckboxControl
              checked={preferences.showDiffMarkers}
              label={t("extensions.appearance.preferences.diffMarkers")}
              onChange={(showDiffMarkers) => appearanceStore.update({ showDiffMarkers })}
            />
          </SettingRow>
        </SettingGroup>
      </div>

      <div className="flex justify-end pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={
            isDefaultAppearancePreferences(preferences) &&
            backgroundImage.url === null &&
            backgroundImage.error === null
          }
          onClick={() => {
            appearanceStore.reset();
            void backgroundImageStore.clear();
          }}
        >
          <RotateCcwIcon />
          {t("extensions.appearance.reset")}
        </Button>
      </div>
    </div>
  );
}
