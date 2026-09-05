import assert from "node:assert/strict";
import test from "node:test";
import {
  Children,
  isValidElement,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RuntimeProvider } from "@workbench/agent-runtime-client";
import { WorkbenchAgentRuntimeEnvironmentProvider } from "@workbench/agent-runtime-client/context";
import type { WorkbenchAgentRuntimeCapabilities } from "@workbench/agent-runtime-client/capabilities";
import {
  WorkspaceSelectionProvider,
  type WorkspaceCapabilities,
  type WorkbenchWorkspaceSummary,
} from "@workbench/agent-runtime-client/workspaces";
import { I18nProvider } from "@workbench/shell/i18n";
import { WorkbenchSettingsProvider } from "@workbench/shell/settings";
import {
  createSameOriginRuntimeConnection,
  RuntimeConnectionProvider,
} from "@workbench/shell/runtime-connection";
import { SearchableSelector, WorkspaceSelector } from "@workbench/shell/ui";
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

function renderWorkspacePicker({
  capabilities = { host: {}, workspace: {} } as WorkbenchAgentRuntimeCapabilities,
  workspaceCapabilities = {},
  workspaces = [],
  onSelector = () => {},
}: {
  capabilities?: WorkbenchAgentRuntimeCapabilities;
  workspaceCapabilities?: Partial<WorkspaceCapabilities>;
  workspaces?: WorkbenchWorkspaceSummary[];
  onSelector?(props: ComponentProps<typeof WorkspaceSelector>): void;
} = {}) {
  type Runtime = ComponentProps<typeof RuntimeProvider>["runtime"];
  const current = { sessionId: undefined, isNewThread: true };
  const runtime: Pick<Runtime, "current"> = {
    current: { getSnapshot: () => current, subscribe: () => () => {} },
  };

  // Render the actual contribution's footer inline so SSR exercises it without a DOM portal.
  function FooterProbe() {
    const summary = WorkspaceDirectorySummary({
      isRunning: false,
      isEmpty: true,
      submissionBlocked: false,
    });
    assert.ok(summary);
    const summaryProps = summary.props;
    const Content = summary.type as (
      props: typeof summaryProps,
    ) => ReactElement<{ children: ReactNode }>;
    const content = Content(summaryProps);
    const selector = Children.toArray(content.props.children).find(
      (child) => isValidElement(child) && child.type === WorkspaceSelector,
    );
    assert.ok(isValidElement<ComponentProps<typeof WorkspaceSelector>>(selector));
    onSelector(selector.props);
    return <SearchableSelector items={[]}>{selector.props.footer}</SearchableSelector>;
  }

  const markup = renderToStaticMarkup(
    <WorkbenchSettingsProvider service={{ load: async () => ({}), update: async () => {} }}>
      <I18nProvider initialLocale="en-US">
        <RuntimeProvider runtime={runtime as Runtime}>
          <RuntimeConnectionProvider
            connection={createSameOriginRuntimeConnection("http://localhost:3000")}
          >
            <WorkbenchAgentRuntimeEnvironmentProvider
              id="fixture"
              commands={[]}
              capabilities={capabilities}
            >
              <WorkspaceSelectionProvider
                capabilities={workspaceCapabilities as WorkspaceCapabilities}
                selection={{ workspaces, collapsedWorkspaceIds: [] }}
              >
                <FooterProbe />
              </WorkspaceSelectionProvider>
            </WorkbenchAgentRuntimeEnvironmentProvider>
          </RuntimeConnectionProvider>
        </RuntimeProvider>
      </I18nProvider>
    </WorkbenchSettingsProvider>,
  );
  return markup;
}

test("the workspace picker footer renders inside a combobox without a menu context", () => {
  const markup = renderWorkspacePicker();
  assert.match(markup, /<button[^>]*type="button"/u);
  assert.match(markup, /Open folder/u);
  assert.doesNotMatch(markup, /role="menuitem"/u);
});

test("selecting a listed project checks current trust before selecting it", async () => {
  const workspace = { id: "project", name: "Project", rootPath: "/work/project" };
  for (const trusted of [null, false, true, "read-error"] as const) {
    const calls: string[] = [];
    let selector!: ComponentProps<typeof WorkspaceSelector>;
    renderWorkspacePicker({
      workspaces: [workspace],
      onSelector: (props) => {
        selector = props;
      },
      capabilities: {
        host: {
          describeProjectTrust: async (path: string) => {
            calls.push(`describe:${path}`);
            if (trusted === "read-error") throw new Error("Trust could not be read");
            return { path, trusted, requiresTrust: false, promptRequired: trusted === null };
          },
        },
        workspace: {
          createWorkspace: async (path: string) => {
            calls.push(`create:${path}`);
            return { workspace, created: false };
          },
        },
      } as WorkbenchAgentRuntimeCapabilities,
      workspaceCapabilities: {
        beginNewThread: (): void => assert.fail("Must not bypass project trust"),
        beginNewThreadWithCreatedWorkspace: (selected) => {
          assert.equal(selected, workspace);
          calls.push(`select:${selected.id}`);
        },
      },
    });

    await selector.onValueChange(workspace.id);
    assert.deepEqual(
      calls,
      trusted === true
        ? ["describe:/work/project", "create:/work/project", "select:project"]
        : ["describe:/work/project"],
    );
  }
});
