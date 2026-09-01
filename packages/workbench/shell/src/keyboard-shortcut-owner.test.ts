import assert from "node:assert/strict";
import test from "node:test";

import { shellOwnsKeyboardEvent } from "./keyboard-shortcut-owner";

interface FakeDocument {
  activeElement: FakeNode | null;
  roots: FakeNode[];
  querySelectorAll(): FakeNode[];
}

interface FakeNode {
  nodeType: number;
  ownerDocument: FakeDocument;
  children: Set<FakeNode>;
  contains(candidate: FakeNode): boolean;
}

function createFixture() {
  const documentFixture: FakeDocument = {
    activeElement: null,
    roots: [],
    querySelectorAll() {
      return this.roots;
    },
  };
  const createNode = (): FakeNode => {
    const node: FakeNode = {
      nodeType: 1,
      ownerDocument: documentFixture,
      children: new Set(),
      contains(candidate) {
        return candidate === node || node.children.has(candidate);
      },
    };
    return node;
  };
  return { createNode, documentFixture };
}

test("keyboard shortcut ownership selects one focused Shell and preserves a single-root fallback", () => {
  const { createNode, documentFixture } = createFixture();
  const firstRoot = createNode();
  const secondRoot = createNode();
  const firstChild = createNode();
  const secondChild = createNode();
  firstRoot.children.add(firstChild);
  secondRoot.children.add(secondChild);
  documentFixture.roots = [firstRoot, secondRoot];

  assert.equal(
    shellOwnsKeyboardEvent(
      firstRoot as unknown as HTMLElement,
      { target: firstChild } as unknown as Event,
    ),
    true,
  );
  assert.equal(
    shellOwnsKeyboardEvent(
      secondRoot as unknown as HTMLElement,
      { target: firstChild } as unknown as Event,
    ),
    false,
  );

  documentFixture.activeElement = secondChild;
  assert.equal(
    shellOwnsKeyboardEvent(secondRoot as unknown as HTMLElement, { target: null }),
    true,
  );
  assert.equal(
    shellOwnsKeyboardEvent(firstRoot as unknown as HTMLElement, { target: null }),
    false,
  );

  documentFixture.activeElement = null;
  documentFixture.roots = [firstRoot];
  assert.equal(shellOwnsKeyboardEvent(firstRoot as unknown as HTMLElement, { target: null }), true);
});

test("keyboard shortcut ownership follows only the originating Shell portal container", () => {
  const { createNode, documentFixture } = createFixture();
  const firstRoot = createNode();
  const secondRoot = createNode();
  const firstPortal = createNode();
  const secondPortal = createNode();
  const firstPortalContent = createNode();
  firstPortal.children.add(firstPortalContent);
  documentFixture.roots = [firstRoot, secondRoot];

  assert.equal(
    shellOwnsKeyboardEvent(
      firstRoot as unknown as HTMLElement,
      { target: firstPortalContent } as unknown as Event,
      firstPortal as unknown as HTMLElement,
    ),
    true,
  );
  assert.equal(
    shellOwnsKeyboardEvent(
      secondRoot as unknown as HTMLElement,
      { target: firstPortalContent } as unknown as Event,
      secondPortal as unknown as HTMLElement,
    ),
    false,
  );

  documentFixture.activeElement = firstPortalContent;
  assert.equal(
    shellOwnsKeyboardEvent(
      firstRoot as unknown as HTMLElement,
      { target: null },
      firstPortal as unknown as HTMLElement,
    ),
    true,
  );
  assert.equal(
    shellOwnsKeyboardEvent(
      secondRoot as unknown as HTMLElement,
      { target: null },
      secondPortal as unknown as HTMLElement,
    ),
    false,
  );
});
