import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { WorkbenchAgentRuntimeEnvironmentProvider } from "@workbench/agent-runtime-client/context";
import type {
  WorkbenchAgentRuntimeCapabilities,
  WorkbenchWorkspaceCapability,
} from "@workbench/agent-runtime-client/capabilities";
import type {
  WorkbenchWorkspaceGitDiff,
  WorkbenchWorkspaceGitDiffRequest,
} from "@workbench/agent-runtime-contracts/runtime-capabilities";
import { installMinimalReactDomEnvironment } from "../../../../test/react-dom-environment";
import { useGitDiff } from "./use-git-diff";

test("ignores old scope requests even if cancellation is ignored; paginates and retries the active comparison", async () => {
  const dom = installMinimalReactDomEnvironment();
  const root = createRoot(dom.container);
  const calls: Array<{
    request: WorkbenchWorkspaceGitDiffRequest;
    signal?: AbortSignal;
    resolve(value: WorkbenchWorkspaceGitDiff): void;
    reject(error: unknown): void;
  }> = [];
  const readGitDiff: WorkbenchWorkspaceCapability["readGitDiff"] = (request, options) =>
    new Promise((resolve, reject) =>
      calls.push({ request, signal: options?.signal, resolve, reject }),
    );
  const capabilities = { workspace: { readGitDiff } } as WorkbenchAgentRuntimeCapabilities;
  let query: ReturnType<typeof useGitDiff>;
  function Probe({ request }: { request: WorkbenchWorkspaceGitDiffRequest }) {
    query = useGitDiff(request);
    return null;
  }
  const render = async (request: WorkbenchWorkspaceGitDiffRequest) =>
    act(async () =>
      root.render(
        <WorkbenchAgentRuntimeEnvironmentProvider
          id="review-test"
          commands={[]}
          capabilities={capabilities}
        >
          <Probe key={JSON.stringify(request)} request={request} />
        </WorkbenchAgentRuntimeEnvironmentProvider>,
      ),
    );
  const value = (path: string, nextOffset?: number): WorkbenchWorkspaceGitDiff => ({
    repository: true,
    branches: ["main"],
    files: [{ path, kind: "modified" }],
    nextOffset,
    patchVersion: "version",
  });
  try {
    await render({ workspaceId: "one", scope: "unstaged" });
    await render({ workspaceId: "two", scope: "staged" });
    assert.equal(calls[0].signal?.aborted, true);
    await act(async () => calls[1].resolve(value("current", 200)));
    await act(async () => calls[0].resolve(value("stale")));
    assert.deepEqual(query!.data, value("current", 200));
    await act(async () => query!.loadMore());
    assert.equal(calls[2].request.offset, 200);
    assert.equal(calls[2].request.patchVersion, "version");
    await act(async () => calls[2].reject(new Error("offline")));
    assert.equal(query!.error, "failed");
    await act(async () => query!.retry());
    assert.equal(calls[3].request.offset, 200);
    await act(async () => calls[3].resolve(value("next")));
    const data = query!.data;
    assert.ok(data?.repository);
    if (data?.repository)
      assert.deepEqual(
        data.files.map((file) => file.path),
        ["current", "next"],
      );
    await render({ workspaceId: "two", scope: "branch", revision: "main" });
    assert.equal(query!.data, undefined);
    assert.equal(query!.loading, true);
  } finally {
    await act(async () => root.unmount());
    assert.equal(calls.at(-1)?.signal?.aborted, true);
    dom.restore();
  }
});
