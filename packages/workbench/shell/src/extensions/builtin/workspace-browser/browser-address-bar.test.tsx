import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import {
  Children,
  act,
  isValidElement,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { createRoot } from "react-dom/client";
import type { BrowserCommand, BrowserHistoryEntry } from "@workbench/browser-contracts";

import { installMinimalReactDomEnvironment } from "../../../../test/react-dom-environment";
import { I18nProvider } from "../../../i18n";
import { WorkbenchSettingsProvider } from "../../../settings";
import {
  SearchableSelectorInput,
  SearchableSelectorList,
  SearchableSelectorStatus,
} from "../../../ui/searchable-selector";
import { BrowserAddressBar } from "./browser-address-bar";
import { MemoryBrowserSessionService } from "./browser-session-service";

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<{ children?: ReactNode }>(child)
      ? [child, ...elements(child.props.children)]
      : [],
  );
}

test("address history preserves drafts, ignores stale queries, and opens the selected URL", async () => {
  const dom = installMinimalReactDomEnvironment();
  const requests: {
    command: BrowserCommand;
    resolve(entries: BrowserHistoryEntry[]): void;
    reject(error: Error): void;
  }[] = [];
  class Browser extends MemoryBrowserSessionService {
    override command<T>(command: BrowserCommand): Promise<T> {
      return new Promise((resolve, reject) => {
        requests.push({ command, resolve: (entries) => resolve(entries as T), reject });
      });
    }
  }
  const browser = new Browser();
  const root = createRoot(dom.container);
  const navigated: string[] = [];
  const url = "https://example.com/current?full=address";
  let tree!: ReturnType<typeof BrowserAddressBar>;
  let selected = 0;
  let blurred = 0;
  function Probe() {
    const [value, setValue] = useState(url);
    tree = BrowserAddressBar({
      browser,
      value,
      url,
      showFullUrl: false,
      onChange: setValue,
      onNavigate: (address) => navigated.push(address),
    });
    return null;
  }
  const input = () => {
    const element = elements(tree).find((candidate) => candidate.type === SearchableSelectorInput);
    assert.ok(element);
    return element as ReactElement<ComponentProps<typeof SearchableSelectorInput>>;
  };
  const focus = async () => {
    await act(async () => input().props.onFocus?.({} as never));
    await act(async () => {
      await setTimeout(5);
    });
  };
  const change = (value: string) =>
    act(async () => tree.props.onInputValueChange(value, { reason: "input-change" }));
  const key = (value: string) => {
    const prevented = { base: false, default: false, propagation: false };
    input().props.onKeyDown?.({
      key: value,
      nativeEvent: { isComposing: false },
      preventBaseUIHandler() {
        prevented.base = true;
      },
      preventDefault() {
        prevented.default = true;
      },
      stopPropagation() {
        prevented.propagation = true;
      },
    } as never);
    return prevented;
  };

  try {
    await act(async () => {
      root.render(
        <WorkbenchSettingsProvider service={{ load: async () => ({}), update: async () => {} }}>
          <I18nProvider initialLocale="en-US">
            <Probe />
          </I18nProvider>
        </WorkbenchSettingsProvider>,
      );
    });
    (input().props.ref as RefObject<HTMLInputElement | null>).current = {
      select: () => selected++,
      blur: () => {
        blurred++;
        input().props.onBlur?.({} as never);
      },
    } as unknown as HTMLInputElement;
    assert.equal(tree.props.inputValue, "example.com");
    assert.equal(tree.props.open, false);
    assert.equal(requests.length, 0);

    await focus();
    assert.equal(tree.props.inputValue, url);
    assert.equal(selected, 1);
    assert.deepEqual(requests[0]?.command, { type: "history.list", query: "" });

    await change("past");
    await act(async () => {
      requests[0]!.resolve([{ url: "https://stale.example/", title: "Stale", time: 1 }]);
      await setTimeout(175);
    });
    assert.deepEqual(requests[1]?.command, { type: "history.list", query: "past" });
    assert.deepEqual(tree.props.items, [], "a previous response cannot replace the new query");
    const entry = { url: "https://past.example/details", title: "Past page", time: 2 };
    await act(async () => requests[1]!.resolve([entry]));
    assert.deepEqual(tree.props.items, [entry]);
    assert.equal(tree.props.filter, null, "the host searches the whole profile history");
    const list = elements(tree).find((element) => element.type === SearchableSelectorList);
    assert.ok(list);
    const row = (list.props.children as (item: BrowserHistoryEntry) => ReactElement)(entry);
    assert.ok(elements(row).some((element) => element.props.children === entry.title));
    assert.ok(elements(row).some((element) => element.props.children === entry.url));

    await act(async () => {
      tree.props.onItemHighlighted(entry);
      assert.deepEqual(key("Enter"), { base: false, default: false, propagation: false });
      assert.deepEqual(navigated, [], "the shared combobox commits highlighted entries");
      tree.props.onValueChange(entry);
    });
    assert.deepEqual(navigated, [entry.url]);
    assert.equal(tree.props.inputValue, entry.url);
    assert.equal(tree.props.open, false);
    assert.equal(blurred, 1);

    await focus();
    await change("https://typed.example/path");
    await act(async () => {
      assert.deepEqual(key("Enter"), { base: true, default: true, propagation: false });
    });
    assert.equal(navigated.at(-1), "https://typed.example/path");
    assert.equal(tree.props.open, false);

    await focus();
    await change("unfinished.example/draft");
    await act(async () => {
      assert.deepEqual(key("Escape"), { base: true, default: true, propagation: true });
    });
    assert.equal(tree.props.inputValue, "unfinished.example/draft");
    assert.equal(tree.props.open, false);
    assert.equal(navigated.length, 2, "closing suggestions leaves the draft unchanged");

    await focus();
    await act(async () => requests.at(-1)!.reject(new Error("Disconnected")));
    const status = elements(tree).find((element) => element.type === SearchableSelectorStatus);
    assert.equal(status?.props.children, "Could not load history");
    await act(async () => {
      key("Escape");
    });
    assert.equal(navigated.length, 2);
  } finally {
    await act(async () => root.unmount());
    dom.restore();
  }
});
