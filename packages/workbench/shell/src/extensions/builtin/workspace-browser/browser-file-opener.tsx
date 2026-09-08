"use client";

import { useLayoutEffect } from "react";
import type { OpenHandlerDefinition } from "@workbench/extension-sdk";
import { defineMessage } from "../../../i18n";
import { useBrowserSessionService, type BrowserSessionService } from "./browser-session-service";

export function browserFileUrl(path: string): string {
  const windows = /^[a-z]:[\\/]/i.test(path);
  if (!windows && !path.startsWith("/")) throw new Error("An absolute file path is required");
  const normalized = windows ? `/${path.replaceAll("\\", "/")}` : path;
  const url = new URL("file:///");
  url.pathname = normalized
    .split("/")
    .map((part, index) => (windows && index === 1 ? part : encodeURIComponent(part)))
    .join("/");
  return url.href;
}

export function createBrowserFileOpener() {
  let browser: BrowserSessionService | undefined;
  const handler: OpenHandlerDefinition = {
    id: "workspace.browser-file",
    canOpen: ({ resource }) => (browser && resource.scheme === "browser-file" ? 100 : 0),
    async open({ resource, context, scope }, { surfaces }) {
      if (!browser) throw new Error("Browser runtime is not mounted");
      const session = await browser.create({
        projectId: context.projectId ?? context.applicationId,
        url: browserFileUrl(resource.path),
      });
      return surfaces.open({
        kind: "browser",
        title: resource.label ?? defineMessage("extensions.workspaceBrowser.title"),
        params: { browserSessionId: session.id, url: session.url },
        context,
        scope,
        placement: "primary",
        status: "ready",
        policy: "force-focus",
      });
    },
  };
  function BrowserFileOpenerRuntime() {
    const service = useBrowserSessionService();
    useLayoutEffect(() => {
      browser = service;
      return () => {
        if (browser === service) browser = undefined;
      };
    }, [service]);
    return null;
  }
  return { handler, Runtime: BrowserFileOpenerRuntime };
}
