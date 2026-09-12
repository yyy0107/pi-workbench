import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPOSER_COMMAND_ICON_COLOR_CLASSES,
  composerCommandIconColorClassName,
  composerCommandIconColorMap,
} from "./composer-command-icon-color";

test("uses the four command icon colors without adjacent duplicates", () => {
  assert.equal(COMPOSER_COMMAND_ICON_COLOR_CLASSES.length, 4);

  const items = ["a", "e", "i", "m"].map((id) => ({ id, type: "command" }));
  const colorBySuggestionKey = composerCommandIconColorMap(items);
  const colors = items.map((item) => colorBySuggestionKey.get(`${item.type}:${item.id}`));

  for (let index = 1; index < colors.length; index += 1) {
    assert.notEqual(colors[index], colors[index - 1]);
  }
  assert.equal(colors[0], composerCommandIconColorClassName(items[0]!.id));
});
