"use client";

import { useEffect, useRef, type CSSProperties } from "react";

import {
  type BackgroundBlur,
  type CodeFontFamily,
  type CornerRadiusStyle,
  type GlassBlur,
  type UiFontFamily,
} from "../../../appearance";
import { useAppearancePreferences } from "../../../appearance";
import { useMediaQuery } from "../../../hooks/use-media-query";

import { useBackgroundImage } from "./background-image-store";

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
  ubuntuSansMono: "'Ubuntu Sans Mono', 'Ubuntu Mono', ui-monospace, monospace",
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
    "--radius-sm": "0px",
    "--radius-md": "0px",
    "--radius-lg": "0px",
    "--radius-xl": "0px",
    "--radius-2xl": "0px",
    "--radius-3xl": "0px",
    "--radius-4xl": "0px",
    "--aui-border-radius": "0px",
    "--switch-track-radius": "0px",
    "--switch-thumb-radius": "0px",
  },
  subtle: {
    "--radius": "0.25rem",
    "--radius-2xl": "0.5rem",
    "--radius-3xl": "0.625rem",
    "--radius-4xl": "0.875rem",
    "--aui-border-radius": "0.5rem",
    "--switch-track-radius": "0.25rem",
    "--switch-thumb-radius": "0.1875rem",
  },
  compact: {
    "--radius": "0.375rem",
    "--radius-2xl": "0.625rem",
    "--radius-3xl": "0.75rem",
    "--radius-4xl": "1rem",
    "--aui-border-radius": "0.625rem",
    "--switch-track-radius": "0.375rem",
    "--switch-thumb-radius": "0.25rem",
  },
  soft: {
    "--radius": "0.75rem",
    "--radius-2xl": "1.125rem",
    "--radius-3xl": "1.625rem",
    "--radius-4xl": "2.125rem",
    "--aui-border-radius": "1.625rem",
    "--switch-track-radius": "9999px",
    "--switch-thumb-radius": "9999px",
  },
  rounded: {
    "--radius": "0.875rem",
    "--radius-2xl": "1.25rem",
    "--radius-3xl": "1.75rem",
    "--radius-4xl": "2.25rem",
    "--aui-border-radius": "1.75rem",
    "--switch-track-radius": "9999px",
    "--switch-thumb-radius": "9999px",
  },
  "extra-rounded": {
    "--radius": "1.125rem",
    "--radius-2xl": "1.5rem",
    "--radius-3xl": "2rem",
    "--radius-4xl": "2.5rem",
    "--aui-border-radius": "2rem",
    "--switch-track-radius": "9999px",
    "--switch-thumb-radius": "9999px",
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

export function snapshotSurfaceColors(style: Pick<CSSStyleDeclaration, "getPropertyValue">) {
  // Computed styles are live; capture aliases before any source token is overwritten.
  return SURFACE_COLOR_PROPERTIES.map(
    (property) => [property, style.getPropertyValue(property).trim()] as const,
  );
}

export function workbenchAppearanceRoot(element: Element | null): HTMLElement | undefined {
  return element?.closest<HTMLElement>("[data-workbench-shell]") ?? undefined;
}

export function applyWorkbenchDarkMode(root: HTMLElement, dark: boolean): () => void {
  const originalDark = root.classList.contains("dark");
  root.classList.toggle("dark", dark);
  return () => root.classList.toggle("dark", originalDark);
}

export function AppearanceBackground() {
  const preferences = useAppearancePreferences();
  const backgroundImage = useBackgroundImage();
  const appearanceOwnerRef = useRef<HTMLDivElement>(null);
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const dark =
    preferences.colorMode === "dark" || (preferences.colorMode === "system" && systemDark);

  useEffect(() => {
    const root = workbenchAppearanceRoot(appearanceOwnerRef.current);
    if (!root) return;
    return applyWorkbenchDarkMode(root, dark);
  }, [dark]);

  useEffect(() => {
    const root = workbenchAppearanceRoot(appearanceOwnerRef.current);
    if (!root) return;
    const originals = new Map<string, string>();
    const originalAppearance = root.getAttribute("data-workbench-appearance");
    const originalCornerRadius = root.getAttribute("data-workbench-corner-radius");
    const originalBorderStyle = root.getAttribute("data-workbench-border-style");
    const originalBackdrop = root.getAttribute("data-workbench-backdrop");

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
      "--workbench-ui-font-weight": String(preferences.uiFontWeight),
      "--workbench-content-font":
        preferences.contentFont === "inherit"
          ? "var(--workbench-theme-ui-font)"
          : UI_FONT_STACKS[preferences.contentFont],
      "--workbench-content-font-weight": String(
        preferences.contentFont === "inherit"
          ? preferences.uiFontWeight
          : preferences.contentFontWeight,
      ),
      "--workbench-code-font-weight": String(preferences.codeFontWeight),
      "--composer-flow-display": preferences.composerAnimationEnabled ? "block" : "none",
      "--composer-flow-intensity": String(preferences.composerAnimationIntensity / 50),
    } as const;

    for (const [property, value] of Object.entries(themeProperties)) {
      setProperty(root, property, value, originals);
    }

    root.setAttribute("data-workbench-appearance", "");
    root.setAttribute("data-workbench-corner-radius", preferences.cornerRadius);
    if (preferences.customBackground) {
      setProperty(root, "--workbench-canvas-background", preferences.backgroundColor, originals);
    }
    const computedStyle = getComputedStyle(root);

    const hasBackdrop = preferences.customBackground || backgroundImage.url !== null;
    if (hasBackdrop) {
      root.setAttribute("data-workbench-backdrop", "");
      const backgroundBase = computedStyle.getPropertyValue("--background").trim();
      const cardBase = computedStyle.getPropertyValue("--card").trim() || backgroundBase;
      const popoverBase = computedStyle.getPropertyValue("--popover").trim() || cardBase;
      const themeSidebarBase = computedStyle.getPropertyValue("--sidebar").trim() || cardBase;
      const shouldSyncSurfaceColors = preferences.customBackground && preferences.syncSurfaceColors;
      const resolveSurfaceColor = (themeColor: string) =>
        shouldSyncSurfaceColors
          ? `color-mix(in srgb, ${preferences.backgroundColor} ${preferences.surfaceColorBlend}%, ${themeColor})`
          : themeColor;
      const surfaceBase = resolveSurfaceColor(cardBase);
      const sidebarBase = resolveSurfaceColor(themeSidebarBase);
      const floatingSurfaceBase = resolveSurfaceColor(popoverBase);

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

      for (const [property, themeBase] of snapshotSurfaceColors(computedStyle)) {
        const base = resolveSurfaceColor(themeBase);
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
      if (originalCornerRadius === null) root.removeAttribute("data-workbench-corner-radius");
      else root.setAttribute("data-workbench-corner-radius", originalCornerRadius);
      if (originalBorderStyle === null) root.removeAttribute("data-workbench-border-style");
      else root.setAttribute("data-workbench-border-style", originalBorderStyle);
      if (originalBackdrop === null) root.removeAttribute("data-workbench-backdrop");
      else root.setAttribute("data-workbench-backdrop", originalBackdrop);

      for (const [property, value] of originals) {
        if (value) root.style.setProperty(property, value);
        else root.style.removeProperty(property);
      }
    };
  }, [backgroundImage.url, preferences, dark]);

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
    <div
      ref={appearanceOwnerRef}
      aria-hidden="true"
      className="absolute inset-0"
      style={backgroundStyle}
    />
  );
}
