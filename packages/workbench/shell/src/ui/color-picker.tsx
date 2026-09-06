"use client";

import { useEffect, useRef, useState } from "react";
import { HexColorPicker } from "react-colorful";

import { useI18n } from "../i18n";
import { Input } from "./input";

export function normalizeHexColor(value: string): string | undefined {
  const hex = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(value.trim())?.[1];
  if (!hex) return undefined;
  return `#${hex.length === 3 ? [...hex].map((digit) => digit.repeat(2)).join("") : hex}`.toLowerCase();
}

export function ColorPicker({
  color,
  onChange,
  onChangeEnd,
}: {
  color: string;
  onChange(color: string): void;
  onChangeEnd(): void;
}) {
  const { t } = useI18n();
  const pickerRef = useRef<HTMLDivElement>(null);
  const sliderValueRef = useRef({ saturation: 0, brightness: 0 });
  const [hex, setHex] = useState(color);

  useEffect(() => setHex(color), [color]);

  useEffect(() => {
    const saturation = pickerRef.current?.querySelector(
      ".react-colorful__saturation [role=slider]",
    );
    const hue = pickerRef.current?.querySelector(".react-colorful__hue [role=slider]");
    if (!saturation || !hue) return;
    saturation.setAttribute("aria-label", t("ui.colorPicker.saturation"));
    hue.setAttribute("aria-label", t("ui.colorPicker.hue"));
    // react-colorful has no localization API for its internal slider announcements.
    const translateValue = () => {
      const original = saturation.getAttribute("aria-valuetext") ?? "";
      const values = /^Saturation ([\d.]+)%, Brightness ([\d.]+)%$/.exec(original);
      if (values)
        sliderValueRef.current = { saturation: Number(values[1]), brightness: Number(values[2]) };
      const translated = t("ui.colorPicker.saturationValue", sliderValueRef.current);
      if (translated !== original) saturation.setAttribute("aria-valuetext", translated);
    };
    translateValue();
    const observer = new MutationObserver(translateValue);
    observer.observe(saturation, { attributes: true, attributeFilter: ["aria-valuetext"] });
    return () => observer.disconnect();
  }, [t]);

  const commitHex = () => {
    const next = normalizeHexColor(hex);
    setHex(next ?? color);
    if (next) onChange(next);
    onChangeEnd();
  };

  return (
    <div data-slot="color-picker" className="flex flex-col gap-3">
      <div ref={pickerRef}>
        <HexColorPicker color={color} onChange={onChange} onChangeEnd={onChangeEnd} />
      </div>
      <label className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>HEX</span>
        <Input
          aria-label={t("ui.colorPicker.hex")}
          aria-invalid={!normalizeHexColor(hex)}
          className="font-mono uppercase"
          spellCheck={false}
          value={hex}
          onChange={(event) => setHex(event.currentTarget.value)}
          onBlur={commitHex}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitHex();
          }}
        />
      </label>
      <div className="grid grid-cols-3 gap-2">
        {(["red", "green", "blue"] as const).map((channel, index) => (
          <label key={channel} className="flex flex-col gap-1 text-xs text-muted-foreground">
            <span>{t(`ui.colorPicker.${channel}`)}</span>
            <Input
              type="number"
              min={0}
              max={255}
              step={1}
              aria-label={t(`ui.colorPicker.${channel}`)}
              className="tabular-nums"
              value={Number.parseInt(color.slice(index * 2 + 1, index * 2 + 3), 16)}
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                if (!Number.isInteger(value) || value < 0 || value > 255) return;
                const offset = index * 2 + 1;
                onChange(
                  `${color.slice(0, offset)}${value.toString(16).padStart(2, "0")}${color.slice(offset + 2)}`,
                );
              }}
              onBlur={onChangeEnd}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
