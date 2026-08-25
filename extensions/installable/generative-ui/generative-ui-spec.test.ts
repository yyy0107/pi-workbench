import assert from "node:assert/strict";
import test from "node:test";

import { readGenerativeUISpec } from "./generative-ui-spec";

const playlistSpec = {
  $type: "Card",
  children: [
    {
      $type: "Image",
      src: "https://images.example.test/cover.jpg",
      alt: "Album cover",
    },
    {
      $type: "ListView",
      children: [
        {
          $type: "ListViewItem",
          $action: { type: "play_track", trackId: "track-1" },
          children: { $type: "Text", value: "Morning Light" },
        },
      ],
    },
  ],
};

test("accepts a complete allowlisted $type tree", () => {
  assert.deepEqual(readGenerativeUISpec(JSON.stringify(playlistSpec)), playlistSpec);
});

test("accepts a single fenced JSON tree", () => {
  const text = `\`\`\`json\n${JSON.stringify(playlistSpec)}\n\`\`\``;
  assert.deepEqual(readGenerativeUISpec(text), playlistSpec);
});

test("keeps ordinary JSON and mixed prose on the text renderer", () => {
  assert.equal(readGenerativeUISpec('{"tracks":[]}'), undefined);
  assert.equal(readGenerativeUISpec(`Playlist:\n${JSON.stringify(playlistSpec)}`), undefined);
});

test("rejects unknown components and unsafe image sources", () => {
  assert.equal(readGenerativeUISpec({ $type: "Script", children: [] }), undefined);
  assert.equal(
    readGenerativeUISpec({ $type: "Image", src: "javascript:alert(1)", alt: "" }),
    undefined,
  );
});
