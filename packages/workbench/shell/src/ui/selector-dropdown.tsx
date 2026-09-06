"use client";

import * as React from "react";

import { DropdownMenuContent } from "./dropdown-menu";
import { cn } from "../utils";

const SELECTOR_DROPDOWN_WIDTH_REM = 18;
const SELECTOR_DROPDOWN_VIEWPORT_GUTTER_REM = 8;

export const SELECTOR_DROPDOWN_REVEAL_DURATION_MS = 200;

interface SelectorDropdownTriggerSize {
  width: number;
  maxWidth: number;
}

interface AnimatedSelectorDropdownOptions {
  getOpenWidth?: (trigger: HTMLButtonElement) => number;
}

export function getSelectorDropdownWidth(): number {
  const parsedRootFontSize = Number.parseFloat(
    window.getComputedStyle(document.documentElement).fontSize,
  );
  const rootFontSize = Number.isFinite(parsedRootFontSize) ? parsedRootFontSize : 16;

  return Math.max(
    0,
    Math.min(
      SELECTOR_DROPDOWN_WIDTH_REM * rootFontSize,
      window.innerWidth - SELECTOR_DROPDOWN_VIEWPORT_GUTTER_REM * rootFontSize,
    ),
  );
}

function cssTimeMilliseconds(value: string): number {
  const normalized = value.trim();
  if (normalized.endsWith("ms")) return Number.parseFloat(normalized) || 0;
  if (normalized.endsWith("s")) return (Number.parseFloat(normalized) || 0) * 1000;
  return 0;
}

function widthTransitionMilliseconds(element: HTMLElement): number {
  const styles = window.getComputedStyle(element);
  const properties = styles.transitionProperty.split(",").map((value) => value.trim());
  const durations = styles.transitionDuration.split(",").map(cssTimeMilliseconds);
  const delays = styles.transitionDelay.split(",").map(cssTimeMilliseconds);

  return properties.reduce((longest, property, index) => {
    if (property !== "all" && property !== "width") return longest;
    const duration = durations[index % durations.length] ?? 0;
    const delay = delays[index % delays.length] ?? 0;
    return Math.max(longest, duration + delay);
  }, 0);
}

export function useAnimatedSelectorDropdown({
  getOpenWidth = getSelectorDropdownWidth,
}: AnimatedSelectorDropdownOptions = {}) {
  const [triggerSize, setTriggerSize] = React.useState<SelectorDropdownTriggerSize>();
  const [contentWidth, setContentWidth] = React.useState<number>();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [menuRevealed, setMenuRevealed] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const closedTriggerWidthRef = React.useRef<number | undefined>(undefined);
  const triggerAnimationFrameRef = React.useRef<number | undefined>(undefined);
  const menuRevealTimeoutRef = React.useRef<number | undefined>(undefined);
  const menuOpenRef = React.useRef(false);

  const cancelScheduledReveal = React.useCallback(() => {
    if (triggerAnimationFrameRef.current !== undefined) {
      window.cancelAnimationFrame(triggerAnimationFrameRef.current);
      triggerAnimationFrameRef.current = undefined;
    }
    if (menuRevealTimeoutRef.current !== undefined) {
      window.clearTimeout(menuRevealTimeoutRef.current);
      menuRevealTimeoutRef.current = undefined;
    }
  }, []);

  // Callback changes must not cancel an opening menu's scheduled reveal.
  React.useEffect(() => cancelScheduledReveal, [cancelScheduledReveal]);

  React.useEffect(() => {
    const handleResize = () => {
      const trigger = triggerRef.current;
      if (!menuOpenRef.current || !trigger) return;
      const width = getOpenWidth(trigger);
      setTriggerSize({ width, maxWidth: width });
      setContentWidth(width);
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [getOpenWidth]);

  const onOpenChange = React.useCallback(
    (open: boolean) => {
      cancelScheduledReveal();

      const trigger = triggerRef.current;
      menuOpenRef.current = open;
      setMenuOpen(open);
      if (open) setMenuRevealed(false);
      if (!trigger) {
        setMenuRevealed(true);
        return;
      }

      if (open) {
        const closedWidth = trigger.getBoundingClientRect().width;
        const openWidth = getOpenWidth(trigger);
        closedTriggerWidthRef.current = closedWidth;
        setContentWidth(openWidth);
        setTriggerSize({ width: closedWidth, maxWidth: Math.max(closedWidth, openWidth) });
        triggerAnimationFrameRef.current = window.requestAnimationFrame(() => {
          if (!menuOpenRef.current) return;
          triggerAnimationFrameRef.current = window.requestAnimationFrame(() => {
            triggerAnimationFrameRef.current = undefined;
            if (!menuOpenRef.current) return;
            setTriggerSize({ width: openWidth, maxWidth: openWidth });

            const revealAfter = Math.max(
              0,
              widthTransitionMilliseconds(trigger) - SELECTOR_DROPDOWN_REVEAL_DURATION_MS,
            );
            menuRevealTimeoutRef.current = window.setTimeout(() => {
              menuRevealTimeoutRef.current = undefined;
              if (!menuOpenRef.current) return;
              setMenuRevealed(true);
            }, revealAfter);
          });
        });
        return;
      }

      const closedWidth = closedTriggerWidthRef.current;
      if (closedWidth === undefined) {
        setTriggerSize(undefined);
        return;
      }
      setTriggerSize({
        width: closedWidth,
        maxWidth: Math.max(trigger.getBoundingClientRect().width, closedWidth),
      });
    },
    [cancelScheduledReveal, getOpenWidth],
  );

  const onTriggerTransitionEnd = React.useCallback(
    (event: React.TransitionEvent<HTMLButtonElement>) => {
      if (
        event.currentTarget === event.target &&
        event.propertyName === "width" &&
        !menuOpenRef.current
      ) {
        setTriggerSize(undefined);
        setContentWidth(undefined);
      }
    },
    [],
  );

  return {
    contentStyle: {
      ...(contentWidth === undefined ? {} : { width: contentWidth, maxWidth: contentWidth }),
      animationPlayState: !menuOpen || menuRevealed ? "running" : "paused",
    } satisfies React.CSSProperties,
    menuOpen,
    onOpenChange,
    onTriggerTransitionEnd,
    triggerRef,
    triggerStyle: {
      ...triggerSize,
      transitionDuration: menuOpen ? "400ms, 200ms, 200ms" : "240ms, 200ms, 200ms",
    } satisfies React.CSSProperties,
  };
}

export function SelectorDropdownContent({
  className,
  style,
  ...props
}: React.ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      className={cn(
        "w-72 min-w-0 max-w-[calc(100vw-8rem)] data-open:zoom-in-100 data-closed:zoom-out-100",
        className,
      )}
      style={{
        animationDuration: `${SELECTOR_DROPDOWN_REVEAL_DURATION_MS}ms`,
        animationDelay: "0ms",
        animationTimingFunction: "cubic-bezier(0, 0, 0.2, 1)",
        animationFillMode: "both",
        ...style,
      }}
      {...props}
    />
  );
}
