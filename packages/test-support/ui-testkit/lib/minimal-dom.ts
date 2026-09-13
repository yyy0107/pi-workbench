/** Build the small DOM objects consumed by the installation API. */
export function createMinimalDom() {
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

  return { container, documentFixture, windowFixture, FakeElement, FakeIFrameElement };
}
