"use client";

import { useEffect, type CSSProperties } from "react";

import {
  APPEARANCE_STORAGE_KEY,
  type BackgroundBlur,
  type CodeFontFamily,
  type CornerRadiusStyle,
  type GlassBlur,
  type UiFontFamily,
} from "./appearance-preferences";
import { appearanceStore, useAppearancePreferences } from "./appearance-store";
import { useBackgroundImage } from "./background-image-store";

const APPEARANCE_OVERRIDES = `
:root[data-workbench-border-style] :where(*, *::before, *::after) {
  border-style: var(--workbench-border-style) !important;
}

:root[data-workbench-appearance] {
  --background: var(--workbench-theme-background);
  --foreground: var(--workbench-theme-foreground);
  --card: var(--workbench-theme-background);
  --card-foreground: var(--workbench-theme-foreground);
  --popover: var(--workbench-theme-background);
  --popover-foreground: var(--workbench-theme-foreground);
  --sidebar: var(--workbench-theme-background);
  --sidebar-foreground: var(--workbench-theme-foreground);
  --primary: var(--workbench-theme-accent);
  --primary-foreground: var(--workbench-theme-background);
  --sidebar-primary: var(--workbench-theme-accent);
  --sidebar-primary-foreground: var(--workbench-theme-background);
  --ring: var(--workbench-theme-accent);
  --muted: color-mix(in srgb, var(--workbench-theme-background) 92%, var(--workbench-theme-foreground));
  --muted-foreground: color-mix(in srgb, var(--workbench-theme-foreground) 62%, var(--workbench-theme-background));
  --secondary: var(--muted);
  --secondary-foreground: var(--workbench-theme-foreground);
  --accent: var(--muted);
  --accent-foreground: var(--workbench-theme-foreground);
  --sidebar-accent: var(--muted);
  --sidebar-accent-foreground: var(--workbench-theme-foreground);
  --border: color-mix(in srgb, var(--workbench-theme-background) 92%, var(--workbench-theme-foreground));
  --input: color-mix(in srgb, var(--workbench-theme-background) 82%, var(--workbench-theme-foreground));
  --sidebar-border: var(--border);
  --aui-accent: var(--workbench-theme-accent);
  --aui-accent-foreground: var(--workbench-theme-background);
  --aui-background: var(--workbench-theme-background);
  --aui-foreground: var(--workbench-theme-foreground);
  --aui-muted-foreground: var(--muted-foreground);
  --aui-border: var(--border);
  --aui-user-message: var(--muted);
  --aui-composer: var(--muted);
  --aui-font-family: var(--workbench-theme-ui-font);
  --font-sans: var(--workbench-theme-ui-font);
  --font-mono: var(--workbench-theme-code-font);
  font-size: var(--workbench-ui-font-size);
}

:root[data-workbench-appearance]:not(.dark) {
  --workbench-theme-accent: var(--workbench-light-accent);
  --workbench-theme-background: var(--workbench-light-background);
  --workbench-theme-foreground: var(--workbench-light-foreground);
  --workbench-theme-ui-font: var(--workbench-light-ui-font);
  --workbench-theme-code-font: var(--workbench-light-code-font);
  --workbench-theme-contrast: var(--workbench-light-contrast);
}

:root[data-workbench-appearance].dark {
  --workbench-theme-accent: var(--workbench-dark-accent);
  --workbench-theme-background: var(--workbench-dark-background);
  --workbench-theme-foreground: var(--workbench-dark-foreground);
  --workbench-theme-ui-font: var(--workbench-dark-ui-font);
  --workbench-theme-code-font: var(--workbench-dark-code-font);
  --workbench-theme-contrast: var(--workbench-dark-contrast);
}

:root[data-workbench-appearance] body {
  font-family: var(--workbench-theme-ui-font);
}

:root[data-workbench-appearance] :where(code, pre, kbd, samp) {
  font-family: var(--workbench-theme-code-font);
  font-size: var(--workbench-code-font-size);
}

:root[data-workbench-appearance] [data-workbench-surface="shell"] {
  filter: contrast(var(--workbench-theme-contrast));
}

:root[data-workbench-pointer-cursor] :where(
  a[href],
  button,
  summary,
  select,
  [role="button"],
  [role="menuitem"],
  [role="option"],
  [role="tab"],
  input[type="checkbox"],
  input[type="radio"],
  input[type="range"],
  label:has(input[type="checkbox"], input[type="radio"], input[type="range"])
) {
  cursor: pointer !important;
}

:root[data-workbench-reduce-motion],
:root[data-workbench-reduce-motion] :where(*, *::before, *::after) {
  scroll-behavior: auto !important;
}

:root[data-workbench-reduce-motion] :where(*, *::before, *::after) {
  animation-duration: 0.01ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.01ms !important;
}

:root[data-workbench-hide-diff-markers] [data-diff-marker] {
  display: none;
}

:root[data-workbench-backdrop] [data-workbench-surface="shell"],
:root[data-workbench-backdrop] [data-workbench-surface="main"],
:root[data-workbench-backdrop] [data-workbench-surface="thread"],
:root[data-workbench-backdrop] [data-workbench-composer-dock] {
  background-color: transparent !important;
  backdrop-filter: none;
}

:root[data-workbench-backdrop] :where(
  [data-workbench-surface="header"],
  [data-workbench-surface="panel"],
  [data-workbench-surface="statusbar"],
  [data-slot="workbench-composer-card"],
  [data-workbench-glass-surface],
  [data-workbench-selection-surface]:hover,
  [data-workbench-selection-surface]:focus-visible,
  [data-workbench-selection-surface]:focus-within,
  [data-workbench-selection-surface][data-active]:not([data-workbench-selection-mode="foreground"]),
  [data-workbench-selection-surface][data-state="active"]:not([data-workbench-selection-mode="foreground"]),
  [data-workbench-selection-surface][aria-current="page"]:not([data-workbench-selection-mode="foreground"]),
  [data-workbench-selection-surface][aria-selected="true"]:not([data-workbench-selection-mode="foreground"])
) {
  background-color: color-mix(
    in srgb,
    var(--workbench-surface-base) var(--workbench-surface-opacity),
    transparent
  ) !important;
  backdrop-filter: blur(var(--workbench-surface-blur));
}

:root[data-workbench-backdrop]
  [data-workbench-surface="sidebar"]
  [data-slot="sidebar-inner"] {
  background-color: color-mix(
    in srgb,
    var(--workbench-sidebar-surface-base) var(--workbench-surface-opacity),
    transparent
  ) !important;
  backdrop-filter: blur(var(--workbench-surface-blur));
}

:root[data-workbench-backdrop] :where(
  [data-slot="dialog-content"],
  [data-slot="dropdown-menu-content"],
  [data-slot="popover-content"],
  [data-slot="sheet-content"]
) {
  background-color: color-mix(
    in srgb,
    var(--workbench-floating-surface-base) var(--workbench-floating-surface-opacity),
    transparent
  ) !important;
  backdrop-filter: blur(var(--workbench-surface-blur));
}
`;

