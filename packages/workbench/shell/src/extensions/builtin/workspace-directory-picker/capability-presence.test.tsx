import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkbenchAgentRuntimeEnvironmentProvider } from "@workbench/agent-runtime-client/context";
import type { WorkbenchAgentRuntimeCapabilities } from "@workbench/agent-runtime-client/capabilities";
import { DirectoryPickerButton } from "./directory-picker-button";
import { WorkspaceDirectorySummary } from "./workspace-directory-summary";

test("directory and trust entry points stay hidden unless both host and workspace are installed", () => {
  for (const capabilities of [{}, { host: {} }, { workspace: {} }]) {
    const markup = renderToStaticMarkup(
      <WorkbenchAgentRuntimeEnvironmentProvider
        id="fixture"
        commands={[]}
        capabilities={capabilities as WorkbenchAgentRuntimeCapabilities}
      >
        <DirectoryPickerButton />
        <WorkspaceDirectorySummary isRunning={false} isEmpty submissionBlocked={false} />
      </WorkbenchAgentRuntimeEnvironmentProvider>,
    );
    assert.equal(markup, "");
  }
});
