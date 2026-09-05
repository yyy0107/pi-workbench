import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

// Opt in when checking browser-native ranges; ordinary package tests need no browser.
const browser = process.env.PI_PROMPT_HIGHLIGHT_BROWSER;
test(
  "highlights prompt placeholders across syntax spans and preview updates",
  { skip: !browser },
  () => {
    const directory = mkdtempSync(path.join(tmpdir(), "pi-prompt-highlight-"));
    try {
      const source = stripTypeScriptTypes(
        readFileSync(new URL("./prompt-placeholder-highlight.ts", import.meta.url), "utf8"),
      );
      const css = readFileSync(
        new URL("./prompt-placeholder-highlight.module.css", import.meta.url),
        "utf8",
      );
      const file = path.join(directory, "test.html");
      writeFileSync(
        file,
        `<!doctype html>
      <style>:root { --info: blue; --info-foreground: navy; } ${css}</style>
      <div id="editor" class="promptEditor"><div data-workbench-code><pre>中文😀 <span>{{pi.</span><span>tool_guidelines}}</span> {{pi.cwd}} {{pi.terminal_environment}} {{pi.unknown}} {{pi.docs</pre></div><textarea>{{pi.cwd}}</textarea></div>
      <div id="preview" class="promptEditor"><div data-slot="markdown-preview"><article><p>{{pi.tools}} <code>{{pi.readme}}</code> {{pi.docs}} {{pi.examples}}</p></article></div></div>
      <output id="result"></output>
      <script type="module">
      ${source}
      const check = (condition, message) => { if (!condition) throw Error(message); };
      const tick = () => new Promise(resolve => setTimeout(resolve, 0));
      try {
        const editor = document.getElementById('editor');
        const preview = document.getElementById('preview');
        const original = editor.innerHTML;
        const width = editor.offsetWidth;
        const height = editor.offsetHeight;
        const clearEditor = highlightPromptPlaceholders(editor);
        const clearPreview = highlightPromptPlaceholders(preview);
        const highlight = CSS.highlights.get('pi-prompt-placeholder');
        const texts = () => [...highlight].map(range => range.toString());
        check(JSON.stringify(texts()) === JSON.stringify(['{{pi.tool_guidelines}}', '{{pi.cwd}}', '{{pi.terminal_environment}}', '{{pi.tools}}', '{{pi.readme}}', '{{pi.docs}}', '{{pi.examples}}']), 'Known tokens and split syntax spans');
        check(editor.innerHTML === original && editor.querySelector('textarea').value === '{{pi.cwd}}', 'Source and copy text preserved');
        check(editor.offsetWidth === width && editor.offsetHeight === height, 'No editor layout changes');
        const code = editor.querySelector('pre span');
        check(getComputedStyle(code, '::highlight(pi-prompt-placeholder)').color === 'rgb(0, 0, 128)', 'Theme highlight color');
        document.documentElement.style.setProperty('--info-foreground', 'cyan');
        check(getComputedStyle(code, '::highlight(pi-prompt-placeholder)').color === 'rgb(0, 255, 255)', 'Theme changes update highlights');
        preview.querySelector('article').textContent = '';
        await tick();
        check(highlight.size === 2, 'Preview replacement removes old ranges');
        clearEditor();
        check(highlight.size === 0, 'Editor cleanup removes its ranges');
        const text = document.createTextNode('{{pi.cwd}}');
        preview.querySelector('article').append(text);
        await tick();
        check(texts().join() === '{{pi.cwd}}' && CSS.highlights.get('pi-prompt-placeholder') === highlight, 'Empty sibling can later add highlights');
        text.data = '{{pi.tools}}';
        await tick();
        check(texts().join() === '{{pi.tools}}', 'Typing updates ranges');
        clearPreview();
        text.data = '{{pi.readme}}';
        await tick();
        check(highlight.size === 0, 'Unmount disconnects observer');
        document.getElementById('result').textContent = 'PASS';
      } catch (error) { document.getElementById('result').textContent = String(error); }
      </script>`,
      );
      const output = execFileSync(
        browser!,
        [
          "--headless",
          "--no-sandbox",
          "--disable-gpu",
          "--no-first-run",
          `--user-data-dir=${path.join(directory, "profile")}`,
          "--dump-dom",
          "--virtual-time-budget=3000",
          pathToFileURL(file).href,
        ],
        { encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "pipe"] },
      );
      assert.match(output, /<output id="result">PASS<\/output>/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
