"use client";

import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import { CircleCheckIcon, CircleXIcon, InfoIcon, TriangleAlertIcon, XIcon } from "lucide-react";

import { cn } from "../utils";
import { Button } from "./button";
import { useWorkbenchPortalContainer } from "./workbench-portal-container";

const toastAppearance = {
  error: {
    icon: CircleXIcon,
    className:
      "border-danger/25 bg-[color-mix(in_oklab,var(--danger)_8%,var(--popover))] text-[color-mix(in_oklab,var(--danger)_95%,var(--foreground))] dark:text-danger-foreground",
  },
  success: {
    icon: CircleCheckIcon,
    className:
      "border-success/20 bg-[color-mix(in_oklab,var(--success)_8%,var(--popover))] text-[color-mix(in_oklab,var(--success)_80%,var(--foreground))] dark:text-success-foreground",
  },
  warning: {
    icon: TriangleAlertIcon,
    className:
      "border-warning/25 bg-[color-mix(in_oklab,var(--warning)_6%,var(--popover))] text-warning-foreground",
  },
  info: {
    icon: InfoIcon,
    className:
      "border-info/20 bg-[color-mix(in_oklab,var(--info)_6%,var(--popover))] text-info-foreground",
  },
} as const;

export const ToastProvider = ToastPrimitive.Provider;
export const useToastManager = ToastPrimitive.useToastManager;

/** A compact event notification; Base UI owns dismissal, focus, timers, and announcements. */
export function Toast({
  toast,
  closeLabel,
}: {
  toast: ToastPrimitive.Root.Props["toast"];
  closeLabel: string;
}) {
  const tone =
    toast.type === "error" || toast.type === "success" || toast.type === "warning"
      ? toast.type
      : "info";
  const { icon: Icon, className } = toastAppearance[tone];

  // The transparent ::before bridges hover gaps; keep the root's overflow visible.
  return (
    <ToastPrimitive.Root
      toast={toast}
      swipeDirection={[]}
      data-slot="toast"
      data-tone={tone}
      className={cn(
        "group/toast pointer-events-auto relative col-start-1 row-start-1 z-[calc(3-var(--toast-index))] flex h-[var(--toast-frontmost-height,auto)] min-h-[calc(var(--button-height-default)+0.25rem)] w-full origin-top translate-y-[var(--toast-shift-y)] scale-[calc(1-var(--toast-index)*0.05)] items-center self-start rounded-lg border text-sm shadow-sm outline-none [--toast-shift-y:calc(var(--toast-index)*0.5rem)] transition-[opacity,translate,scale] duration-[var(--layout-motion-duration)] ease-[var(--layout-motion-ease)] before:absolute before:inset-x-0 before:-top-3 before:hidden before:h-3 before:content-[''] data-starting-style:-translate-y-[calc(100%+1rem)]! data-starting-style:opacity-0 data-ending-style:pointer-events-none data-ending-style:translate-y-[calc(var(--toast-shift-y)-0.5rem)]! data-ending-style:opacity-0 data-ending-style:duration-[calc(var(--layout-motion-duration)*0.6)] data-ending-style:ease-in data-expanded:h-[var(--toast-height,auto)] data-expanded:scale-100 data-expanded:[--toast-shift-y:calc(var(--toast-offset-y)+var(--toast-index)*0.5rem)] data-expanded:before:block data-limited:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none",
        className,
      )}
    >
      {/* The front card sets the width; Base UI measures each height for animated expansion. */}
      <div className="max-h-full w-full overflow-hidden rounded-[inherit] group-data-expanded/toast:overflow-visible">
        <ToastPrimitive.Content className="flex w-full items-center gap-2 py-[var(--control-content-padding-block-compact)] pr-1.5 pl-3 transition-[opacity,visibility] duration-[calc(var(--layout-motion-duration)*0.5)] ease-out group-data-ending-style/toast:opacity-0 data-behind:invisible data-behind:opacity-0 data-behind:[contain:inline-size] data-expanded:visible data-expanded:opacity-100 motion-reduce:transition-none">
          <Icon
            aria-hidden="true"
            className="size-[var(--icon-size-md)] shrink-0"
            strokeWidth={1.5}
          />
          <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            <ToastPrimitive.Title className="leading-5 font-normal" />
            {toast.description ? (
              <ToastPrimitive.Description className="text-xs leading-5" />
            ) : null}
          </div>
          <ToastPrimitive.Close
            aria-label={closeLabel}
            render={
              <Button variant="ghost" size="icon-sm" className="text-inherit hover:text-inherit" />
            }
          >
            <XIcon aria-hidden="true" />
          </ToastPrimitive.Close>
        </ToastPrimitive.Content>
      </div>
    </ToastPrimitive.Root>
  );
}

/** Mount once inside the Shell so notifications inherit their installation's appearance. */
export function Toaster({ label, closeLabel }: { label: string; closeLabel: string }) {
  const { toasts } = useToastManager();
  const container = useWorkbenchPortalContainer();

  return (
    <ToastPrimitive.Portal container={container}>
      <ToastPrimitive.Viewport
        aria-label={label}
        data-slot="toaster"
        className="pointer-events-none fixed inset-x-4 top-[calc(env(safe-area-inset-top)+3.5rem)] z-[60] mx-auto grid w-max max-w-[min(var(--container-lg),calc(100%-2rem))] grid-cols-1 outline-none"
      >
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} closeLabel={closeLabel} />
        ))}
      </ToastPrimitive.Viewport>
    </ToastPrimitive.Portal>
  );
}
