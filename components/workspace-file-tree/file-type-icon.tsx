import type { Manifest } from "material-icon-theme";
import { Link2Icon } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import {
  materialFileIconIds,
  materialFolderIconIds,
  materialIconAssetUrl,
  type MaterialIconIds,
} from "./material-icon-theme";

const MANIFEST_URL = "/vendor/material-icon-theme/material-icons.json";
const fallbackManifest = {
  file: "file",
  folder: "folder",
  folderExpanded: "folder-open",
  iconDefinitions: {},
} as Manifest;

let cachedManifest: Manifest = fallbackManifest;
let manifestRequest: Promise<Manifest> | undefined;

function loadManifest() {
  manifestRequest ??= fetch(MANIFEST_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`Material icon manifest returned ${response.status}.`);
      return response.json() as Promise<Manifest>;
    })
    .then((manifest) => {
      cachedManifest = manifest;
      return manifest;
    })
    .catch((error: unknown) => {
      console.error("[material-icon-theme] manifest load failed", error);
      return fallbackManifest;
    });
  return manifestRequest;
}

function useMaterialIconManifest() {
  const [manifest, setManifest] = useState(cachedManifest);
  useEffect(() => {
    let active = true;
    void loadManifest().then((loaded) => {
      if (active) setManifest(loaded);
    });
    return () => {
      active = false;
    };
  }, []);
  return manifest;
}

function MaterialThemeIcon({
  manifest,
  icons,
  symbolicLink,
  className,
}: Readonly<{
  manifest: Manifest;
  icons: MaterialIconIds;
  symbolicLink: boolean;
  className?: string;
}>) {
  const lightSource = materialIconAssetUrl(manifest, icons.light);
  const darkSource = materialIconAssetUrl(manifest, icons.dark);
  const themeSpecific = lightSource !== darkSource;

  return (
    <span
      aria-hidden="true"
      className={cn("relative inline-flex size-4 shrink-0 items-center justify-center", className)}
    >
      <img
        alt=""
        draggable={false}
        src={lightSource}
        className={cn("pointer-events-none size-4 select-none", themeSpecific && "dark:hidden")}
      />
      {themeSpecific ? (
        <img
          alt=""
          draggable={false}
          src={darkSource}
          className="pointer-events-none hidden size-4 select-none dark:block"
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
  const manifest = useMaterialIconManifest();
  return (
    <MaterialThemeIcon
      manifest={manifest}
      icons={materialFileIconIds(manifest, path)}
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
  const manifest = useMaterialIconManifest();
  return (
    <MaterialThemeIcon
      manifest={manifest}
      icons={materialFolderIconIds(manifest, name, expanded)}
      symbolicLink={symbolicLink}
      className={className}
    />
  );
}
