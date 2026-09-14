"use client";

import { useEffect } from "react";

/** Install once per renderer; capture also covers nested scrollers and portaled panels. */
export function useScrollbarPosition(): void {
  useEffect(() => {
    const attribute = "data-scrollbar-scrolled-y";
    const update = (element: Element) => {
      const scrolled = element.scrollTop > 0;
      if (element.hasAttribute(attribute) !== scrolled) {
        element.toggleAttribute(attribute, scrolled);
      }
    };
    const onScroll = (event: Event) => {
      const element = event.target === document ? document.scrollingElement : event.target;
      if (element instanceof Element) update(element);
    };

    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    // Include positions restored before this effect mounts. New scrollers start at the top;
    // subsequent wheel, keyboard, drag and programmatic scrolling all emit scroll events.
    document.querySelectorAll("*").forEach(update);

    return () => document.removeEventListener("scroll", onScroll, true);
  }, []);
}
