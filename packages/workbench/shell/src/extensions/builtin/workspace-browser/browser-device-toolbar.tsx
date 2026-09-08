"use client";

import {
  ChevronDownIcon,
  GripHorizontalIcon,
  GripVerticalIcon,
  MonitorIcon,
  RotateCwIcon,
  SmartphoneIcon,
  TabletIcon,
  XIcon,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import type { BrowserDevice } from "@workbench/browser-contracts";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Input,
} from "../../../ui";

export type BrowserDevicePreviewScale = "fit" | 1 | 0.75 | 0.5 | 0.25;

const PRESETS = [
  { id: "phone", width: 390, height: 844, mobile: true, icon: SmartphoneIcon },
  { id: "tablet", width: 768, height: 1024, mobile: true, icon: TabletIcon },
  { id: "desktop", width: 1440, height: 900, mobile: false, icon: MonitorIcon },
] as const;
const PREVIEW_SCALES: readonly BrowserDevicePreviewScale[] = ["fit", 1, 0.75, 0.5, 0.25];
const dimension = (value: number) => Math.max(240, Math.min(3840, Math.round(value)));

export interface BrowserDeviceToolbarProps {
  device: BrowserDevice;
  previewScale: BrowserDevicePreviewScale;
  onDeviceChange(device: BrowserDevice): void;
  onPreviewScaleChange(scale: BrowserDevicePreviewScale): void;
  onClose(): void;
  locale: string;
  labels: {
    dimensions: string;
    responsive: string;
    phone: string;
    tablet: string;
    desktop: string;
    width: string;
    height: string;
    rotate: string;
    previewScale: string;
    fit: string;
    close: string;
  };
}

