import assert from "node:assert/strict";
import test from "node:test";

import { act, Fragment, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

import {
  flushReactMicrotasks,
  installMinimalReactDomEnvironment,
} from "../test/react-dom-environment";
import { WorkbenchDomIdsProvider, useWorkbenchDomIds, type WorkbenchDomIds } from "./dom";

function DomIdsProbe({ capture }: Readonly<{ capture(ids: WorkbenchDomIds): void }>) {
  capture(useWorkbenchDomIds());
  return null;
}

function installation(capture: (ids: WorkbenchDomIds) => void): ReactNode {
  return (
    <WorkbenchDomIdsProvider>
      <DomIdsProbe capture={capture} />
    </WorkbenchDomIdsProvider>
  );
}

test("Workbench DOM IDs are frozen, stable, and isolated per installation", async () => {
  const environment = installMinimalReactDomEnvironment();
  const root = createRoot(environment.container);
  const firstSnapshots: WorkbenchDomIds[] = [];
  const secondSnapshots: WorkbenchDomIds[] = [];
  const captureFirst = (ids: WorkbenchDomIds) => firstSnapshots.push(ids);
  const captureSecond = (ids: WorkbenchDomIds) => secondSnapshots.push(ids);
  const tree = () => (
    <Fragment>
      {installation(captureFirst)}
      {installation(captureSecond)}
    </Fragment>
  );

  try {
    await act(async () => {
      root.render(tree());
      await flushReactMicrotasks();
    });
    await act(async () => {
      root.render(tree());
      await flushReactMicrotasks();
    });

    const first = firstSnapshots.at(-1);
    const second = secondSnapshots.at(-1);
    assert.ok(first);
    assert.ok(second);
    assert.equal(Object.isFrozen(first), true);
    assert.equal(Object.isFrozen(second), true);
    assert.ok(firstSnapshots.length >= 2);
    assert.ok(secondSnapshots.length >= 2);
    assert.equal(
      firstSnapshots.every((ids) => ids === first),
      true,
    );
    assert.equal(
      secondSnapshots.every((ids) => ids === second),
      true,
    );
    assert.notEqual(first, second);
    assert.notEqual(first.rightWorkspace, second.rightWorkspace);
    assert.notEqual(first.rightWorkspaceAuxiliaryPane, second.rightWorkspaceAuxiliaryPane);
    assert.notEqual(first.rightWorkspaceTabIdPrefix, second.rightWorkspaceTabIdPrefix);
    assert.notEqual(first.rightWorkspaceTabPanelIdPrefix, second.rightWorkspaceTabPanelIdPrefix);
  } finally {
    await act(async () => root.unmount());
    environment.restore();
  }
});

test("Workbench DOM ID consumers fail outside an installation provider", () => {
  assert.throws(
    () => renderToStaticMarkup(<DomIdsProbe capture={() => undefined} />),
    /useWorkbenchDomIds must be used within WorkbenchDomIdsProvider/u,
  );
});
