"use client";

import type { ComponentProps } from "react";
import { CircleAlertIcon, CircleStopIcon, PlayIcon, RefreshCwIcon } from "lucide-react";

import { Button } from "../ui/button";
import { cn } from "../utils";

import { ShimmerLabel } from "../ui/surface";

export interface ErrorStateProps extends Omit<ComponentProps<"div">, "children" | "role"> {
  title: string;
  detail: string;
  retrying: boolean;
  retryDisabled?: boolean;
  retryLabel: string;
  retryingLabel: string;
  onRetry: () => void;
  tone?: "error" | "stopped";
  actionKind?: "retry" | "continue";
  showAction?: boolean;
}

export function ErrorState({
  title,
  detail,
  retrying,
  retryDisabled = false,
  retryLabel,
  retryingLabel,
  onRetry,
  tone = "error",
  actionKind = "retry",
  showAction = true,
  className,
  ...props
}: ErrorStateProps) {
  if (retrying) {
    return (
      <div
        data-slot="error-state"
        key="retrying"
        role="status"
        className={cn(
          "fade-in animate-in flex w-full max-w-sm items-center gap-2.5 text-sm duration-300 motion-reduce:animate-none",
          className,
        )}
        {...props}
      >
        <RefreshCwIcon className="text-foreground/45 aui-chat-icon-size-default animate-spin motion-reduce:animate-none" />
        <ShimmerLabel className="text-foreground/55 relative inline-block">
          {retryingLabel}
        </ShimmerLabel>
      </div>
    );
  }

  return (
    <div
      data-slot="error-state"
      key="error"
      role="alert"
      className={cn(
        "fade-in animate-in flex w-full max-w-sm items-start gap-2.5 rounded-2xl px-4 py-3 text-sm duration-300 motion-reduce:animate-none",
        tone === "error" ? "bg-red-500/[0.06] dark:bg-red-500/10" : "bg-muted/60",
        className,
      )}
      {...props}
    >
      {tone === "error" ? (
        <CircleAlertIcon className="mt-0.5 aui-chat-icon-size-default text-red-500/80" />
      ) : (
        <CircleStopIcon className="text-muted-foreground mt-0.5 aui-chat-icon-size-default" />
      )}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "font-medium",
            tone === "error" ? "text-red-600 dark:text-red-400" : "text-foreground/75",
          )}
        >
          {title}
        </p>
        <p
          className={cn(
            "mt-0.5 max-h-24 overflow-y-auto text-[13px] leading-snug break-words whitespace-pre-wrap",
            tone === "error" ? "text-red-600/60 dark:text-red-400/60" : "text-muted-foreground",
          )}
        >
          {detail}
        </p>
      </div>
      {showAction ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={retryDisabled}
          onClick={onRetry}
          className={cn(
            "ms-auto shrink-0 px-3 text-xs",
            tone === "error"
              ? "text-red-600 hover:bg-red-500/10 focus-visible:ring-red-500/30 dark:text-red-400"
              : "text-foreground/70 hover:bg-foreground/5 focus-visible:ring-ring",
          )}
        >
          {actionKind === "continue" ? <PlayIcon className="fill-current" /> : <RefreshCwIcon />}
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
