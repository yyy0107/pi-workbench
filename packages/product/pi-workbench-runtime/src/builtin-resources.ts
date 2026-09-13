import { lstat, mkdir, readFile, readdir, realpath, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  getAgentDir,
  getDocsPath,
  getExamplesPath,
  getPackageDir,
  getReadmePath,
  SettingsManager,
  VERSION,
} from "@earendil-works/pi-coding-agent";
import { withCrossProcessFileLock } from "@workbench/server-core/file-persistence";
import { pathWithin } from "@workbench/pi-sdk-resources/resource-mutations";
import {
  browserPackageArtifactRelativePath,
  browserPackageDirectory,
} from "@workbench/pi-runtime-browser/resources";
import {
  workbenchToolSourceDirectory,
  WORKBENCH_TOOL_SOURCE_PATHS,
  RETIRED_WORKBENCH_TOOL_SOURCE_PATHS,
} from "./tool-resources";
import { registerWorkbenchBuiltinPackages } from "./builtin-packages";
import { workbenchBuiltinResourceUrl } from "./resource-locations";

import {
  ensureBuiltinDirectory,
  writeBuiltinFile,
  copyBuiltinDirectory,
} from "../lib/builtin-files";

/** Application-owned files live separately from user resources and Pi's automatic discovery. */
export async function ensureWorkbenchBuiltinResources(
  agentDir = getAgentDir(),
  extensionSource = workbenchToolSourceDirectory(),
) {
  const directories = {
    skills: path.join(agentDir, "skills", ".builtin"),
    extensions: path.join(agentDir, "extensions", ".builtin"),
    prompts: path.join(agentDir, "prompts", ".builtin"),
    packages: path.join(agentDir, "packages", ".builtin"),
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
      // Each bundled resource owns a directory; root registries and placeholders stay with the host.
      for (const kind of ["skills", "prompts", "extensions"] as const) {
        const source = fileURLToPath(
          kind === "extensions" ? extensionSource : workbenchBuiltinResourceUrl(kind),
        );
        if (kind === "extensions") {
          // Establish each parent boundary before copying the product's tool-only snapshot.
          for (const directory of ["src", "lib", "resources"]) {
            await ensureBuiltinDirectory(path.join(directories.extensions, directory));
          }
          for (const relative of WORKBENCH_TOOL_SOURCE_PATHS) {
            const sourcePath = path.join(source, relative);
            const destination = path.join(directories.extensions, relative);
            if ((await lstat(sourcePath)).isDirectory()) {
              await copyBuiltinDirectory(sourcePath, destination);
            } else {
              await ensureBuiltinDirectory(path.dirname(destination));
              await writeBuiltinFile(destination, await readFile(sourcePath, "utf8"));
            }
          }
          for (const relative of RETIRED_WORKBENCH_TOOL_SOURCE_PATHS) {
            // Do not follow a replaced parent directory when retiring nested snapshots.
            let parent = directories.extensions;
            let exists = true;
            for (const part of relative.split("/").slice(0, -1)) {
              parent = path.join(parent, part);
              const entry = await lstat(parent).catch((error: NodeJS.ErrnoException) => {
                if (error.code === "ENOENT") return undefined;
                throw error;
              });
              if (!entry) {
                exists = false;
                break;
              }
              if (!entry.isDirectory() || entry.isSymbolicLink())
                throw new Error("A built-in resource directory cannot be a symbolic link or file.");
            }
            if (exists) await rm(path.join(directories.extensions, relative), { force: true });
          }
          continue;
        }
        for (const entry of await readdir(source, { withFileTypes: true })) {
          if (entry.isDirectory())
            await copyBuiltinDirectory(
              path.join(source, entry.name),
              path.join(directories[kind], entry.name),
            );
        }
      }
      // Development follows the live source; artifacts ship an independent compiled Pi package.
      const sourceRoot = fileURLToPath(browserPackageDirectory);
      const sourceEntry = path.join(sourceRoot, "src", "index.ts");
      const development = await lstat(sourceEntry).then(
        (entry) => entry.isFile(),
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
          return false;
        },
      );
      const browserRoot = development
        ? sourceRoot
        : fileURLToPath(new URL(browserPackageArtifactRelativePath, import.meta.url));
      const browserDirectory = path.join(directories.packages, "browser");
      await ensureBuiltinDirectory(browserDirectory);
      if (development) {
        await copyBuiltinDirectory(
          path.join(browserRoot, "skills"),
          path.join(browserDirectory, "skills"),
        );
        await writeBuiltinFile(
          path.join(browserDirectory, "README.md"),
          await readFile(path.join(browserRoot, "README.md"), "utf8"),
        );
        const browserManifest = JSON.parse(
          await readFile(path.join(browserRoot, "package.json"), "utf8"),
        );
        if (browserManifest.name !== "@workbench/pi-runtime-browser")
          throw new Error("The built-in Browser package manifest is invalid.");
        await writeBuiltinFile(
          path.join(browserDirectory, "index.js"),
          `export { default } from ${JSON.stringify(pathToFileURL(sourceEntry).href)};\n`,
        );
        await writeBuiltinFile(
          path.join(browserDirectory, "resources.js"),
          'export const browserPackageDirectory = new URL("./", import.meta.url);\n' +
            `export const browserPackageArtifactRelativePath = ${JSON.stringify(browserPackageArtifactRelativePath)};\n`,
        );
        await writeBuiltinFile(
          path.join(browserDirectory, "package.json"),
          JSON.stringify(
            {
              name: browserManifest.name,
              version: browserManifest.version,
              private: browserManifest.private,
              description: browserManifest.description,
              keywords: browserManifest.keywords,
              type: "module",
              exports: { ".": "./index.js", "./resources": "./resources.js" },
              peerDependencies: browserManifest.peerDependencies,
              pi: { ...browserManifest.pi, extensions: ["./index.js"] },
            },
            null,
            2,
          ) + "\n",
        );
      } else {
        await copyBuiltinDirectory(browserRoot, browserDirectory);
      }
      await registerWorkbenchBuiltinPackages(agentDir);
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
      // Remove only retired shipped files, preserving unknown additions and rejecting links.
      const retiredPrompts = ["pi-extension", "pi-hook", "pi-tool", "pi-skill"];
      const retiredLocales = ["en-US", "zh-CN"];
      for (const [directory, files] of [
        [path.join(directories.skills, "browser"), ["SKILL.md"]],
        [path.join(directories.extensions, "browser"), ["index.ts"]],
        ...retiredPrompts.map(
          (name) =>
            [
              path.join(directories.prompts, name),
              [...retiredLocales.map((locale) => `${locale}.md`), "LICENSE.pi"],
            ] as const,
        ),
        ...retiredLocales.map(
          (locale) =>
            [
              path.join(directories.prompts, locale),
              retiredPrompts.map((name) => `prompts-${name}.md`),
            ] as const,
        ),
      ] as const) {
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
