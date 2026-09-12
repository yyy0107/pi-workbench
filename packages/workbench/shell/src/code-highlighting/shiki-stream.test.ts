import assert from "node:assert/strict";
import test from "node:test";
import { createWorkbenchCodeStream, highlightWorkbenchCodeTokens } from "./shiki-highlighter";

test("streamed highlighting matches a full parse across multiline strings and comments", async () => {
  const stream = await createWorkbenchCodeStream("typescript", "github-light", "github-dark");
  const source = "/* start\n中文 comment\n*/\nconst text = `first\nsecond`;\nconsole.log(text);";
  let first;
  for (let end = 1; end <= source.length; end += 1) {
    const result = stream.update(source.slice(0, end));
    if (end > source.indexOf("\n")) {
      first ??= result[0];
      assert.equal(result[0], first);
    }
  }
  const result = stream.update(source);
  const full = await highlightWorkbenchCodeTokens(
    source,
    "typescript",
    "github-light",
    "github-dark",
  );
  const comparable = (tokens: typeof full) =>
    tokens.map((line) =>
      line.map(({ content, color, htmlStyle }) => ({ content, color, htmlStyle })),
    );
  assert.deepEqual(comparable(result), comparable(full));
  assert.equal(stream.update(source), result);
  const replacement = "const other = false;";
  assert.deepEqual(
    comparable(stream.update(replacement)),
    comparable(
      await highlightWorkbenchCodeTokens(replacement, "typescript", "github-light", "github-dark"),
    ),
  );
});

test("streamed code retains blank lines and handles split CRLF", async () => {
  const stream = await createWorkbenchCodeStream("typescript", "github-light", "github-dark");
  stream.update("// hello\r");
  const source = "// hello\r\n\r\nconst x = 1;\r\n";
  const lines = stream.update(source);
  assert.equal(
    lines.map((line) => line.map((token) => token.content).join("")).join("\n"),
    source.replaceAll("\r\n", "\n"),
  );
});
