import assert from "node:assert/strict";
import test from "node:test";

import {
  getPiResourceCatalogRevision,
  invalidatePiResourceCatalog,
  subscribePiResourceCatalog,
} from "./resource-catalog-revision";

test("invalidates every Pi resource catalog subscriber through one shared revision", () => {
  const initialRevision = getPiResourceCatalogRevision();
  let notifications = 0;
  const unsubscribe = subscribePiResourceCatalog(() => {
    notifications += 1;
  });

  invalidatePiResourceCatalog();
  assert.equal(getPiResourceCatalogRevision(), initialRevision + 1);
  assert.equal(notifications, 1);

  unsubscribe();
  invalidatePiResourceCatalog();
  assert.equal(getPiResourceCatalogRevision(), initialRevision + 2);
  assert.equal(notifications, 1);
});