const BACKGROUND_BLUR_STYLES: Record<BackgroundBlur, { image: string; scale: string }> = {
  none: { image: "0px", scale: "1" },
  soft: { image: "2px", scale: "1.01" },
  medium: { image: "6px", scale: "1.03" },
  strong: { image: "12px", scale: "1.06" },
};

const GLASS_BLUR_STYLES: Record<GlassBlur, string> = {
  none: "0px",
  soft: "6px",
  medium: "12px",
  strong: "20px",
};

const UI_FONT_STACKS: Record<UiFontFamily, string> = {
  system: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  geist: "var(--font-geist-sans), system-ui, sans-serif",
  serif: "ui-serif, Georgia, Cambria, 'Times New Roman', serif",
  rounded: "ui-rounded, 'SF Pro Rounded', system-ui, sans-serif",
};

const CODE_FONT_STACKS: Record<CodeFontFamily, string> = {
  geistMono: "var(--font-geist-mono), ui-monospace, monospace",
  systemMono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  compactMono: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
  jetBrainsMono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  firaCode: "'Fira Code', 'Fira Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  cascadiaCode: "'Cascadia Code', 'Cascadia Mono', Consolas, ui-monospace, monospace",
  sourceCodePro: "'Source Code Pro', 'Liberation Mono', ui-monospace, monospace",
  ibmPlexMono: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  menlo: "Menlo, Monaco, 'Courier New', monospace",
  consolas: "Consolas, 'Courier New', monospace",
  liberationMono: "'Liberation Mono', 'DejaVu Sans Mono', ui-monospace, monospace",
  ubuntuMono: "'Ubuntu Mono', 'Liberation Mono', ui-monospace, monospace",
};

const SURFACE_COLOR_PROPERTIES = [
  "--card",
  "--popover",
  "--sidebar",
  "--muted",
  "--accent",
  "--secondary",
  "--sidebar-accent",
  "--aui-background",
  "--aui-composer",
  "--aui-user-message",
] as const;

const THEME_SURFACE_COLOR_WEIGHT = 75;
const MIN_FLOATING_SURFACE_OPACITY = 88;

const BORDER_COLOR_PROPERTIES = [
  "--border",
  "--input",
  "--sidebar-border",
  "--aui-border",
] as const;

