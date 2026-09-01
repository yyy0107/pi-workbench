"use client";

import { useLayoutEffect } from "react";

import type { OpenerRegistry } from "@workbench/extension-sdk";

import { createFileOpenHandlers } from "../extensions/workspace-file/file-opener";
import { useWorkspaceFileRuntime } from "./workspace-file-runtime";

/** Registers File resource handlers for the explicitly installed Pi contribution set. */
export function PiFileWorkspaceOpenersBridge({ openers }: Readonly<{ openers: OpenerRegistry }>) {
  const { files, resources, diffs } = useWorkspaceFileRuntime();

  useLayoutEffect(() => {
    const handlers = createFileOpenHandlers(files, resources, diffs);
    const registrations = [
      openers.register(handlers.fileOpenHandler),
      openers.register(handlers.skillFileOpenHandler),
      openers.register(handlers.skillDirectoryOpenHandler),
      openers.register(handlers.extensionFileOpenHandler),
      openers.register(handlers.extensionDirectoryOpenHandler),
    ];
    return () => {
      for (const registration of registrations.reverse()) registration.dispose();
    };
  }, [diffs, files, openers, resources]);

  return null;
}
