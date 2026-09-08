import assert from "node:assert/strict";
import test from "node:test";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  createEditor,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
} from "lexical";

import { registerComposerHistoryKeyboard } from "./composer-history-keyboard-plugin";

test("composer history consumes unmodified arrows only on the first or last logical line", () => {
  const editor = createEditor({
    onError: (error) => {
      throw error;
    },
  });
  const directions: string[] = [];
  let available = true;
  const unregister = registerComposerHistoryKeyboard(editor, (direction) => {
    directions.push(direction);
    return available;
  });
  const arrow = (up: boolean, options: Partial<KeyboardEvent> = {}) => {
    let prevented = false;
    let stopped = false;
    const event = {
      isComposing: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {
        stopped = true;
      },
      ...options,
    } as KeyboardEvent;
    const handled = editor.dispatchCommand(
      up ? KEY_ARROW_UP_COMMAND : KEY_ARROW_DOWN_COMMAND,
      event,
    );
    assert.equal(prevented, handled);
    assert.equal(stopped, handled);
    return handled;
  };

  editor.update(
    () => {
      const root = $getRoot();
      const first = $createTextNode("first");
      const middle = $createTextNode("middle");
      const last = $createTextNode("last");
      root.append(
        $createParagraphNode().append(first),
        $createParagraphNode().append(middle),
        $createParagraphNode().append(last),
      );

      first.select(0, 0);
      assert.equal(arrow(true), true);
      assert.equal(arrow(false), false);
      for (const key of ["isComposing", "altKey", "ctrlKey", "metaKey", "shiftKey"]) {
        assert.equal(arrow(true, { [key]: true }), false);
      }
      const isComposing = editor.isComposing;
      editor.isComposing = () => true;
      assert.equal(arrow(true), false);
      editor.isComposing = isComposing;

      first.select(0, 2);
      assert.equal(arrow(true), false);
      first.selectEnd();
      assert.equal(arrow(true), true);
      assert.equal(arrow(false), false);
      middle.select(2, 2);
      assert.equal(arrow(true), false);
      assert.equal(arrow(false), false);
      last.select(0, 0);
      assert.equal(arrow(true), false);
      assert.equal(arrow(false), true);
      last.selectEnd();
      assert.equal(arrow(false), true);
      assert.equal(arrow(true), false);

      available = false;
      assert.equal(arrow(false), false);
      available = true;
      $setSelection(null);
      assert.equal(arrow(true), false);

      root.clear().append($createParagraphNode());
      root.selectStart();
      assert.equal(arrow(true), true);
      assert.equal(arrow(false), true);

      const plain = $createTextNode("plain ");
      const bold = $createTextNode("bold").setFormat("bold");
      const finalLine = $createTextNode("final");
      root
        .clear()
        .append($createParagraphNode().append(plain, bold, $createLineBreakNode(), finalLine));
      bold.select(2, 2);
      const selection = $getSelection()?.clone();
      assert.equal(arrow(true), true);
      assert.equal(arrow(false), false);
      assert.equal(
        $getSelection()?.is(selection ?? null),
        true,
        "reading the line preserves selection",
      );
      finalLine.select(2, 2);
      assert.equal(arrow(true), false);
      assert.equal(arrow(false), true);

      root.clear().append($createParagraphNode().append($createTextNode("single line")));
      root.selectEnd();
      assert.equal(arrow(true), true);
      assert.equal(arrow(true), true, "history restored with selectEnd supports repeated up");
      assert.equal(arrow(false), true);

      const count = directions.length;
      const stopMenu = editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        () => true,
        COMMAND_PRIORITY_HIGH,
      );
      assert.equal(editor.dispatchCommand(KEY_ARROW_UP_COMMAND, {} as KeyboardEvent), true);
      assert.equal(directions.length, count);
      stopMenu();
      unregister();
      assert.equal(arrow(true), false);
    },
    { discrete: true },
  );
});
