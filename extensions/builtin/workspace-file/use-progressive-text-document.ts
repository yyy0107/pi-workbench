"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { streamPiWorkspaceFileText } from "@/workbench/runtime-contributions/pi/client/workspace";

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
  enabled = true,
): ProgressiveTextState {
  const [attempt, setAttempt] = useState(0);
  const sourceAvailable = source !== undefined;
  const sourceText = source?.text;
  const sourceTotalBytes = source?.totalBytes;
  const sourceVersion = source?.version;
  const streamRelativePath = source?.stream?.relativePath;
  const streamWorkspaceId = source?.stream?.workspaceId;
  const document = useMemo(
    () => new ProgressiveTextDocument(sourceTotalBytes),
    [
      enabled,
      attempt,
      sourceText,
      sourceTotalBytes,
      sourceVersion,
      streamRelativePath,
      streamWorkspaceId,
    ],
  );
  const initialState = useMemo<InternalProgressiveTextState>(
    () => ({
      document,
      snapshot: document.snapshot(),
      stage: sourceAvailable ? (sourceText === undefined ? "loading" : "rendering") : "idle",
    }),
    [document, sourceAvailable, sourceText],
  );
  const [state, setState] = useState(initialState);

  useEffect(() => {
    if (!enabled || !sourceAvailable || sourceTotalBytes === undefined) return;

    const abortController = new AbortController();
    let cancelIdle: (() => void) | undefined;
    let publishFrame: number | undefined;
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
      publish("ready");
    };

    setState(initialState);

    if (sourceText !== undefined) {
      const text = sourceText;
      let offset = 0;
      const parseNextChunk = (deadline?: IdleDeadline) => {
        if (!active) return;
        const startedAt = offset;
        do {
          const end = Math.min(offset + STATIC_PARSE_CHUNK_CHARACTERS, text.length);
          const loadedBytes =
            text.length === 0
              ? sourceTotalBytes
              : Math.round((end / text.length) * sourceTotalBytes);
          document.append(text.slice(offset, end), loadedBytes, sourceTotalBytes);
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
          finish(sourceTotalBytes, sourceTotalBytes);
        }
      };
      cancelIdle = scheduleIdle(parseNextChunk);
    } else if (streamWorkspaceId && streamRelativePath) {
      void streamPiWorkspaceFileText(
        { workspaceId: streamWorkspaceId, relativePath: streamRelativePath },
        {
          signal: abortController.signal,
          onChunk(chunk) {
            document.append(chunk.text, chunk.loadedBytes, chunk.totalBytes ?? sourceTotalBytes);
            schedulePublish("loading");
          },
        },
      ).then(
        (result) => finish(result.loadedBytes, result.totalBytes ?? sourceTotalBytes),
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
    };
  }, [
    document,
    enabled,
    initialState,
    sourceAvailable,
    sourceText,
    sourceTotalBytes,
    streamRelativePath,
    streamWorkspaceId,
  ]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const current = state.document === document ? state : initialState;
  return { ...current, retry };
}
