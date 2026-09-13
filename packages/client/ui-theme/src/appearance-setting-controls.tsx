"use client";
import { themeTranslationBundle } from "./i18n";
import { useI18n } from "@workbench/i18n";

import { CheckIcon, ChevronDownIcon, ImagePlusIcon, Trash2Icon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { Button } from "@workbench/ui";
import { DropdownMenu, DropdownMenuRadioGroup } from "@workbench/ui";
import {
  SettingsGroup as SharedSettingsGroup,
  SettingsRow as SharedSettingsRow,
} from "@workbench/ui";
import {
  SettingsDropdownContent,
  SettingsDropdownItem,
  SettingsDropdownRadioItem,
  SettingsDropdownTrigger,
} from "@workbench/ui";

import { cn } from "@workbench/ui/utils";

import {
  ACCENT_PALETTES,
  COLOR_MODES,
  FONT_WEIGHTS,
  type AccentPreset,
  type ColorMode,
  type FontWeight,
} from "@workbench/appearance";

import {
  useBackgroundImageController,
  type BackgroundImageError,
  type BackgroundImageSnapshot,
} from "./background-image-store";

import { withTooltip } from "@workbench/ui";
import { ColorControl } from "./appearance-controls";

export function SettingGroup({
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

export function SettingSubgroup({
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

export function SettingRow({
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

export function ColorModePreview({ mode }: { mode: ColorMode }) {
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

export function ColorModePicker({
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

export function BackgroundImagePicker({ image }: { image: BackgroundImageSnapshot }) {
  const { t } = useI18n(themeTranslationBundle);
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

export function SelectControl<Value extends string | number>({
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
      <SettingsDropdownContent
        align="end"
        side="bottom"
        className="max-h-[min(20rem,var(--available-height))]"
      >
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

export function FontControl<Value extends string>({
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
  const { t } = useI18n(themeTranslationBundle);
  return (
    <div className="flex min-w-0 flex-wrap justify-end gap-2">
      <SelectControl
        label={label}
        value={value}
        options={options.includes(value) ? options : [...options, value]}
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

const ACCENT_PRESETS = [...(Object.keys(ACCENT_PALETTES) as AccentPreset[]), "custom"] as const;

export function AccentColorControl({
  mode,
  color,
  onChange,
}: {
  mode: "light" | "dark";
  color: string;
  onChange(color: string): void;
}) {
  const { t } = useI18n(themeTranslationBundle);
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

export function AnimatedPreviewSelect<Value extends string>({
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
