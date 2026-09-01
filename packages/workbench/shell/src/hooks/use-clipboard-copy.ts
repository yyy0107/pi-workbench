"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { writeClipboardText } from "../clipboard";

export type CopyStatus = "copied" | "failed" | "idle";

type CopyOperation = () => boolean | Promise<boolean>;

export function useCopyFeedback({ duration = 3_000 }: { duration?: number } = {}) {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const operationGeneration = useRef(0);
  const feedbackTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const reset = useCallback(() => {
    operationGeneration.current += 1;
    if (feedbackTimeout.current !== undefined) {
      clearTimeout(feedbackTimeout.current);
      feedbackTimeout.current = undefined;
    }
    setStatus("idle");
  }, []);

  useEffect(
    () => () => {
      operationGeneration.current += 1;
      if (feedbackTimeout.current !== undefined) clearTimeout(feedbackTimeout.current);
    },
    [],
  );

  const runCopy = useCallback(
    (operation: CopyOperation): Promise<boolean> => {
      const generation = ++operationGeneration.current;
      if (feedbackTimeout.current !== undefined) {
        clearTimeout(feedbackTimeout.current);
        feedbackTimeout.current = undefined;
      }
      setStatus("idle");

      let result: boolean | Promise<boolean>;
      try {
        result = operation();
      } catch {
        result = false;
      }

      return Promise.resolve(result).then(
        (succeeded) => {
          if (generation !== operationGeneration.current) return succeeded;

          setStatus(succeeded ? "copied" : "failed");
          feedbackTimeout.current = setTimeout(() => {
            feedbackTimeout.current = undefined;
            setStatus("idle");
          }, duration);
          return succeeded;
        },
        () => {
          if (generation === operationGeneration.current) {
            setStatus("failed");
            feedbackTimeout.current = setTimeout(() => {
              feedbackTimeout.current = undefined;
              setStatus("idle");
            }, duration);
          }
          return false;
        },
      );
    },
    [duration],
  );

  return { isCopied: status === "copied", reset, runCopy, status };
}

export function useClipboardCopy(options?: { duration?: number }) {
  const feedback = useCopyFeedback(options);
  const { runCopy } = feedback;
  const copy = useCallback((value: string) => runCopy(() => writeClipboardText(value)), [runCopy]);

  return { ...feedback, copy };
}
