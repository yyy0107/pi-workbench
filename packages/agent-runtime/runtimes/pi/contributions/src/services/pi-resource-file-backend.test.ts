import assert from "node:assert/strict";
import test from "node:test";
import type { PiResourceClient } from "@workbench/agent-runtime-pi-client/resources";
import {
  BufferedFileWorkspaceService,
  fileWorkspaceContext,
  fileWorkspaceOpenableResource,
  resolveFileWorkspaceSession,
} from "@workbench/shell/workspace-files";
import { createPiResourceFileBackend } from "./pi-resource-file-backend";

const firstScope = { type: "thread" as const, key: "thread-1" };

test("resource file sessions share directory, read, and opener behavior", async () => {
  const calls: Array<{ method: string; payload: unknown }> = [];
  const rootPath = "/home/user/.pi/agent/extensions/review";
  const resources = {
    listSkillFiles: async () => assert.fail("Expected extension listing"),
    readSkillFile: async () => assert.fail("Expected extension read"),
    listExtensionFiles: async (payload: Parameters<PiResourceClient["listExtensionFiles"]>[0]) => {
      calls.push({ method: "list", payload });
      return {
        extensionName: "review",
        rootPath,
        relativePath: "lib",
        entries: [
          {
            name: "prompt.ts",
            relativePath: "lib/prompt.ts",
            kind: "file" as const,
            hidden: false,
          },
        ],
        truncated: false,
      };
    },
    readExtensionFile: async (payload: Parameters<PiResourceClient["readExtensionFile"]>[0]) => {
      calls.push({ method: "read", payload });
      return {
        extensionName: "review",
        rootPath,
        relativePath: "lib/prompt.ts",
        absolutePath: `${rootPath}/lib/prompt.ts`,
        name: "prompt.ts",
        content: "export const prompt = 'review';\n",
        mediaType: "text/typescript",
        encoding: "utf-8" as const,
        version: "sha256:prompt",
        size: 32,
        modifiedAt: 1,
      };
    },
  };
  const files = new BufferedFileWorkspaceService(undefined, createPiResourceFileBackend(resources));
  const params = {
    source: "extension" as const,
    rootPath,
    resourceTarget: { scope: "user" as const },
    extensionName: "review",
    extensionFilePath: `${rootPath}/index.ts`,
    extensionSource: "auto",
    extensionScope: "user" as const,
    extensionOrigin: "top-level" as const,
  };
  const session = resolveFileWorkspaceSession(params);
  assert.ok(session);
  const context = fileWorkspaceContext(firstScope, session);

  const listing = await files.listDirectory(context, "lib");
  const opened = await files.readFile(context, "lib/prompt.ts");
  assert.equal(listing.nodes[0]?.path, `${rootPath}/lib/prompt.ts`);
  assert.equal(opened.source, "resource");
  await assert.rejects(
    () => files.writeFile(context, opened.path, "edited", opened.version),
    /read-only/u,
  );
  assert.equal(files.getSnapshot(context, opened.path)?.content, opened.content);
  assert.deepEqual(fileWorkspaceOpenableResource(context.session!, listing.nodes[0]!), {
    scheme: "extension-file",
    path: `${rootPath}/lib/prompt.ts`,
    label: "prompt.ts",
    metadata: {
      resourceTarget: { scope: "user" },
      extensionName: "review",
      extensionFilePath: `${rootPath}/index.ts`,
      extensionSource: "auto",
      extensionScope: "user",
      extensionOrigin: "top-level",
      relativePath: "lib/prompt.ts",
    },
  });
  assert.deepEqual(calls, [
    {
      method: "list",
      payload: {
        target: { scope: "user" },
        name: "review",
        filePath: `${rootPath}/index.ts`,
        source: "auto",
        scope: "user",
        origin: "top-level",
        relativePath: "lib",
      },
    },
    {
      method: "read",
      payload: {
        target: { scope: "user" },
        name: "review",
        filePath: `${rootPath}/index.ts`,
        source: "auto",
        scope: "user",
        origin: "top-level",
        relativePath: "lib/prompt.ts",
      },
    },
  ]);
});
