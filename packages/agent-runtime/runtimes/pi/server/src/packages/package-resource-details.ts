import { realpath } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";

import {
  parseFrontmatter,
  type Extension,
  type ResolvedPaths,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { PiPackageResourceView } from "@workbench/agent-runtime-pi-protocol/rpc";
import { pathWithin } from "../resources/resource-mutations";
import { readResourceTextFile } from "../resources/resource-text-file";
import { skillExplicitlyEnabled } from "../skills/skill-enablement";

/** Read declarations only; never import or execute an extension to inspect a package. */
export async function readPackageResourceDetails(
  paths: ResolvedPaths,
  installedPath: string,
  source: string,
  scope: "user" | "project",
  extensions: readonly Extension[],
  settingsManager: SettingsManager,
): Promise<PiPackageResourceView[]> {
  const root = await realpath(installedPath);
  const resources: PiPackageResourceView[] = [];
  for (const [field, type] of [
    ["skills", "skill"],
    ["prompts", "prompt"],
    ["extensions", "extension"],
    ["themes", "theme"],
  ] as const) {
    for (const resource of paths[field]) {
      if (resource.metadata.source !== source || resource.metadata.scope !== scope) continue;
      const path = await realpath(resource.path).catch(() => undefined);
      if (!path || !pathWithin(root, path)) continue;
      const item: PiPackageResourceView = {
        type,
        name:
          type === "skill" && basename(path) === "SKILL.md"
            ? basename(dirname(path))
            : basename(path, extname(path)),
        enabled:
          resource.enabled &&
          (type !== "skill" ||
            skillExplicitlyEnabled(resource.path, resource.metadata, settingsManager)),
      };
      if (type === "extension") {
        if (item.name === "index") item.name = basename(dirname(path));
        const extension = extensions.find(
          (entry) =>
            entry.resolvedPath === resource.path &&
            entry.sourceInfo.source === source &&
            entry.sourceInfo.scope === scope,
        );
        if (extension) {
          item.commandNames = [...extension.commands.keys()].sort();
          item.toolNames = [...extension.tools.keys()].sort();
          item.eventNames = [...extension.handlers.keys()].sort();
        }
      } else {
        try {
          const { content } = await readResourceTextFile(path, 256 * 1024);
          const { frontmatter, body } =
            type === "theme"
              ? { frontmatter: JSON.parse(content) as Record<string, unknown>, body: "" }
              : parseFrontmatter(content);
          if (
            type !== "prompt" &&
            typeof frontmatter?.name === "string" &&
            frontmatter.name.trim()
          ) {
            item.name = frontmatter.name.trim().slice(0, 512);
          }
          const description =
            typeof frontmatter?.description === "string"
              ? frontmatter.description.trim()
              : body
                  .split(/\r?\n/)
                  .find((line) => line.trim() && !line.startsWith("#"))
                  ?.trim();
          if (description) item.description = description.slice(0, 2048);
        } catch {
          // A missing/invalid description must not hide the remaining package contents.
        }
      }
      resources.push(item);
    }
  }
  return resources;
}
