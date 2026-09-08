import type { MessageFormatters } from "../../i18n/types";

export const uiEnUS = {
  fileLink: {
    openFailed:
      "The file could not be opened. Check that it exists and is accessible on the connected host.",
  },
  colorPicker: {
    hex: "Hex color",
    red: "Red",
    green: "Green",
    blue: "Blue",
    hue: "Hue",
    saturation: "Saturation and brightness",
    saturationValue: (
      { saturation, brightness }: { saturation: number; brightness: number },
      { number }: MessageFormatters,
    ) =>
      `Saturation ${number(saturation / 100, { style: "percent" })}, Brightness ${number(brightness / 100, { style: "percent" })}`,
  },
  toast: {
    regionLabel: "Notifications",
    closeLabel: "Dismiss notification",
  },
} as const;
