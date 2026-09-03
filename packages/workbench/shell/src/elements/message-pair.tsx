"use client";

import type { ComponentProps, ReactNode } from "react";

import { cn } from "../utils";

import { mutedPaper } from "../ui/surface";
import { StreamingText } from "./streaming-text";

export interface MessagePairProps extends Omit<ComponentProps<"div">, "children"> {
  userMessage?: ReactNode;
  assistantMessage?: ReactNode;
  words?: readonly string[];
  visibleWords?: number;
  streaming?: boolean;
  actions?: ReactNode;
  variant?: "bubble" | "flat";
}

export function MessagePair({
  userMessage,
  assistantMessage,
  words = [],
  visibleWords = words.length,
  streaming = false,
  actions,
  variant = "bubble",
  className,
  ...props
}: MessagePairProps) {
  return (
    <div
      data-slot="message-pair"
      className={cn("flex w-full max-w-sm flex-col gap-5", className)}
      {...props}
    >
      {userMessage !== undefined && (
        <div
          className={cn(
            "max-w-[85%] self-end text-sm [overflow-anchor:none]",
            variant === "bubble"
              ? cn(mutedPaper, "rounded-2xl px-3.5 py-2")
              : "text-foreground/90 text-end",
          )}
        >
          {userMessage}
        </div>
      )}
      {(assistantMessage !== undefined || words.length > 0 || streaming || actions) && (
        <div className="group/message flex min-w-0 flex-col items-start [overflow-anchor:none]">
          {assistantMessage ?? (
            <StreamingText
              className="min-h-[4.25rem]"
              segments={words.map((word) => ({ text: word }))}
              count={visibleWords}
              streaming={streaming}
            />
          )}
          {actions && (
            <div className="flex items-center gap-1 pt-1 opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100 motion-reduce:transition-none">
              {actions}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
