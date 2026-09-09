import assert from "node:assert/strict";
import test from "node:test";
import { act, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { installMinimalReactDomEnvironment } from "../../test/react-dom-environment";
import { DropdownMenu, DropdownMenuRadioGroup, DropdownMenuItem } from "./dropdown-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible";
import { SelectorDropdownContent } from "./selector-dropdown";
import { ModelSelector, type ModelSelectorOption } from "./model-selector";

interface ElementProps {
  children?: ReactNode;
  render?: ReactNode;
  label?: string;
  open?: boolean;
  closeOnClick?: boolean;
  side?: string;
  collisionAvoidance?: { side: string; align: string };
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
      .filter((element) => element.type === CollapsibleTrigger)
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
    const popup = elements(tree).find((element) => element.type === SelectorDropdownContent)!;
    assert.equal(popup.props.side, "top");
    assert.deepEqual(popup.props.collisionAvoidance, { side: "none", align: "shift" });
    const sections = () => elements(tree).filter((element) => element.type === Collapsible);
    assert.deepEqual(
      sections().map((section) => section.props.open),
      [false, false, false],
    );
    assert.equal(elements(tree).filter((element) => element.type === CollapsibleContent).length, 3);
    for (const section of sections()) {
      const children = elements(section.props.children);
      assert.ok(
        children.findIndex((child) => child.type === CollapsibleContent) <
          children.findIndex((child) => child.type === CollapsibleTrigger),
        "lists expand above their triggers to preserve the click position",
      );
    }
    assert.ok(
      elements(tree)
        .filter((element) => element.type === DropdownMenuItem)
        .every((element) => element.props.closeOnClick === false),
    );
    await act(async () => sections()[1]!.props.onOpenChange!(true));
    assert.deepEqual(
      sections().map((section) => section.props.open),
      [false, true, false],
    );
    await act(async () => sections()[0]!.props.onOpenChange!(true));
    assert.deepEqual(
      sections().map((section) => section.props.open),
      [true, false, false],
    );
    await act(async () => sections()[0]!.props.onOpenChange!(false));
    assert.ok(sections().every((section) => !section.props.open));
    assert.deepEqual(visibleModels(), ["a/reason", "a/plain"]);
    await query("Shared");
    assert.deepEqual(visibleModels(), ["a/reason"]);

    await act(async () => sections()[0]!.props.onOpenChange!(true));
    await browse("b");
    assert.ok(sections().every((section) => !section.props.open));
    assert.deepEqual(changes, []);
    assert.equal(radioGroups()[1]!.props.value, "", "an unselected provider stays controlled");
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
    assert.ok(sections().every((section) => !section.props.open));
    assert.equal(radioGroups()[0]!.props.value, "b");
    assert.equal(search().props.value, "");
    assert.deepEqual(visibleModels(), ["b/reason", "b/plain"]);
    props = { ...props, models: [], selectedModelId: undefined, selectedEffort: undefined };
    await act(async () => root.render(<Probe />));
    assert.equal(radioGroups()[0]!.props.value, "");
    props = { ...props, models, selectedModelId: "a/reason" };
    await act(async () => root.render(<Probe />));
    assert.deepEqual(
      radioGroups().map((group) => group.props.value),
      ["a", "a/reason", ""],
    );
  } finally {
    await act(async () => root.unmount());
    environment.restore();
  }
});
