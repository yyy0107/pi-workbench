"use client";

import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

import { mutedPaper } from "./surfaces";
import { take } from "./range";

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
  const shown = take(words, visibleWords);

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
      {(assistantMessage !== undefined || shown.length > 0 || streaming || actions) && (
        <div className="group/message flex min-w-0 flex-col items-start [overflow-anchor:auto]">
          {assistantMessage ?? (
            <p className="min-h-[4.25rem] text-sm leading-relaxed">
              {shown.map((word, index) => {
                const fresh = streaming && shown.length - 1 - index < 2;

                return (
                  <span
                    key={`${word}-${index}`}
                    className="fade-in animate-in fill-mode-both duration-500 motion-reduce:animate-none"
                  >
                    <span
                      className={cn(
                        "transition-colors duration-700 motion-reduce:transition-none",
                        fresh && "text-blue-500 dark:text-blue-400",
                      )}
                    >
                      {word}
                    </span>{" "}
                  </span>
                );
              })}
              {streaming && shown.length > 0 && (
                <span
                  aria-hidden
                  className="-mb-0.5 ml-0.5 inline-block h-4 w-0.5 animate-pulse rounded-full bg-blue-500 motion-reduce:animate-none dark:bg-blue-400"
                />
              )}
            </p>
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
