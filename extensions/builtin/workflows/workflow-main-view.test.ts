import assert from "node:assert/strict";
import test from "node:test";

import { workflowMainViewRequest } from "./workflow-main-view";

test("automation creation uses the automation task breadcrumb", () => {
  const request = workflowMainViewRequest({ page: "automation-create" });

  assert.deepEqual(request.title, {
    key: "extensions.workflows.breadcrumb.newTask",
  });
  assert.deepEqual(request.breadcrumbs, [
    {
      label: { key: "extensions.workflows.automationHome.title" },
      params: { page: "automations" },
    },
    { label: { key: "extensions.workflows.breadcrumb.newTask" } },
  ]);
});

test("automation editing keeps automation as the clickable breadcrumb parent", () => {
  const request = workflowMainViewRequest({ page: "automation-edit", workflowId: "automation-1" });

  assert.deepEqual(request.title, {
    key: "extensions.workflows.breadcrumb.editor",
  });
  assert.deepEqual(request.breadcrumbs, [
    {
      label: { key: "extensions.workflows.automationHome.title" },
      params: { page: "automations" },
    },
    { label: { key: "extensions.workflows.breadcrumb.editor" } },
  ]);
});

test("every workflow page makes the execution parent breadcrumb navigable", () => {
  const requests = [
    workflowMainViewRequest({ page: "create" }),
    workflowMainViewRequest({ page: "editor", workflowId: "workflow-1" }),
    workflowMainViewRequest({ page: "runs" }),
    workflowMainViewRequest({ page: "templates" }),
  ];

  for (const request of requests) {
    assert.deepEqual(request.breadcrumbs?.[0], {
      label: { key: "extensions.workflows.title" },
      closeView: true,
    });
  }
});
