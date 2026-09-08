import assert from "node:assert/strict";
import test from "node:test";
import { act, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { installMinimalReactDomEnvironment } from "../../test/react-dom-environment";
import { DropdownMenu, DropdownMenuRadioGroup, DropdownMenuSubTrigger } from "./dropdown-menu";
import { ModelSelector, type ModelSelectorOption } from "./model-selector";

interface ElementProps {
  children?: ReactNode;
  render?: ReactNode;
  label?: string;
  value?: string;
  model?: ModelSelectorOption;
  onChange?(value: string): void;
  onValueChange?(value: string): void;
  onOpenChange?(open: boolean): void;
}

function elements(node: ReactNode): ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<ElementProps>(node)) return [];
  return [node, ...elements(node.props.children), ...elements(node.props.render)];
}

test("provider browsing scopes model search and effort menus follow the selected model", async () => {
  const environment = installMinimalReactDomEnvironment();
  const root = createRoot(environment.container);
  const changes: string[] = [];
  const models: ModelSelectorOption[] = [
    {
      id: "a/reason",
      provider: "a",
      name: "Shared reasoning model",
      efforts: [{ id: "high", name: "High" }],
    },
    { id: "a/plain", provider: "a", name: "Plain model" },
    {
      id: "b/reason",
      provider: "b",
      name: "Shared reasoning model",
      efforts: [{ id: "high", name: "High" }],
    },
    { id: "b/plain", provider: "b", name: "Plain model", efforts: [] },
  ].map((model) => ({ ...model, model: model.id, providerName: model.provider }));
  let tree: ReactNode;
  let props: ComponentProps<typeof ModelSelector> = {
    labels: {
      select: "Select model",
      provider: "Provider",
      model: "Model",
      reasoningEffort: "Effort",
      search: "Search models",
      searchPlaceholder: "Search models",
      loadFailed: "Load failed",
      noModels: "No models",
      noSearchResults: "No matching models",
      selectFailed: "Selection failed",
      currentUnavailable: "Unavailable",
      saving: "Saving",
    },
    models,
    selectedModelId: "a/reason",
    selectedEffort: "high",
    getEffortLabel: (effort) => effort.name,
    onEffortChange: () => undefined,
    onModelChange: (id) => {
      changes.push(id);
      props = { ...props, selectedModelId: id };
      root.render(<Probe />);
    },
  };
  function Probe() {
    tree = ModelSelector(props);
    return null;
  }
  const radioGroups = () =>
    elements(tree).filter((element) => element.type === DropdownMenuRadioGroup);
  const menuLabels = () =>
    elements(tree)
      .filter((element) => element.type === DropdownMenuSubTrigger)
      .map(
        (element) =>
          elements(element.props.children).find((child) => child.type === "span")?.props.children,
      );
  const visibleModels = () => elements(tree).flatMap((element) => element.props.model?.id ?? []);
  const search = () =>
    elements(tree).find((element) => element.props.label === props.labels.search)!;
  const browse = async (provider: string) => {
    await act(async () => radioGroups()[0]!.props.onValueChange!(provider));
  };
  const query = async (value: string) => {
    await act(async () => search().props.onChange!(value));
  };

  try {
    await act(async () => root.render(<Probe />));
    assert.deepEqual(menuLabels(), ["Provider", "Model", "Effort"]);
    assert.deepEqual(visibleModels(), ["a/reason", "a/plain"]);
    await query("Shared");
    assert.deepEqual(visibleModels(), ["a/reason"]);

    await browse("b");
    assert.deepEqual(changes, []);
    assert.equal(search().props.value, "");
    assert.deepEqual(visibleModels(), ["b/reason", "b/plain"]);
    assert.deepEqual(menuLabels(), ["Provider", "Model"]);
    await query("Shared");
    assert.deepEqual(visibleModels(), ["b/reason"]);
    await browse("a");
    assert.equal(search().props.value, "");
    assert.deepEqual(visibleModels(), ["a/reason", "a/plain"]);

    await act(async () => radioGroups()[1]!.props.onValueChange!("a/plain"));
    assert.deepEqual(menuLabels(), ["Provider", "Model"]);
    await browse("b");
    await act(async () => radioGroups()[1]!.props.onValueChange!("b/plain"));
    assert.deepEqual(menuLabels(), ["Provider", "Model"]);
    assert.deepEqual(changes, ["a/plain", "b/plain"]);

    await browse("a");
    await query("Shared");
    await act(async () =>
      elements(tree).find((element) => element.type === DropdownMenu)!.props.onOpenChange!(false),
    );
    await act(async () =>
      elements(tree).find((element) => element.type === DropdownMenu)!.props.onOpenChange!(true),
    );
    assert.equal(radioGroups()[0]!.props.value, "b");
    assert.equal(search().props.value, "");
    assert.deepEqual(visibleModels(), ["b/reason", "b/plain"]);
  } finally {
    await act(async () => root.unmount());
    environment.restore();
  }
});
