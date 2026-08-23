"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { streamPiWorkspaceFileText } from "@/runtime/pi/client/transport/api";

import { ProgressiveTextDocument, type ProgressiveTextSnapshot } from "./progressive-text-document";

const STATIC_PARSE_CHUNK_CHARACTERS = 256 * 1024;

export type ProgressiveTextStage = "idle" | "loading" | "rendering" | "ready" | "error";

export interface ProgressiveTextSource {
  text?: string;
  stream?: {
    workspaceId: string;
    relativePath: string;
  };
  totalBytes: number;
  version: string;
}

export interface ProgressiveTextState {
  document: ProgressiveTextDocument;
  snapshot: ProgressiveTextSnapshot;
  stage: ProgressiveTextStage;
  retry(): void;
}

interface InternalProgressiveTextState {
  document: ProgressiveTextDocument;
  snapshot: ProgressiveTextSnapshot;
  stage: ProgressiveTextStage;
}

function scheduleIdle(callback: (deadline?: IdleDeadline) => void): () => void {
  if (window.requestIdleCallback) {
    const id = window.requestIdleCallback(callback, { timeout: 80 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(callback, 0);
  return () => window.clearTimeout(id);
}

export function useProgressiveTextDocument(
  source: ProgressiveTextSource | undefined,
): ProgressiveTextState {
  const [attempt, setAttempt] = useState(0);
  const document = useMemo(
    () => new ProgressiveTextDocument(source?.totalBytes),
    [
      attempt,
      source?.stream?.relativePath,
      source?.stream?.workspaceId,
      source?.text,
      source?.version,
    ],
  );
  const initialState = useMemo<InternalProgressiveTextState>(
    () => ({
      document,
      snapshot: document.snapshot(),
      stage: source ? (source.text === undefined ? "loading" : "rendering") : "idle",
    }),
    [document, source],
  );
  const [state, setState] = useState(initialState);

  useEffect(() => {
    if (!source) return;

    const abortController = new AbortController();
    let cancelIdle: (() => void) | undefined;
    let publishFrame: number | undefined;
    let readyFrame: number | undefined;
    let active = true;

    const publish = (stage: ProgressiveTextStage) => {
      if (!active) return;
      setState({ document, snapshot: document.snapshot(), stage });
    };
    const schedulePublish = (stage: ProgressiveTextStage) => {
      if (publishFrame !== undefined) return;
      publishFrame = window.requestAnimationFrame(() => {
        publishFrame = undefined;
        publish(stage);
      });
    };
    const finish = (loadedBytes?: number, totalBytes?: number) => {
      if (!active) return;
      if (publishFrame !== undefined) window.cancelAnimationFrame(publishFrame);
      publishFrame = undefined;
      document.finish(loadedBytes, totalBytes);
      publish("rendering");
      readyFrame = window.requestAnimationFrame(() => publish("ready"));
    };

    setState(initialState);

    if (source.text !== undefined) {
      const text = source.text;
      let offset = 0;
      const parseNextChunk = (deadline?: IdleDeadline) => {
        if (!active) return;
        const startedAt = offset;
        do {
          const end = Math.min(offset + STATIC_PARSE_CHUNK_CHARACTERS, text.length);
          const loadedBytes =
            text.length === 0
              ? source.totalBytes
              : Math.round((end / text.length) * source.totalBytes);
          document.append(text.slice(offset, end), loadedBytes, source.totalBytes);
          offset = end;
        } while (
          offset < text.length &&
          offset - startedAt < STATIC_PARSE_CHUNK_CHARACTERS * 4 &&
          (deadline?.timeRemaining() ?? 0) > 2
        );

        publish("rendering");
        if (offset < text.length) {
          cancelIdle = scheduleIdle(parseNextChunk);
        } else {
          finish(source.totalBytes, source.totalBytes);
        }
      };
      cancelIdle = scheduleIdle(parseNextChunk);
    } else if (source.stream) {
      void streamPiWorkspaceFileText(source.stream, {
        signal: abortController.signal,
        onChunk(chunk) {
          document.append(chunk.text, chunk.loadedBytes, chunk.totalBytes ?? source.totalBytes);
          schedulePublish("loading");
        },
      }).then(
        (result) => finish(result.loadedBytes, result.totalBytes ?? source.totalBytes),
        () => {
          if (!abortController.signal.aborted) publish("error");
        },
      );
    }

    return () => {
      active = false;
      abortController.abort();
      cancelIdle?.();
      if (publishFrame !== undefined) window.cancelAnimationFrame(publishFrame);
      if (readyFrame !== undefined) window.cancelAnimationFrame(readyFrame);
    };
  }, [document, initialState, source]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const current = state.document === document ? state : initialState;
  return { ...current, retry };
}
