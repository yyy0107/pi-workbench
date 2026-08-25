import assert from "node:assert/strict";
import test from "node:test";

import { MemoryArtifactPreviewService } from "./artifact-preview-service";

test("isolates artifacts with the same id across threads", () => {
  const service = new MemoryArtifactPreviewService();
  const firstScope = { type: "thread", key: "thread-1" } as const;
  const secondScope = { type: "thread", key: "thread-2" } as const;

  service.upsertArtifact({
    id: "report",
    scope: firstScope,
    title: "First report",
    rendererKind: "markdown",
    content: "first thread",
    updatedAt: 1,
  });
  service.upsertArtifact({
    id: "report",
    scope: secondScope,
    title: "Second report",
    rendererKind: "markdown",
    content: "second thread",
    updatedAt: 2,
  });

  assert.equal(service.getArtifact({ id: "report", scope: firstScope })?.content, "first thread");
  assert.equal(service.getArtifact({ id: "report", scope: secondScope })?.content, "second thread");
});

test("includes the scope type and application key in artifact identity", () => {
  const service = new MemoryArtifactPreviewService();
  const threadScope = { type: "thread", key: "shared-key" } as const;
  const firstApplicationScope = { type: "application", key: "shared-key" } as const;
  const secondApplicationScope = { type: "application", key: "other-application" } as const;

  for (const [scope, content] of [
    [threadScope, "thread"],
    [firstApplicationScope, "first application"],
    [secondApplicationScope, "second application"],
  ] as const) {
    service.upsertArtifact({
      id: "report",
      scope,
      title: "Report",
      rendererKind: "markdown",
      content,
      updatedAt: 1,
    });
  }

  assert.equal(service.getArtifact({ id: "report", scope: threadScope })?.content, "thread");
  assert.equal(
    service.getArtifact({ id: "report", scope: firstApplicationScope })?.content,
    "first application",
  );
  assert.equal(
    service.getArtifact({ id: "report", scope: secondApplicationScope })?.content,
    "second application",
  );
});
