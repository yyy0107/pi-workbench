"use client";

import { useRef, type PointerEvent as ReactPointerEvent } from "react";

import { useI18n } from "@/i18n";

import { MIN_RIGHT_WORKSPACE_WIDTH } from "./core/workspace-store";
import { useRightWorkspace } from "./workspace-context";

const KEYBOARD_STEP = 16;

export function WorkspaceResizeHandle({
  width,
  maximum,
}: Readonly<{ width: number; maximum: number }>) {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const start = useRef<{ pointerId: number; x: number; width: number } | undefined>(undefined);

  const resize = (nextWidth: number) => {
    controller.setMaximized(false);
    controller.setWidth(Math.min(maximum, Math.max(MIN_RIGHT_WORKSPACE_WIDTH, nextWidth)));
  };

  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current || start.current.pointerId !== event.pointerId) return;
    start.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={t("rightWorkspace.resize")}
      aria-orientation="vertical"
      aria-valuemin={MIN_RIGHT_WORKSPACE_WIDTH}
      aria-valuemax={Math.round(maximum)}
      aria-valuenow={Math.round(width)}
      className="group absolute inset-y-0 -left-1 z-40 w-2 touch-none cursor-col-resize outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-transparent hover:after:bg-ring focus-visible:after:bg-ring"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        start.current = { pointerId: event.pointerId, x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!start.current || start.current.pointerId !== event.pointerId) return;
        resize(start.current.width + start.current.x - event.clientX);
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") resize(width + KEYBOARD_STEP);
        else if (event.key === "ArrowRight") resize(width - KEYBOARD_STEP);
        else return;
        event.preventDefault();
      }}
    />
  );
}
