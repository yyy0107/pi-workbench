import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";
import { createRoot } from "react-dom/client";

import type {
  MessageRendererNode,
  ToolRendererComponent,
  ToolRendererProps,
  WorkbenchExtension,
} from "@workbench/extension-sdk";

import { ExtensionProvider } from "../src/extension-provider";
import { RendererHost } from "../src/hosts/renderer-host";
import { createPanelStoreFixture } from "./panel-store-fixture";
import { flushReactMicrotasks, installMinimalReactDomEnvironment } from "./react-dom-environment";

test("an exact tool renderer receives partial Blocks and uninstall restores the fallback", async () => {
  const environment = installMinimalReactDomEnvironment();
  const root = createRoot(environment.container);
  const panelStore = createPanelStoreFixture();
  const renders: string[] = [];
  const block = {
    key: "tool:call-1",
    kind: "tool-call",
    callId: "call-1",
    toolName: "partial_tool",
    argumentsText: '{"query":"stre',
    status: "running",
  } satisfies ToolRendererProps["block"];
  const node = {
    key: "assistant-1",
    kind: "assistant",
    status: "running",
    blocks: [block],
  } satisfies MessageRendererNode;
  const ToolRenderer: ToolRendererComponent = ({ block: renderedBlock }) => {
    renders.push(`${renderedBlock.status}:${renderedBlock.argumentsText}`);
    return null;
  };
  const Fallback = () => {
    renders.push("fallback");
    return null;
  };
  const extension: WorkbenchExtension = {
    id: "workbench.renderer-host-test",
    name: "Renderer Host Test",
    version: "1.0.0",
    setup: (context) => context.renderers.tools.register(block.toolName, ToolRenderer),
  };
  const view = (extensions: readonly WorkbenchExtension[]) => (
    <ExtensionProvider extensions={extensions} panelStore={panelStore}>
      <RendererHost node={node} block={block} fallback={<Fallback />} />
    </ExtensionProvider>
  );

  try {
    await act(async () => {
      root.render(view([extension]));
      await flushReactMicrotasks();
    });
    assert.equal(renders.at(-1), 'running:{"query":"stre');

    renders.length = 0;
    await act(async () => {
      root.render(view([]));
      await flushReactMicrotasks();
    });
    assert.equal(renders.at(-1), "fallback");
  } finally {
    await act(async () => {
      root.unmount();
      await flushReactMicrotasks();
    });
    environment.restore();
  }
});
