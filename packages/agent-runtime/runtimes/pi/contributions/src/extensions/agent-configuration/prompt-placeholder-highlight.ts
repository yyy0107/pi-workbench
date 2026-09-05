const HIGHLIGHT_NAME = "pi-prompt-placeholder";
const PLACEHOLDER =
  /\{\{pi\.(?:cwd|terminal_environment|tools|tool_guidelines|readme|docs|examples)\}\}/gu;

export function highlightPromptPlaceholders(container: HTMLElement): () => void {
  if (!globalThis.CSS?.highlights || typeof Highlight === "undefined") return () => {};

  const highlight = CSS.highlights.get(HIGHLIGHT_NAME) ?? new Highlight();
  CSS.highlights.set(HIGHLIGHT_NAME, highlight);
  let ranges: Range[] = [];
  const clear = () => {
    for (const range of ranges) highlight.delete(range);
    ranges = [];
  };
  const update = () => {
    clear();
    // Match across Shiki spans without changing the text, DOM, or textarea layout.
    for (const content of container.querySelectorAll(
      '[data-workbench-code] pre, [data-slot="markdown-preview"] article',
    )) {
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      const text = nodes.map((node) => node.data).join("");
      let index = 0;
      let offset = 0;
      for (const match of text.matchAll(PLACEHOLDER)) {
        while (offset + nodes[index].length <= match.index) offset += nodes[index++].length;
        const range = document.createRange();
        range.setStart(nodes[index], match.index - offset);
        const end = match.index + match[0].length;
        while (offset + nodes[index].length < end) offset += nodes[index++].length;
        range.setEnd(nodes[index], end - offset);
        highlight.add(range);
        ranges.push(range);
      }
    }
  };
  update();
  // Markdown and syntax highlighting finish asynchronously after React renders.
  const observer = new MutationObserver(update);
  observer.observe(container, { childList: true, characterData: true, subtree: true });
  return () => {
    observer.disconnect();
    clear();
  };
}
