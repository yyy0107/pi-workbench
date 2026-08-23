import type { Manifest } from "material-icon-theme";

export interface MaterialIconIds {
  dark: string;
  light: string;
}

type IconAssociation = "fileExtensions" | "fileNames";
type FolderAssociation = "folderNames" | "folderNamesExpanded";

const ICON_ASSET_PREFIX = "/vendor/material-icon-theme/icons/";

function normalizedPath(path: string): string {
  return path
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .toLowerCase();
}

function baseName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

function extensionCandidates(fileName: string): readonly string[] {
  const extensions: string[] = [];
  for (let dot = fileName.indexOf("."); dot !== -1; dot = fileName.indexOf(".", dot + 1)) {
    if (dot < fileName.length - 1) extensions.push(fileName.slice(dot + 1));
  }
  return extensions;
}

function namedAssociation(
  manifest: Manifest | undefined,
  association: IconAssociation,
  path: string,
  fileName: string,
): string | undefined {
  const entries = manifest?.[association];
  return entries?.[path] ?? entries?.[fileName];
}

function extensionAssociation(
  manifest: Manifest | undefined,
  candidates: readonly string[],
): string | undefined {
  for (const candidate of candidates) {
    const icon = manifest?.fileExtensions?.[candidate];
    if (icon) return icon;
  }
  return undefined;
}

function resolveFileIcon(manifest: Manifest, path: string, light: boolean): string {
  const normalized = normalizedPath(path);
  const fileName = baseName(normalized);
  const extensions = extensionCandidates(fileName);
  const variant = light ? manifest.light : undefined;

  return (
    namedAssociation(variant, "fileNames", normalized, fileName) ??
    namedAssociation(manifest, "fileNames", normalized, fileName) ??
    extensionAssociation(variant, extensions) ??
    extensionAssociation(manifest, extensions) ??
    variant?.file ??
    manifest.file ??
    "file"
  );
}

function resolveFolderIcon(
  manifest: Manifest,
  name: string,
  expanded: boolean,
  light: boolean,
): string {
  const normalized = normalizedPath(name);
  const folderName = baseName(normalized);
  const association: FolderAssociation = expanded ? "folderNamesExpanded" : "folderNames";
  const variant = light ? manifest.light : undefined;

  return (
    variant?.[association]?.[folderName] ??
    manifest[association]?.[folderName] ??
    (expanded ? variant?.folderExpanded : variant?.folder) ??
    (expanded ? manifest.folderExpanded : manifest.folder) ??
    (expanded ? "folder-open" : "folder")
  );
}

export function materialFileIconIds(manifest: Manifest, path: string): MaterialIconIds {
  return {
    dark: resolveFileIcon(manifest, path, false),
    light: resolveFileIcon(manifest, path, true),
  };
}

export function materialFolderIconIds(
  manifest: Manifest,
  name: string,
  expanded: boolean,
): MaterialIconIds {
  return {
    dark: resolveFolderIcon(manifest, name, expanded, false),
    light: resolveFolderIcon(manifest, name, expanded, true),
  };
}

export function materialIconAssetUrl(manifest: Manifest, iconId: string): string {
  const iconPath = manifest.iconDefinitions?.[iconId]?.iconPath;
  const marker = "/icons/";
  const markerIndex = iconPath?.lastIndexOf(marker) ?? -1;
  const fileName =
    markerIndex === -1 ? `${iconId}.svg` : iconPath!.slice(markerIndex + marker.length);
  return `${ICON_ASSET_PREFIX}${fileName
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}
