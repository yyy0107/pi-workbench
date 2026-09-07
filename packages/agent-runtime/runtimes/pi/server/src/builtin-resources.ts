import { lstat, mkdir, readFile, readdir, realpath, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getAgentDir,
  getDocsPath,
  getExamplesPath,
  getPackageDir,
  getReadmePath,
  SettingsManager,
  VERSION,
} from "@earendil-works/pi-coding-agent";
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
      await writeBuiltinFile(
        path.join(directories.skills, "pi-docs", "runtime.json"),
        JSON.stringify({
          version: VERSION,
          packageDir: getPackageDir(),
          readme: getReadmePath(),
          docs: getDocsPath(),
          examples: getExamplesPath(),
        }) + "\n",
      );
      await writeBuiltinFile(
        path.join(directories.skills, "skill-installer", "runtime.json"),
        JSON.stringify({ userResourceDir: path.resolve(agentDir) }) + "\n",
      );
      await writeBuiltinFile(
        path.join(directories.skills, "extension-creator", "runtime.json"),
        JSON.stringify({
          userResourceDir: path.resolve(agentDir),
          piCodingAgentModule: import.meta.resolve("@earendil-works/pi-coding-agent"),
          nodeExecutable: process.execPath,
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
      // Remove only shipped prompt files, preserving any custom files in these directories.
      const retiredPrompts = ["pi-extension", "pi-hook", "pi-tool", "pi-skill"];
      const retiredLocales = ["en-US", "zh-CN"];
      for (const [name, files] of [
        ...retiredPrompts.map(
          (name) =>
            [name, [...retiredLocales.map((locale) => `${locale}.md`), "LICENSE.pi"]] as const,
        ),
        ...retiredLocales.map(
          (locale) => [locale, retiredPrompts.map((name) => `prompts-${name}.md`)] as const,
        ),
      ]) {
        const directory = path.join(directories.prompts, name);
        try {
          if ((await lstat(directory)).isSymbolicLink())
            throw new Error("A built-in resource directory cannot be a symbolic link.");
          for (const file of files) await rm(path.join(directory, file), { force: true });
          await rmdir(directory);
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
