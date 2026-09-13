import type { Manifest } from "material-icon-theme";
import { Link2Icon } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@workbench/ui/utils";

import {
  materialFileIconIds,
  materialFolderIconIds,
  materialIconAssetUrl,
  type MaterialIconIds,
} from "../../lib/material-icon-theme";
import { useFilePresentationAssets } from "./file-presentation-context";

const fallbackManifest = {
  file: "file",
  folder: "folder",
  folderExpanded: "folder-open",
  iconDefinitions: {},
} as Manifest;

const cachedManifests = new Map<string, Manifest>();
const manifestRequests = new Map<string, Promise<Manifest>>();

function loadManifest(manifestUrl: string): Promise<Manifest> {
  const existing = manifestRequests.get(manifestUrl);
  if (existing) return existing;

  const request = fetch(manifestUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`Material icon manifest returned ${response.status}.`);
      return response.json() as Promise<Manifest>;
    })
    .then((manifest) => {
      cachedManifests.set(manifestUrl, manifest);
      return manifest;
    })
    .catch((error: unknown) => {
      console.error("[material-icon-theme] manifest load failed", error);
      return fallbackManifest;
    });
  manifestRequests.set(manifestUrl, request);
  return request;
}

function useMaterialIconManifest(manifestUrl: string): Manifest {
  const [manifest, setManifest] = useState(
    () => cachedManifests.get(manifestUrl) ?? fallbackManifest,
  );
  useEffect(() => {
    let active = true;
    setManifest(cachedManifests.get(manifestUrl) ?? fallbackManifest);
    void loadManifest(manifestUrl).then((loaded) => {
      if (active) setManifest(loaded);
    });
    return () => {
      active = false;
    };
  }, [manifestUrl]);
  return manifest;
}

function MaterialThemeIcon({
  manifest,
  icons,
  materialIconThemeBaseUrl,
  symbolicLink,
  className,
}: Readonly<{
  manifest: Manifest;
  icons: MaterialIconIds;
  materialIconThemeBaseUrl: string;
  symbolicLink: boolean;
  className?: string;
}>) {
  const lightSource = materialIconAssetUrl(manifest, icons.light, materialIconThemeBaseUrl);
  const darkSource = materialIconAssetUrl(manifest, icons.dark, materialIconThemeBaseUrl);
  const themeSpecific = lightSource !== darkSource;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex size-[var(--icon-size-md)] shrink-0 items-center justify-center",
        className,
      )}
    >
      <img
        alt=""
        draggable={false}
        src={lightSource}
        className={cn(
          "pointer-events-none size-[var(--icon-size-md)] select-none",
          themeSpecific && "dark:hidden",
        )}
      />
      {themeSpecific ? (
        <img
          alt=""
          draggable={false}
          src={darkSource}
          className="pointer-events-none hidden size-[var(--icon-size-md)] select-none dark:block"
        />
      ) : null}
      {symbolicLink ? (
        <Link2Icon className="bg-background absolute -right-1 -bottom-1 size-2.5 rounded-full" />
      ) : null}
    </span>
  );
}

export function FileTypeIcon({
  path,
  symbolicLink = false,
  className,
}: Readonly<{
  path: string;
  symbolicLink?: boolean;
  className?: string;
}>) {
  const { materialIconThemeBaseUrl } = useFilePresentationAssets();
  const manifest = useMaterialIconManifest(`${materialIconThemeBaseUrl}/material-icons.json`);
  return (
    <MaterialThemeIcon
      manifest={manifest}
      icons={materialFileIconIds(manifest, path)}
      materialIconThemeBaseUrl={materialIconThemeBaseUrl}
      symbolicLink={symbolicLink}
      className={className}
    />
  );
}

export function FolderTypeIcon({
  name,
  expanded,
  symbolicLink = false,
  className,
}: Readonly<{
  name: string;
  expanded: boolean;
  symbolicLink?: boolean;
  className?: string;
}>) {
  const { materialIconThemeBaseUrl } = useFilePresentationAssets();
  const manifest = useMaterialIconManifest(`${materialIconThemeBaseUrl}/material-icons.json`);
  return (
    <MaterialThemeIcon
      manifest={manifest}
      icons={materialFolderIconIds(manifest, name, expanded)}
      materialIconThemeBaseUrl={materialIconThemeBaseUrl}
      symbolicLink={symbolicLink}
      className={className}
    />
  );
}
