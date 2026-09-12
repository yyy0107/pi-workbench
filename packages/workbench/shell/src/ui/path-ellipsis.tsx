import type { ComponentProps, CSSProperties } from "react";

import { cn } from "../utils";

const DEFAULT_PREFIX_CHARS = 0;
const DEFAULT_SUFFIX_CHARS = 56;

export interface PathEllipsisProps extends Omit<ComponentProps<"span">, "children"> {
  /** The complete path shown to assistive technology and in the native tooltip. */
  text: string;
  /** Filename mode uses available width, preserving the basename and dimming directories. */
  mode?: "characters" | "filename";
  /** CSS width for the rendered path. */
  width?: CSSProperties["width"];
  /** Number of characters to keep from the beginning when truncation is needed. */
  prefixChars?: number;
  /** Number of characters to keep from the end when truncation is needed. */
  suffixChars?: number;
}

function characterCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function pathEllipsisParts(
  text: string,
  prefixChars = DEFAULT_PREFIX_CHARS,
  suffixChars = DEFAULT_SUFFIX_CHARS,
): { prefix: string; suffix: string; truncated: boolean } {
  const characters = Array.from(text);
  const prefixLength = characterCount(prefixChars);
  const suffixLength = characterCount(suffixChars);

  if (characters.length <= prefixLength + suffixLength) {
    return { prefix: text, suffix: "", truncated: false };
  }

  return {
    prefix: characters.slice(0, prefixLength).join(""),
    suffix: suffixLength > 0 ? characters.slice(-suffixLength).join("") : "",
    truncated: true,
  };
}

/**
 * Keeps the useful ends of a long path while leaving the truncation policy
 * independent from the element's available width.
 */
export function formatPathEllipsis(
  text: string,
  prefixChars = DEFAULT_PREFIX_CHARS,
  suffixChars = DEFAULT_SUFFIX_CHARS,
): string {
  const parts = pathEllipsisParts(text, prefixChars, suffixChars);
  return parts.truncated ? `${parts.prefix}…${parts.suffix}` : text;
}

/** Displays a path with a configurable middle ellipsis and full-text metadata. */
export function PathEllipsis({
  className,
  text,
  title,
  style,
  width,
  mode = "characters",
  prefixChars = DEFAULT_PREFIX_CHARS,
  suffixChars = DEFAULT_SUFFIX_CHARS,
  ...props
}: PathEllipsisProps) {
  const parts = pathEllipsisParts(text, prefixChars, suffixChars);
  const separator = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\")) + 1;
  const directory = text.slice(0, separator);
  const basename = text.slice(separator);
  return (
    <span
      {...props}
      data-slot="path-ellipsis"
      aria-label={props["aria-label"] ?? text}
      title={title ?? text}
      style={{
        textAlign: "left",
        ...(parts.truncated ? {} : { textOverflow: "ellipsis" }),
        ...style,
        ...(width === undefined ? undefined : { width }),
      }}
      className={cn(
        "inline-flex min-w-0 max-w-full items-center overflow-hidden whitespace-nowrap",
        className,
      )}
    >
      {mode === "filename" ? (
        <>
          {directory && (
            <span
              className="min-w-0 shrink overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground"
              style={{ direction: "rtl", textAlign: "left" }}
            >
              <bdi dir="ltr">{directory}</bdi>
            </span>
          )}
          <span className="shrink-0 text-foreground" dir="ltr">
            {basename}
          </span>
        </>
      ) : parts.truncated ? (
        <>
          {parts.prefix ? (
            <span className="min-w-0 overflow-hidden whitespace-nowrap">{parts.prefix}</span>
          ) : null}
          <span aria-hidden="true" className="shrink-0">
            …
          </span>
          <span
            className="min-w-0 flex-1 overflow-hidden whitespace-nowrap"
            style={{ direction: "rtl", textAlign: "left", textOverflow: "clip" }}
          >
            <span className="inline-block" style={{ direction: "ltr" }}>
              {parts.suffix}
            </span>
          </span>
        </>
      ) : (
        text
      )}
    </span>
  );
}