const RADIUS_PROPERTIES: Record<Exclude<CornerRadiusStyle, "default">, Record<string, string>> = {
  square: {
    "--radius": "0px",
    "--radius-2xl": "0px",
    "--radius-3xl": "0px",
    "--radius-4xl": "0px",
    "--aui-border-radius": "0px",
  },
  compact: {
    "--radius": "0.375rem",
    "--radius-2xl": "0.625rem",
    "--radius-3xl": "0.75rem",
    "--radius-4xl": "1rem",
    "--aui-border-radius": "0.625rem",
  },
  rounded: {
    "--radius": "0.875rem",
    "--radius-2xl": "1.25rem",
    "--radius-3xl": "1.5rem",
    "--radius-4xl": "2rem",
    "--aui-border-radius": "1.5rem",
  },
};

function rememberProperty(
  root: HTMLElement,
  property: string,
  originals: Map<string, string>,
): void {
  if (!originals.has(property)) originals.set(property, root.style.getPropertyValue(property));
}

function setProperty(
  root: HTMLElement,
  property: string,
  value: string,
  originals: Map<string, string>,
): void {
  rememberProperty(root, property, originals);
  root.style.setProperty(property, value);
}

function blendWithCustomBackground(themeColor: string, backgroundColor: string): string {
  return `color-mix(in srgb, ${themeColor} ${THEME_SURFACE_COLOR_WEIGHT}%, ${backgroundColor})`;
}

