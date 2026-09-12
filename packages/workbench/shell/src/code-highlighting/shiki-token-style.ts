import type { CSSProperties } from "react";
import type { ThemedToken } from "shiki/core";

export function tokenStyle(token: ThemedToken): CSSProperties | undefined {
  const raw = token.htmlStyle;
  if (!raw) return token.color ? { color: token.color } : undefined;

  const style = {} as CSSProperties & Record<`--${string}`, string>;
  for (const [property, value] of Object.entries(raw)) {
    if (property.startsWith("--")) {
      style[property as `--${string}`] = value;
      continue;
    }
    if (property === "background-color") style.backgroundColor = value;
    else if (property === "font-style") style.fontStyle = value as CSSProperties["fontStyle"];
    else if (property === "font-weight") style.fontWeight = value as CSSProperties["fontWeight"];
    else if (property === "text-decoration") style.textDecoration = value;
    else if (property === "color") style.color = value;
  }
  return style;
}
