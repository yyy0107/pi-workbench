import assert from "node:assert/strict";
import test from "node:test";
import { GitReviewChanges } from "./git-review-service";

test("invalidates only the changed repository and installation, and stops after disposal", () => {
  const first = new GitReviewChanges();
  const second = new GitReviewChanges();
  let notifications = 0;
  const unsubscribe = first.subscribe(() => notifications++);
  first.noteChanged("one");
  assert.equal(first.getRevision("one"), 1);
  assert.equal(first.getRevision("two"), 0);
  assert.equal(second.getRevision("one"), 0);
  assert.equal(notifications, 1);
  unsubscribe();
  first.noteChanged("one");
  assert.equal(first.getRevision("one"), 2);
  assert.equal(notifications, 1);
  first.dispose();
  first.noteChanged("one");
  assert.equal(first.getRevision("one"), 0);
});
