"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Button,
  Switch,
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@workbench/ui";
import { ColorPicker } from "./color-picker";
const RANGE_COMMIT_DELAY_MS = 100;

export function RangeControl({
  label,
  value,
  formatValue,
  renderPreview,
  minimum,
  maximum,
  disabled,
  commitOnInteractionEnd = false,
  onChange,
}: {
  label: string;
  value: number;
  formatValue(value: number): string;
  renderPreview?(value: number): ReactNode;
  minimum: number;
  maximum: number;
  disabled?: boolean;
  commitOnInteractionEnd?: boolean;
  onChange(value: number): void;
}) {
  const [draftValue, setDraftValue] = useState(value);
  const draftValueRef = useRef(value);
  const committedValueRef = useRef(value);
  const interactingRef = useRef(false);
  const commitTimerRef = useRef<number | null>(null);
  const commitFrameRef = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    committedValueRef.current = value;
    if (interactingRef.current) return;

    draftValueRef.current = value;
    setDraftValue(value);
  }, [value]);

  useEffect(
    () => () => {
      if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
      if (commitFrameRef.current !== null) window.cancelAnimationFrame(commitFrameRef.current);
    },
    [],
  );

  const commitDraftValue = () => {
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    if (commitFrameRef.current !== null) {
      window.cancelAnimationFrame(commitFrameRef.current);
      commitFrameRef.current = null;
    }
    if (draftValueRef.current !== committedValueRef.current) {
      committedValueRef.current = draftValueRef.current;
      onChangeRef.current(draftValueRef.current);
    }
  };

  const scheduleDraftCommit = () => {
    if (commitFrameRef.current !== null) window.cancelAnimationFrame(commitFrameRef.current);
    commitFrameRef.current = window.requestAnimationFrame(() => {
      commitFrameRef.current = null;
      commitDraftValue();
    });
  };

  const finishInteraction = (finalValue: number) => {
    draftValueRef.current = finalValue;
    setDraftValue(finalValue);
    interactingRef.current = false;
    if (commitOnInteractionEnd) scheduleDraftCommit();
    else commitDraftValue();
  };

  const updateDraftValue = (nextValue: number) => {
    draftValueRef.current = nextValue;
    setDraftValue(nextValue);

    if (commitOnInteractionEnd) return;

    if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = null;
      if (draftValueRef.current !== committedValueRef.current) {
        committedValueRef.current = draftValueRef.current;
        onChangeRef.current(draftValueRef.current);
      }
    }, RANGE_COMMIT_DELAY_MS);
  };

  const progress = ((draftValue - minimum) / (maximum - minimum)) * 100;
  const draftValueLabel = formatValue(draftValue);

  return (
    <div className="flex h-[var(--form-control-height)] w-full items-center gap-3">
      {renderPreview ? (
        <span
          aria-hidden="true"
          className="flex size-[var(--form-control-height)] shrink-0 items-center justify-center"
        >
          {renderPreview(draftValue)}
        </span>
      ) : null}
      <input
        type="range"
        min={minimum}
        max={maximum}
        step={1}
        value={draftValue}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={draftValueLabel}
        className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-foreground [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground"
        style={{
          background: `linear-gradient(to right, var(--foreground) 0%, var(--foreground) ${progress}%, var(--muted) ${progress}%, var(--muted) 100%)`,
        }}
        onBlur={(event) => finishInteraction(Number(event.currentTarget.value))}
        onChange={(event) => updateDraftValue(Number(event.currentTarget.value))}
        onKeyDown={() => {
          interactingRef.current = true;
        }}
        onKeyUp={(event) => finishInteraction(Number(event.currentTarget.value))}
        onPointerCancel={(event) => finishInteraction(Number(event.currentTarget.value))}
        onPointerDown={() => {
          interactingRef.current = true;
        }}
        onPointerUp={(event) => finishInteraction(Number(event.currentTarget.value))}
      />
      <output className="text-muted-foreground min-w-10 shrink-0 whitespace-nowrap text-right text-xs tabular-nums">
        {draftValueLabel}
      </output>
    </div>
  );
}

export function SwitchControl({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange(checked: boolean): void;
}) {
  return (
    <Switch checked={checked} disabled={disabled} aria-label={label} onCheckedChange={onChange} />
  );
}

const COLOR_COMMIT_DELAY_MS = 50;

export function ColorControl({
  color,
  disabled,
  label,
  onChange,
}: {
  color: string;
  disabled?: boolean;
  label: string;
  onChange(color: string): void;
}) {
  const [draftColor, setDraftColor] = useState(color);
  const draftColorRef = useRef(color);
  const commitTimerRef = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    draftColorRef.current = color;
    setDraftColor(color);
  }, [color]);

  useEffect(
    () => () => {
      if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
    },
    [],
  );

  const commitDraftColor = () => {
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    if (draftColorRef.current !== color) onChangeRef.current(draftColorRef.current);
  };

  const updateDraftColor = (nextColor: string) => {
    draftColorRef.current = nextColor;
    setDraftColor(nextColor);
    if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = null;
      onChangeRef.current(nextColor);
    }, COLOR_COMMIT_DELAY_MS);
  };

  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) commitDraftColor();
      }}
    >
      <PopoverTrigger
        render={<Button type="button" variant="outline" disabled={disabled} aria-label={label} />}
      >
        <span
          aria-hidden="true"
          className="size-[var(--icon-size-lg)] shrink-0 rounded-[var(--input-control-radius)] border border-border"
          style={{ backgroundColor: draftColor }}
        />
        <span className="font-mono text-xs uppercase">{draftColor}</span>
      </PopoverTrigger>
      <PopoverContent align="end">
        <PopoverTitle>{label}</PopoverTitle>
        <ColorPicker
          color={draftColor}
          onChange={updateDraftColor}
          onChangeEnd={commitDraftColor}
        />
      </PopoverContent>
    </Popover>
  );
}
