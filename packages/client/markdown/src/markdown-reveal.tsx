"use client";

import { createContext, useContext, useLayoutEffect, useRef, useState } from "react";

const CHARACTER_INTERVAL_MS = 16;
const MAX_BACKLOG_MS = 160;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function markdownGraphemeEnds(text: string): number[] {
  const ends = Array.from(graphemes.segment(text), (part) => part.index + part.segment.length);
  // A transport delta can end halfway through a surrogate pair.
  if (/[\uD800-\uDBFF]$/.test(text)) ends.pop();
  return ends;
}

/** One frame loop and one bounded timeline for all text leaves in a message. */
export class MarkdownRevealClock {
  private cursor = 0;
  private frame: number | undefined;
  private listeners = new Set<(now: number) => boolean>();

  schedule(count: number, now: number): number[] {
    if (count === 0) return [];
    const start = Math.min(Math.max(this.cursor, now), now + MAX_BACKLOG_MS);
    const step =
      count <= 1
        ? 0
        : Math.min(CHARACTER_INTERVAL_MS, (now + MAX_BACKLOG_MS - start) / (count - 1));
    const times = Array.from({ length: count }, (_, index) => start + index * step);
    this.cursor = times[count - 1] + CHARACTER_INTERVAL_MS;
    return times;
  }

  subscribe(listener: (now: number) => boolean): () => void {
    this.listeners.add(listener);
    this.requestFrame();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.frame !== undefined) {
        cancelAnimationFrame(this.frame);
        this.frame = undefined;
      }
    };
  }

  private requestFrame(): void {
    if (this.frame !== undefined) return;
    this.frame = requestAnimationFrame((now) => {
      this.frame = undefined;
      for (const listener of this.listeners) {
        if (!listener(now)) this.listeners.delete(listener);
      }
      if (this.listeners.size > 0) this.requestFrame();
    });
  }
}

export const MarkdownRevealContext = createContext<MarkdownRevealClock | null>(null);

/** Reveal graphemes in text nodes; completed text stays a single DOM text node. */
export function MarkdownRevealText({ children }: { children?: unknown }) {
  const text = typeof children === "string" ? children : "";
  const clock = useContext(MarkdownRevealContext);
  const [visible, setVisible] = useState(text);
  const state = useRef({ text: "", visibleEnd: 0, pending: [] as { end: number; at: number }[] });

  useLayoutEffect(() => {
    const current = state.current;
    if (!clock) {
      current.text = text;
      current.visibleEnd = text.length;
      current.pending = [];
      setVisible(text);
      return;
    }
    if (!text.startsWith(current.text)) {
      current.text = "";
      current.visibleEnd = 0;
      current.pending = [];
    }
    // Segment the complete value so a combining mark or ZWJ appended by a later
    // transport chunk never becomes a separately revealed character.
    const boundaries = markdownGraphemeEnds(text);
    if (current.visibleEnd > 0)
      current.visibleEnd =
        boundaries.find((end) => end >= current.visibleEnd) ?? current.visibleEnd;
    current.pending = current.pending.flatMap((item, index, items) => {
      const end = boundaries.find((boundary) => boundary >= item.end);
      return end === undefined || end <= current.visibleEnd || items[index + 1]?.end === end
        ? []
        : [{ ...item, end }];
    });
    const scheduledEnd = current.pending.at(-1)?.end ?? current.visibleEnd;
    const ends = boundaries.filter((end) => end > scheduledEnd);
    const times = clock.schedule(ends.length, performance.now());
    current.pending.push(...ends.map((end, index) => ({ end, at: times[index] })));
    current.text = text;
    setVisible(text.slice(0, current.visibleEnd));
    return clock.subscribe((now) => {
      let count = 0;
      while (count < current.pending.length && current.pending[count].at <= now) {
        current.visibleEnd = current.pending[count].end;
        count += 1;
      }
      if (count > 0) {
        current.pending.splice(0, count);
        setVisible(current.text.slice(0, current.visibleEnd));
      }
      return current.pending.length > 0;
    });
  }, [clock, text]);

  return clock ? visible : text;
}
