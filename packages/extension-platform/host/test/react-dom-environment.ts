interface ReactDomGlobals {
  document?: unknown;
  HTMLElement?: unknown;
  HTMLIFrameElement?: unknown;
  IS_REACT_ACT_ENVIRONMENT?: unknown;
  window?: unknown;
}

/** Small DOM surface sufficient for this package's React lifecycle contract tests. */
export function installMinimalReactDomEnvironment(): {
  container: Element;
  restore(): void;
} {
  const globalObject = globalThis as typeof globalThis & ReactDomGlobals;
  const keys = [
    "document",
    "HTMLElement",
    "HTMLIFrameElement",
    "IS_REACT_ACT_ENVIRONMENT",
    "window",
  ] as const;
  const previousDescriptors = new Map(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalObject, key)]),
  );
  const noop = () => undefined;
  class FakeElement {}
  class FakeIFrameElement extends FakeElement {}
  const windowFixture: Record<string, unknown> = {
    event: undefined,
    HTMLElement: FakeElement,
    HTMLIFrameElement: FakeIFrameElement,
  };
  const documentFixture: Record<string, unknown> = {
    activeElement: null,
    addEventListener: noop,
    body: null,
    defaultView: windowFixture,
    documentElement: { namespaceURI: "http://www.w3.org/1999/xhtml" },
    nodeType: 9,
    removeEventListener: noop,
  };
  windowFixture.document = documentFixture;
  const container = Object.assign(new FakeElement(), {
    addEventListener: noop,
    appendChild: noop,
    insertBefore: noop,
    namespaceURI: "http://www.w3.org/1999/xhtml",
    nodeName: "DIV",
    nodeType: 1,
    ownerDocument: documentFixture,
    parentNode: null,
    removeChild: noop,
    removeEventListener: noop,
    tagName: "DIV",
    textContent: "",
  });
  documentFixture.body = container;

  Object.defineProperties(globalObject, {
    document: { configurable: true, value: documentFixture, writable: true },
    HTMLElement: { configurable: true, value: FakeElement, writable: true },
    HTMLIFrameElement: { configurable: true, value: FakeIFrameElement, writable: true },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true, writable: true },
    window: { configurable: true, value: windowFixture, writable: true },
  });

  return {
    container: container as unknown as Element,
    restore() {
      for (const key of keys) {
        const descriptor = previousDescriptors.get(key);
        if (descriptor) Object.defineProperty(globalObject, key, descriptor);
        else Reflect.deleteProperty(globalObject, key);
      }
    },
  };
}

export async function flushReactMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
