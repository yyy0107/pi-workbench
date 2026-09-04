import assert from "node:assert/strict";
import test from "node:test";

import {
  focusFirstInvalidAutomationField,
  type AutomationInvalidFocusTargets,
} from "./automation-invalid-focus";

function targets(installation: string, calls: string[]): AutomationInvalidFocusTargets {
  const focusable = (field: string) => ({ focus: () => calls.push(`${installation}:${field}`) });
  return {
    title: focusable("title"),
    addSchedule: focusable("addSchedule"),
    customCron: focusable("customCron"),
    time: focusable("time"),
    maxRunDuration: focusable("maxRunDuration"),
    prompt: focusable("prompt"),
    workspace: focusable("workspace"),
  };
}

test("an invalid submit focuses only the owning AutomationTaskForm installation", () => {
  const calls: string[] = [];
  targets("first", calls);
  const second = targets("second", calls);

  const focused = focusFirstInvalidAutomationField(
    {
      titleMissing: false,
      hasSchedule: true,
      customCronInvalid: false,
      scheduleUsesTime: true,
      timeInvalid: false,
      maxRunDurationInvalid: false,
      promptMissing: false,
      workspaceMissing: true,
    },
    second,
  );

  assert.equal(focused, "workspace");
  assert.deepEqual(calls, ["second:workspace"]);
});

test("invalid automation focus preserves form validation order", () => {
  const calls: string[] = [];
  const focused = focusFirstInvalidAutomationField(
    {
      titleMissing: false,
      hasSchedule: true,
      customCronInvalid: true,
      scheduleUsesTime: true,
      timeInvalid: true,
      maxRunDurationInvalid: true,
      promptMissing: true,
      workspaceMissing: true,
    },
    targets("form", calls),
  );

  assert.equal(focused, "customCron");
  assert.deepEqual(calls, ["form:customCron"]);
});
