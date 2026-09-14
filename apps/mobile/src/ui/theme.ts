import { useColorScheme } from "react-native";

export interface MobilePalette {
  readonly background: string;
  readonly surface: string;
  readonly subtleSurface: string;
  readonly foreground: string;
  readonly muted: string;
  readonly border: string;
  readonly input: string;
  readonly accent: string;
  readonly accentText: string;
  readonly warningSurface: string;
  readonly warningText: string;
  readonly danger: string;
  readonly success: string;
  readonly userSurface: string;
}

export const MOBILE_PALETTES = {
  light: {
    background: "#f8f8f7",
    surface: "#ffffff",
    subtleSurface: "#ececeb",
    foreground: "#151515",
    muted: "#656566",
    border: "#dededc",
    input: "#ffffff",
    accent: "#151515",
    accentText: "#ffffff",
    warningSurface: "#fff7db",
    warningText: "#704d00",
    danger: "#b42318",
    success: "#269b5f",
    userSurface: "#e1f3e8",
  },
  dark: {
    background: "#111113",
    surface: "#1b1b1f",
    subtleSurface: "#29292e",
    foreground: "#f4f4f5",
    muted: "#a1a1aa",
    border: "#39393f",
    input: "#242429",
    accent: "#f4f4f5",
    accentText: "#18181b",
    warningSurface: "#3b2d08",
    warningText: "#ffd76a",
    danger: "#ff8a80",
    success: "#4ade80",
    userSurface: "#1d3929",
  },
} as const satisfies Record<"light" | "dark", MobilePalette>;

export function useMobilePalette(): MobilePalette {
  return MOBILE_PALETTES[useColorScheme() === "dark" ? "dark" : "light"];
}
