import manifestData from "material-icon-theme/dist/material-icons.json" with { type: "json" };
import type { Manifest } from "material-icon-theme";
import { Link2Icon } from "lucide-react";

import { cn } from "@/lib/utils";

import {
  materialFileIconIds,
  materialFolderIconIds,
  materialIconAssetUrl,
  type MaterialIconIds,
} from "./material-icon-theme";

const manifest = manifestData as Manifest;

function MaterialThemeIcon({
  icons,
  symbolicLink,
  className,
}: Readonly<{
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
  return (
    <MaterialThemeIcon
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
  return (
    <MaterialThemeIcon
      icons={materialFolderIconIds(manifest, name, expanded)}
      symbolicLink={symbolicLink}
      className={className}
    />
  );
}
