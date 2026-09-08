"use client";

import {
  Code2Icon,
  FileTextIcon,
  FolderIcon,
  Globe2Icon,
  ImageIcon,
  TerminalIcon,
  VideoIcon,
} from "lucide-react";
import { useState } from "react";

import type { WorkbenchLocalApp } from "@workbench/host-contracts/runtime-capabilities";
import { cn } from "@workbench/shell/utils";
import { assetModuleUrl, type AssetModule } from "./asset-module-url";
import chromeIcon from "./icons/chrome.svg";
import chromiumIcon from "./icons/chromium.svg";
import cursorIcon from "./icons/cursor.svg";
import datagripIcon from "./icons/datagrip.svg";
import edgeIcon from "./icons/edge.svg";
import firefoxIcon from "./icons/firefox.svg";
import ideaIcon from "./icons/idea.svg";
import mpvIcon from "./icons/mpv.svg";
import pycharmIcon from "./icons/pycharm.svg";
import qoderIcon from "./icons/qoder.svg";
import safariIcon from "./icons/safari.svg";
import traeIcon from "./icons/trae.svg";
import vlcIcon from "./icons/vlc.svg";
import vscodeIcon from "./icons/vscode.svg";
import webstormIcon from "./icons/webstorm.svg";

const LOCAL_APP_ICON_SOURCES: Readonly<Record<string, AssetModule>> = {
  chrome: chromeIcon,
  chromium: chromiumIcon,
  cursor: cursorIcon,
  datagrip: datagripIcon,
  edge: edgeIcon,
  firefox: firefoxIcon,
  idea: ideaIcon,
  mpv: mpvIcon,
  pycharm: pycharmIcon,
  qoder: qoderIcon,
  safari: safariIcon,
  trae: traeIcon,
  vlc: vlcIcon,
  vscode: vscodeIcon,
  webstorm: webstormIcon,
};

export function LocalAppIcon({ app }: { app?: WorkbenchLocalApp }) {
  const source = app?.icon ? LOCAL_APP_ICON_SOURCES[app.icon] : undefined;
  const sourceUrl = source ? assetModuleUrl(source) : undefined;
  const [failedSource, setFailedSource] = useState<string>();
  if (sourceUrl && failedSource !== sourceUrl) {
    return (
      <img
        aria-hidden="true"
        src={sourceUrl}
        alt=""
        width={16}
        height={16}
        className={cn(
          "size-[var(--button-icon-size,var(--icon-size-md))] shrink-0 object-contain",
          app?.icon === "qoder" && "rounded-[3px] bg-[#101114] p-px",
        )}
        onError={() => setFailedSource(sourceUrl)}
      />
    );
  }
  if (app?.kind === "terminal") return <TerminalIcon aria-hidden="true" />;
  if (app?.kind === "file-manager") return <FolderIcon aria-hidden="true" />;
  if (app?.kind === "media-player") return <VideoIcon aria-hidden="true" />;
  if (app?.kind === "browser") return <Globe2Icon aria-hidden="true" />;
  if (app?.kind === "image-editor") return <ImageIcon aria-hidden="true" />;
  if (app?.kind === "pdf-reader" || app?.kind === "office") {
    return <FileTextIcon aria-hidden="true" />;
  }
  return <Code2Icon aria-hidden="true" />;
}