export function AppearanceBackground() {
  const preferences = useAppearancePreferences();
  const backgroundImage = useBackgroundImage();

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === APPEARANCE_STORAGE_KEY) appearanceStore.sync(event.newValue);
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const originalDark = root.classList.contains("dark");
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyColorMode = () => {
      const dark =
        preferences.colorMode === "dark" || (preferences.colorMode === "system" && media.matches);
      root.classList.toggle("dark", dark);
    };

    applyColorMode();
    if (preferences.colorMode === "system") media.addEventListener("change", applyColorMode);

    return () => {
      media.removeEventListener("change", applyColorMode);
      root.classList.toggle("dark", originalDark);
    };
  }, [preferences.colorMode]);

  useEffect(() => {
    const root = document.documentElement;
    const originals = new Map<string, string>();
    const originalAppearance = root.getAttribute("data-workbench-appearance");
    const originalBorderStyle = root.getAttribute("data-workbench-border-style");
    const originalBackdrop = root.getAttribute("data-workbench-backdrop");
    const originalPointerCursor = root.getAttribute("data-workbench-pointer-cursor");
    const originalReduceMotion = root.getAttribute("data-workbench-reduce-motion");
    const originalHideDiffMarkers = root.getAttribute("data-workbench-hide-diff-markers");

    const themeProperties = {
      "--workbench-light-accent": preferences.lightAccentColor,
      "--workbench-light-background": preferences.lightBackgroundColor,
      "--workbench-light-foreground": preferences.lightForegroundColor,
      "--workbench-light-ui-font": UI_FONT_STACKS[preferences.uiFont],
      "--workbench-light-code-font": CODE_FONT_STACKS[preferences.codeFont],
      "--workbench-light-contrast": `${preferences.lightContrast}%`,
      "--workbench-dark-accent": preferences.darkAccentColor,
      "--workbench-dark-background": preferences.darkBackgroundColor,
      "--workbench-dark-foreground": preferences.darkForegroundColor,
      "--workbench-dark-ui-font": UI_FONT_STACKS[preferences.uiFont],
      "--workbench-dark-code-font": CODE_FONT_STACKS[preferences.codeFont],
      "--workbench-dark-contrast": `${preferences.darkContrast}%`,
      "--workbench-ui-font-size": `${preferences.uiFontSize}px`,
      "--workbench-code-font-size": `${preferences.codeFontSize}px`,
    } as const;

    for (const [property, value] of Object.entries(themeProperties)) {
      setProperty(root, property, value, originals);
    }

    root.setAttribute("data-workbench-appearance", "");
    root.toggleAttribute("data-workbench-pointer-cursor", preferences.usePointerCursor);
    root.toggleAttribute("data-workbench-reduce-motion", preferences.reduceMotion);
    root.toggleAttribute("data-workbench-hide-diff-markers", !preferences.showDiffMarkers);
    const computedStyle = getComputedStyle(root);

    const hasBackdrop = preferences.customBackground || backgroundImage.url !== null;
    if (hasBackdrop) {
      root.setAttribute("data-workbench-backdrop", "");
      const backgroundBase = computedStyle.getPropertyValue("--background").trim();
      const cardBase = computedStyle.getPropertyValue("--card").trim() || backgroundBase;
      const popoverBase = computedStyle.getPropertyValue("--popover").trim() || cardBase;
      const themeSidebarBase = computedStyle.getPropertyValue("--sidebar").trim() || cardBase;
      const shouldBlendSurfaceColors =
        preferences.customBackground && preferences.syncSurfaceColors;
      const surfaceBase = shouldBlendSurfaceColors
        ? blendWithCustomBackground(cardBase, preferences.backgroundColor)
        : cardBase;
      const sidebarBase = shouldBlendSurfaceColors
        ? blendWithCustomBackground(themeSidebarBase, preferences.backgroundColor)
        : themeSidebarBase;
      const floatingSurfaceBase = shouldBlendSurfaceColors
        ? blendWithCustomBackground(popoverBase, preferences.backgroundColor)
        : popoverBase;

      setProperty(root, "--workbench-surface-base", surfaceBase, originals);
      setProperty(root, "--workbench-sidebar-surface-base", sidebarBase, originals);
      setProperty(root, "--workbench-floating-surface-base", floatingSurfaceBase, originals);
      setProperty(root, "--workbench-surface-opacity", `${preferences.surfaceOpacity}%`, originals);
      setProperty(
        root,
        "--workbench-floating-surface-opacity",
        `${Math.max(preferences.surfaceOpacity, MIN_FLOATING_SURFACE_OPACITY)}%`,
        originals,
      );
      setProperty(
        root,
        "--workbench-surface-blur",
        GLASS_BLUR_STYLES[preferences.glassBlur],
        originals,
      );

      for (const property of SURFACE_COLOR_PROPERTIES) {
        const themeBase = computedStyle.getPropertyValue(property).trim();
        const base = shouldBlendSurfaceColors
          ? blendWithCustomBackground(themeBase, preferences.backgroundColor)
          : themeBase;
        if (base) {
          setProperty(
            root,
            property,
            `color-mix(in srgb, ${base} ${preferences.surfaceOpacity}%, transparent)`,
            originals,
          );
        }
      }
    }

    if (preferences.customBorderColor) {
      for (const property of BORDER_COLOR_PROPERTIES) {
        setProperty(root, property, preferences.borderColor, originals);
      }
    }

    if (preferences.borderStyle !== "default") {
      setProperty(root, "--workbench-border-style", preferences.borderStyle, originals);
      root.setAttribute("data-workbench-border-style", preferences.borderStyle);
    }

    if (preferences.cornerRadius !== "default") {
      for (const [property, value] of Object.entries(RADIUS_PROPERTIES[preferences.cornerRadius])) {
        setProperty(root, property, value, originals);
      }
    }

    return () => {
      if (originalAppearance === null) root.removeAttribute("data-workbench-appearance");
      else root.setAttribute("data-workbench-appearance", originalAppearance);
      if (originalBorderStyle === null) root.removeAttribute("data-workbench-border-style");
      else root.setAttribute("data-workbench-border-style", originalBorderStyle);
      if (originalBackdrop === null) root.removeAttribute("data-workbench-backdrop");
      else root.setAttribute("data-workbench-backdrop", originalBackdrop);
      if (originalPointerCursor === null) root.removeAttribute("data-workbench-pointer-cursor");
      else root.setAttribute("data-workbench-pointer-cursor", originalPointerCursor);
      if (originalReduceMotion === null) root.removeAttribute("data-workbench-reduce-motion");
      else root.setAttribute("data-workbench-reduce-motion", originalReduceMotion);
      if (originalHideDiffMarkers === null)
        root.removeAttribute("data-workbench-hide-diff-markers");
      else root.setAttribute("data-workbench-hide-diff-markers", originalHideDiffMarkers);

      for (const [property, value] of originals) {
        if (value) root.style.setProperty(property, value);
        else root.style.removeProperty(property);
      }
    };
  }, [backgroundImage.url, preferences]);

  const blur = BACKGROUND_BLUR_STYLES[preferences.backgroundBlur];
  const backgroundStyle = {
    backgroundColor: preferences.customBackground ? preferences.backgroundColor : undefined,
    backgroundImage: backgroundImage.url ? `url("${backgroundImage.url}")` : undefined,
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    backgroundSize: "cover",
    filter: backgroundImage.url ? `blur(${blur.image})` : undefined,
    transform: backgroundImage.url ? `scale(${blur.scale})` : undefined,
  } satisfies CSSProperties;

  return (
    <>
      <style>{APPEARANCE_OVERRIDES}</style>
      <div aria-hidden="true" className="absolute inset-0" style={backgroundStyle} />
    </>
  );
}
