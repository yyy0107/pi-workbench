import assert from "node:assert/strict";
import test from "node:test";

import { PiResourceCatalogRevision } from "../../src/runtime/resource-catalog-revision";

test("resource catalog revisions are isolated per installation", () => {
  const first = new PiResourceCatalogRevision();
  const second = new PiResourceCatalogRevision();
  let firstNotifications = 0;
  let secondNotifications = 0;
  const unsubscribeFirst = first.subscribe(() => {
    firstNotifications += 1;
  });
  const unsubscribeSecond = second.subscribe(() => {
    secondNotifications += 1;
  });

  first.invalidate();
  assert.equal(first.getRevision(), 1);
  assert.equal(second.getRevision(), 0);
  assert.equal(firstNotifications, 1);
  assert.equal(secondNotifications, 0);

  second.invalidate();
  assert.equal(first.getRevision(), 1);
  assert.equal(second.getRevision(), 1);
  assert.equal(firstNotifications, 1);
  assert.equal(secondNotifications, 1);

  unsubscribeFirst();
  unsubscribeSecond();
});
