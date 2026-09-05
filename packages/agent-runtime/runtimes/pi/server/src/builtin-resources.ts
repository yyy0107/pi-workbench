import { lstat, mkdir, readFile, readdir, realpath, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { piBuiltinPromptCatalogs } from "@workbench/agent-runtime-pi-shared/builtin-prompts";
import {
  atomicReplaceFile,
  withCrossProcessFileLock,
} from "@workbench/server-core/file-persistence";
import { pathWithin } from "./resources/resource-mutations";

async function ensureBuiltinDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  if ((await lstat(directory)).isSymbolicLink()) {
    throw new Error("A built-in resource directory cannot be a symbolic link.");
  }
}

async function writeBuiltinFile(filePath: string, content: string): Promise<void> {
  try {
    if ((await readFile(filePath, "utf8")) === content) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await atomicReplaceFile(filePath, content);
}

async function copyBuiltinDirectory(source: string, destination: string): Promise<void> {
  await ensureBuiltinDirectory(destination);
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyBuiltinDirectory(sourcePath, destinationPath);
    else if (entry.isFile())
      await writeBuiltinFile(destinationPath, await readFile(sourcePath, "utf8"));
  }
}

/** Application-owned files live separately from user resources and Pi's automatic discovery. */
export async function ensureWorkbenchBuiltinResources(agentDir = getAgentDir()) {
  const directories = {
    skills: path.join(agentDir, "skills", ".builtin"),
    extensions: path.join(agentDir, "extensions", ".builtin"),
    prompts: path.join(agentDir, "prompts", ".builtin"),
  };
  await mkdir(agentDir, { recursive: true });
  await withCrossProcessFileLock(
    { lockDirectory: path.join(agentDir, ".workbench-builtin-resources-lock") },
    async () => {
      const root = await realpath(agentDir);
      for (const directory of Object.values(directories)) {
        await mkdir(path.dirname(directory), { recursive: true });
        if (!pathWithin(root, await realpath(path.dirname(directory))))
          throw new Error("Built-in resources must stay inside the Pi agent directory.");
        await ensureBuiltinDirectory(directory);
      }
      await copyBuiltinDirectory(
        fileURLToPath(new URL("./skills/builtin-skills/", import.meta.url)),
        directories.skills,
      );
      const extensionSource = fileURLToPath(new URL("./internal-extensions/", import.meta.url));
      // Each extension owns a directory; the root registry belongs to the compiled host.
      for (const entry of await readdir(extensionSource, { withFileTypes: true })) {
        if (entry.isDirectory())
          await copyBuiltinDirectory(
            path.join(extensionSource, entry.name),
            path.join(directories.extensions, entry.name),
          );
      }
      // The installed validator lives outside node_modules; record this Runtime's public SDK entry.
      await writeBuiltinFile(
        path.join(directories.skills, "skill-creator", "runtime.json"),
        JSON.stringify({
          piCodingAgentModule: import.meta.resolve("@earendil-works/pi-coding-agent"),
        }) + "\n",
      );
      // Rename the previously shipped skill without resetting its persisted switch.
      const settings = SettingsManager.create(agentDir, agentDir, { projectTrusted: false });
      const previousPaths = settings.getGlobalSettings().skills ?? [];
      const skillPaths = previousPaths.map((entry) =>
        entry.replace(
          /(^[!+-]?skills[/\\]\.builtin[/\\])skills-creator(?=[/\\]|$)/,
          "$1skill-creator",
        ),
      );
      if (skillPaths.some((entry, index) => entry !== previousPaths[index])) {
        settings.setSkillPaths(skillPaths);
        await settings.flush();
        const failure = settings.drainErrors()[0];
        if (failure) throw failure.error;
      }
      await rm(path.join(directories.skills, "skills-creator"), { recursive: true, force: true });
      const promptLicense = await readFile(
        new URL("./builtin-prompt-license.txt", import.meta.url),
        "utf8",
      );
      for (const [locale, templates] of Object.entries(piBuiltinPromptCatalogs)) {
        for (const [name, template] of Object.entries(templates)) {
          const directory = path.join(directories.prompts, name);
          await ensureBuiltinDirectory(directory);
          await writeBuiltinFile(path.join(directory, `${locale}.md`), template.content + "\n");
          await writeBuiltinFile(path.join(directory, "LICENSE.pi"), promptLicense);
        }
      }
      // Remove only previously shipped flat paths after their replacements have been written.
      for (const name of [
        "ask-user",
        "builtin-tools",
        "composer-context",
        "context-trace",
        "enhanced-search",
        "index",
        "legacy-message-termination",
        "legacy-message-termination-extension-source",
        "message-termination",
        "system-prompt-hook-trace",
        "todo",
        "tool-availability",
      ]) {
        await rm(path.join(directories.extensions, `${name}.ts`), { force: true });
      }
      for (const [locale, templates] of Object.entries(piBuiltinPromptCatalogs)) {
        const legacyDirectory = path.join(directories.prompts, locale);
        try {
          if ((await lstat(legacyDirectory)).isSymbolicLink())
            throw new Error("A built-in resource directory cannot be a symbolic link.");
          for (const name of Object.keys(templates))
            await rm(path.join(legacyDirectory, `prompts-${name}.md`), { force: true });
          await rmdir(legacyDirectory);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== "ENOENT" && code !== "ENOTEMPTY") throw error;
        }
      }
      await rm(path.join(directories.prompts, "LICENSE.pi"), { force: true });
    },
  );
  return directories;
}
