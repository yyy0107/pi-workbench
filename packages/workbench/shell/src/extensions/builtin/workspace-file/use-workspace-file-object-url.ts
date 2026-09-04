"use client";

import { useEffect, useState } from "react";

import { WorkbenchAgentCapabilityError } from "@workbench/agent-runtime-client";
import { useWorkbenchWorkspaceCapability } from "@workbench/agent-runtime-client/context";

type WorkspaceFileObjectUrlState =
  | {
      readonly sourceKey: string;
      readonly status: "ready";
      readonly url: string;
    }
  | {
      readonly sourceKey: string;
      readonly status: "error";
      readonly error: unknown;
    };

export type WorkspaceFileObjectUrlSnapshot =
  | { readonly status: "idle" | "loading" }
  | { readonly status: "ready"; readonly url: string }
  | { readonly status: "error"; readonly error: unknown };

const IDLE_OBJECT_URL_SNAPSHOT = Object.freeze({ status: "idle" as const });
const LOADING_OBJECT_URL_SNAPSHOT = Object.freeze({ status: "loading" as const });

/**
 * Bind binary preview bytes to the active Runtime Host before handing them to native browser media
 * elements. The blob URL is local to this renderer and is revoked whenever its source changes.
 */
export function useWorkspaceFileObjectUrl(
  source:
    | {
        workspaceId: string;
        relativePath: string;
        version: string;
        retryToken: number;
        enabled: boolean;
      }
    | undefined,
): WorkspaceFileObjectUrlSnapshot {
  const workspaceClient = useWorkbenchWorkspaceCapability();
  const sourceKey = source?.enabled
    ? JSON.stringify([source.workspaceId, source.relativePath, source.version, source.retryToken])
    : undefined;
  const [state, setState] = useState<WorkspaceFileObjectUrlState>();

  useEffect(() => {
    setState((current) => (current?.sourceKey === sourceKey ? current : undefined));
    if (!source?.enabled || !sourceKey) {
      return;
    }
    if (!workspaceClient) {
      setState({
        sourceKey,
        status: "error",
        error: new WorkbenchAgentCapabilityError("unavailable"),
      });
      return;
    }
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void workspaceClient
      .fetchFileContent(
        { workspaceId: source.workspaceId, relativePath: source.relativePath },
        { signal: controller.signal },
      )
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ sourceKey, status: "ready", url: objectUrl });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ sourceKey, status: "error", error });
        }
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source?.enabled, source?.relativePath, source?.workspaceId, sourceKey, workspaceClient]);

  if (!sourceKey) return IDLE_OBJECT_URL_SNAPSHOT;
  if (!state || state.sourceKey !== sourceKey) return LOADING_OBJECT_URL_SNAPSHOT;
  return state;
}
