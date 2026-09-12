import assert from "node:assert/strict";
import test from "node:test";
import { IncrementalMarkdownParser } from "./incremental-markdown";
import { isUnclosedFence, needsDocumentParse, parseMarkdown } from "./markdown-pipeline";

function withoutPositions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutPositions);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "position")
        .map(([key, item]) => [key, withoutPositions(item)]),
    );
  return value;
}

test("incremental chunks preserve GFM, Chinese, math and stable source keys", () => {
  const source =
    "# 测试\n\n中文 **加粗** 与 emoji 👨‍👩‍👧‍👦。\n\n- one\n- two\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n$$\nx^2\n$$\n\n```ts\nconst a = 1;\n```\n\nDone.";
  for (const step of [1, 7, 37, 1000]) {
    const parser = new IncrementalMarkdownParser(parseMarkdown);
    for (let end = 1; end < source.length; end += step) parser.update(source.slice(0, end));
    const final = parser.update(source);
    const blocks = [...final.frozen, ...final.tail];
    assert.deepEqual(
      withoutPositions(blocks.map((block) => block.node)),
      withoutPositions(parseMarkdown(source).children),
    );
    assert.equal(new Set(blocks.map((block) => block.key)).size, blocks.length);
    assert.equal(parser.update(source), final);
  }
});

test("completed paragraphs are frozen by identity and only a bounded tail is parsed", () => {
  const lengths: number[] = [];
  const parser = new IncrementalMarkdownParser((source) => {
    lengths.push(source.length);
    return parseMarkdown(source);
  });
  let source = "";
  let first;
  for (let i = 0; i < 100; i += 1) {
    source += `Paragraph ${i} 中文。\n\n`;
    const value = parser.update(source);
    if (value.frozen.length > 0) {
      first ??= value.frozen[0].node;
      assert.equal(value.frozen[0].node, first);
    }
  }
  assert.ok(Math.max(...lengths.slice(5)) < 120);
  const reset = parser.update("Replacement answer.");
  assert.equal(reset.frozen.length, 0);
  assert.ok(reset.generation > 0);
});

test("an 800-line open fence parses bounded slices and closes correctly", () => {
  const lengths: number[] = [];
  const parser = new IncrementalMarkdownParser((source) => {
    lengths.push(source.length);
    return parseMarkdown(source);
  });
  let source = "```ts\n";
  parser.update(source);
  for (let i = 0; i < 800; i += 1) {
    source += `const value${i} = ${i}; // 中文\n`;
    parser.update(source);
  }
  assert.ok(Math.max(...lengths.slice(10)) < 130);
  assert.ok(lengths.reduce((sum, value) => sum + value, 0) < source.length * 5);
  source += "```\n\nFinished.";
  const value = parser.update(source);
  assert.deepEqual(
    withoutPositions([...value.frozen, ...value.tail].map((block) => block.node)),
    withoutPositions(parseMarkdown(source).children),
  );
});

test("document-wide constructs and incomplete fences are identified", () => {
  for (const source of [
    "[ref]: https://example.com",
    "[^note]: Footnote",
    "<div>\n\ncontent\n\n</div>",
  ])
    assert.equal(needsDocumentParse(source), true);
  assert.equal(needsDocumentParse("ordinary **text**\n\nnext"), false);
  assert.equal(isUnclosedFence("```ts\nconst x = 1;\n"), true);
  assert.equal(isUnclosedFence("```ts\nconst x = 1;\n```"), false);
  assert.equal(isUnclosedFence("~~~~js\ncode\n~~~"), true);
  assert.equal(isUnclosedFence("~~~~js\ncode\n~~~~~\n"), false);
});
