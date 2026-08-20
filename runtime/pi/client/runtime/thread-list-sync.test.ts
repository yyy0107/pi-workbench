import assert from "node:assert/strict";
import test from "node:test";

import { piThreadListStructureMatches } from "./thread-list-sync";

const managed = [
  { remoteId: "thread-a", status: "regular" as const },
  { remoteId: "thread-b", status: "regular" as const },
  { remoteId: "thread-c", status: "archived" as const },
];

test("thread-list structure ignores metadata-only changes", () => {
  assert.equal(
    piThreadListStructureMatches(managed, {
      threadIds: ["thread-a", "thread-b"],
      archivedThreadIds: ["thread-c"],
      threadItems: [
        {
          id: "thread-a",
          remoteId: "thread-a",
          externalId: "thread-a",
          status: "regular",
        },
        {
          id: "thread-b",
          remoteId: "thread-b",
          externalId: "thread-b",
          status: "regular",
        },
        {
          id: "thread-c",
          remoteId: "thread-c",
          externalId: "thread-c",
          status: "archived",
        },
      ],
    }),
    true,
  );
});

test("a promoted local thread matches its remote manager identity", () => {
  assert.equal(
    piThreadListStructureMatches([{ remoteId: "thread-new", status: "regular" }], {
      threadIds: ["__LOCALID_draft"],
      archivedThreadIds: [],
      threadItems: [
        {
          id: "__LOCALID_draft",
          remoteId: "thread-new",
          externalId: "thread-new",
          status: "regular",
        },
      ],
    }),
    true,
  );
});

test("an unresolved empty draft does not count as persisted list structure", () => {
  assert.equal(
    piThreadListStructureMatches([], {
      threadIds: ["__LOCALID_draft"],
      archivedThreadIds: [],
      threadItems: [{ id: "__LOCALID_draft", status: "new" }],
    }),
    true,
  );
});

test("remote creation, archive, and reorder require reconciliation", () => {
  const baseAssistant = {
    threadItems: [
      { id: "thread-a", remoteId: "thread-a", status: "regular" as const },
      { id: "thread-b", remoteId: "thread-b", status: "regular" as const },
      { id: "thread-c", remoteId: "thread-c", status: "archived" as const },
    ],
  };

  assert.equal(
    piThreadListStructureMatches([{ remoteId: "thread-new", status: "regular" }, ...managed], {
      ...baseAssistant,
      threadIds: ["thread-a", "thread-b"],
      archivedThreadIds: ["thread-c"],
    }),
    false,
  );
  assert.equal(
    piThreadListStructureMatches(managed, {
      ...baseAssistant,
      threadIds: ["thread-a"],
      archivedThreadIds: ["thread-b", "thread-c"],
    }),
    false,
  );
  assert.equal(
    piThreadListStructureMatches(managed, {
      ...baseAssistant,
      threadIds: ["thread-b", "thread-a"],
      archivedThreadIds: ["thread-c"],
    }),
    false,
  );
});