export function BrowserDeviceToolbar({
  device,
  previewScale,
  onDeviceChange,
  onPreviewScaleChange,
  onClose,
  locale,
  labels,
}: BrowserDeviceToolbarProps) {
  const [preset, setPreset] = useState("responsive");
  const [draft, setDraft] = useState({
    width: String(device.width),
    height: String(device.height),
  });
  useEffect(() => {
    setDraft({ width: String(device.width), height: String(device.height) });
    const selected = PRESETS.find((item) => item.id === preset);
    if (
      selected &&
      !(
        selected.mobile === device.mobile &&
        ((selected.width === device.width && selected.height === device.height) ||
          (selected.height === device.width && selected.width === device.height))
      )
    )
      setPreset("responsive");
  }, [device.width, device.height, device.mobile, preset]);
  const commit = (axis: "width" | "height") => {
    const value = draft[axis].trim() === "" ? Number.NaN : Number(draft[axis]);
    const next = Number.isFinite(value) ? dimension(value) : device[axis];
    setDraft((current) => ({ ...current, [axis]: String(next) }));
    if (next !== device[axis]) {
      setPreset("responsive");
      onDeviceChange({ ...device, [axis]: next });
    }
  };
  const number = new Intl.NumberFormat(locale, { useGrouping: false });
  const percent = new Intl.NumberFormat(locale, { style: "percent" });
  const scaleLabel = (value: BrowserDevicePreviewScale) =>
    value === "fit" ? labels.fit : percent.format(value);

  return (
    <div className="flex shrink-0 items-start gap-1 border-b border-border bg-muted/50 px-2 py-1">
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-center gap-1">
        <span className="text-xs text-muted-foreground">{labels.dimensions}</span>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="sm" />}
            aria-label={labels.dimensions}
          >
            {labels[preset as "responsive" | "phone" | "tablet" | "desktop"]}
            <ChevronDownIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56 max-w-[calc(100vw-2rem)]">
            <DropdownMenuRadioGroup
              aria-label={labels.dimensions}
              value={preset}
              onValueChange={(value) => {
                const selected = PRESETS.find((item) => item.id === value);
                if (value !== "responsive" && !selected) return;
                setPreset(value);
                onDeviceChange(
                  selected
                    ? { width: selected.width, height: selected.height, mobile: selected.mobile }
                    : { ...device, mobile: false },
                );
              }}
            >
              <DropdownMenuRadioItem value="responsive">{labels.responsive}</DropdownMenuRadioItem>
              {PRESETS.map(({ id, width, height, icon: Icon }) => (
                <DropdownMenuRadioItem key={id} value={id}>
                  <Icon />
                  <span>{labels[id]}</span>
                  <span className="ms-auto text-xs tabular-nums text-muted-foreground">
                    {number.format(width)} × {number.format(height)}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex items-center gap-1" dir="ltr">
          {(["width", "height"] as const).map((axis, index) => (
            <span key={axis} className="flex items-center gap-1">
              {index ? <span className="text-muted-foreground">×</span> : null}
              <Input
                type="number"
                min={240}
                max={3840}
                step={1}
                className="w-20 text-center tabular-nums"
                aria-label={labels[axis]}
                title={labels[axis]}
                value={draft[axis]}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setDraft((current) => ({ ...current, [axis]: value }));
                }}
                onBlur={() => commit(axis)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commit(axis);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setDraft((current) => ({ ...current, [axis]: String(device[axis]) }));
                  }
                }}
              />
            </span>
          ))}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={labels.rotate}
          title={labels.rotate}
          onClick={() => onDeviceChange({ ...device, width: device.height, height: device.width })}
        >
          <RotateCwIcon />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="sm" />}
            aria-label={labels.previewScale}
            title={labels.previewScale}
          >
            {scaleLabel(previewScale)}
            <ChevronDownIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuRadioGroup
              aria-label={labels.previewScale}
              value={String(previewScale)}
              onValueChange={(value) => {
                const selected = PREVIEW_SCALES.find((item) => String(item) === value);
                if (selected !== undefined) onPreviewScaleChange(selected);
              }}
            >
              {PREVIEW_SCALES.map((value) => (
                <DropdownMenuRadioItem key={value} value={String(value)}>
                  {scaleLabel(value)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={labels.close}
        title={labels.close}
        onClick={onClose}
      >
        <XIcon />
      </Button>
    </div>
  );
}

export interface BrowserDevicePreviewProps {
  device: BrowserDevice;
  previewScale: BrowserDevicePreviewScale;
  onDeviceChange(device: BrowserDevice): void;
  children: ReactNode;
  labels: { preview: string; resizeWidth: string; resizeHeight: string };
}

export function BrowserDevicePreview({
  device,
  previewScale,
  onDeviceChange,
  children,
  labels,
}: BrowserDevicePreviewProps) {
  const container = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  const [dragScale, setDragScale] = useState<number>();
  const drag = useRef<
    | {
        pointerId: number;
        x: number;
        y: number;
        device: BrowserDevice;
        scale: number;
        edge: "left" | "right" | "bottom";
      }
    | undefined
  >(undefined);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const resize = () => {
      const style = window.getComputedStyle(element);
      setAvailable({
        width: Math.max(
          0,
          element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        ),
        height: Math.max(
          0,
          element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
        ),
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => observer.disconnect();
  }, []);
  const scale =
    dragScale ??
    (previewScale === "fit"
      ? Math.min(1, available.width / device.width, available.height / device.height) || 1
      : previewScale);
  const stopDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = undefined;
    setDragScale(undefined);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const resizeByKey = (
    event: KeyboardEvent<HTMLButtonElement>,
    edge: "left" | "right" | "bottom",
  ) => {
    const axis = edge === "bottom" ? "height" : "width";
    const direction =
      edge === "bottom"
        ? { ArrowUp: -1, ArrowDown: 1 }
        : edge === "left"
          ? { ArrowLeft: 1, ArrowRight: -1 }
          : { ArrowLeft: -1, ArrowRight: 1 };
    const delta = direction[event.key as keyof typeof direction];
    if (delta === undefined && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    onDeviceChange({
      ...device,
      [axis]:
        event.key === "Home"
          ? 240
          : event.key === "End"
            ? 3840
            : dimension(device[axis] + delta! * (event.shiftKey ? 10 : 1)),
    });
  };

  return (
    <div
      ref={container}
      role="region"
      aria-label={labels.preview}
      className="relative h-full min-h-0 w-full min-w-0 flex-1 overflow-auto bg-muted/50 p-[var(--control-hit-compact)]"
    >
      <div className="flex min-h-full min-w-full">
        <div
          data-browser-device-preview=""
          className="relative m-auto shrink-0 bg-background shadow-sm ring-1 ring-border"
          style={{ width: device.width * scale, height: device.height * scale }}
        >
          {children}
          {(["left", "right", "bottom"] as const).map((edge) => (
            <Button
              key={edge}
              variant="ghost"
              size="icon-sm"
              role="separator"
              aria-label={edge === "bottom" ? labels.resizeHeight : labels.resizeWidth}
              aria-orientation={edge === "bottom" ? "horizontal" : "vertical"}
              aria-valuemin={240}
              aria-valuemax={3840}
              aria-valuenow={edge === "bottom" ? device.height : device.width}
              className={
                edge === "bottom"
                  ? "absolute -bottom-[var(--control-hit-compact)] left-1/2 -translate-x-1/2 touch-none cursor-ns-resize"
                  : `absolute top-1/2 -translate-y-1/2 touch-none cursor-ew-resize ${edge === "left" ? "-left-[var(--control-hit-compact)]" : "-right-[var(--control-hit-compact)]"}`
              }
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.currentTarget.focus();
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = {
                  pointerId: event.pointerId,
                  x: event.clientX,
                  y: event.clientY,
                  device,
                  scale,
                  edge,
                };
                setDragScale(scale);
              }}
              onPointerMove={(event) => {
                const current = drag.current;
                if (!current || current.pointerId !== event.pointerId) return;
                const axis = current.edge === "bottom" ? "height" : "width";
                const delta =
                  axis === "height" ? event.clientY - current.y : event.clientX - current.x;
                onDeviceChange({
                  ...current.device,
                  [axis]: dimension(
                    current.device[axis] +
                      (delta * 2 * (current.edge === "left" ? -1 : 1)) / current.scale,
                  ),
                });
              }}
              onPointerUp={stopDrag}
              onPointerCancel={stopDrag}
              onLostPointerCapture={stopDrag}
              onKeyDown={(event) => resizeByKey(event, edge)}
            >
              {edge === "bottom" ? <GripHorizontalIcon /> : <GripVerticalIcon />}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
