import {
  isLocalFontFamily,
  type UiFontFamily,
  type CodeFontFamily,
  type LocalFontFamily,
} from "./appearance-preferences";

const SYSTEM_UI_FONT = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const SYSTEM_CODE_FONT = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

function localFontStack(font: LocalFontFamily, fallback: string): string {
  // Quote as one CSS family, including names containing commas, quotes or backslashes.
  const family = font.slice(6).replace(/["\\]/g, "\\$&");
  return `"${family}", ${fallback}`;
}

export function uiFontStack(font: UiFontFamily): string {
  return isLocalFontFamily(font) ? localFontStack(font, SYSTEM_UI_FONT) : SYSTEM_UI_FONT;
}

export function codeFontStack(font: CodeFontFamily): string {
  return isLocalFontFamily(font) ? localFontStack(font, SYSTEM_CODE_FONT) : SYSTEM_CODE_FONT;
}
