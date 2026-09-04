import assert from "node:assert/strict";
import test from "node:test";

import { WorkbenchAgentCapabilityError } from "@workbench/agent-runtime-client/capabilities";
import { createI18n } from "@workbench/shell/i18n/runtime";

import { automationSaveErrorMessage } from "./automation-save-error";

test("automation save failures explain conflicts and validation details in both base languages", () => {
  const cases = [
    {
      error: new WorkbenchAgentCapabilityError("conflict", { currentRevision: 2 }),
      "en-US": "This task changed elsewhere. Reload it before saving again.",
      "zh-CN": "此任务已在别处修改，请重新加载后再保存。",
    },
    {
      error: new WorkbenchAgentCapabilityError("invalid-request", {
        field: "schedule",
        reason: "invalid-cron-or-timezone",
      }),
      "en-US": "The schedule is invalid. Check the Cron expression and timezone.",
      "zh-CN": "调度配置无效，请检查 Cron 表达式和时区。",
    },
    {
      error: new WorkbenchAgentCapabilityError("invalid-request", { field: "name" }),
      "en-US": "Enter a task title.",
      "zh-CN": "请输入任务标题。",
    },
    {
      error: new WorkbenchAgentCapabilityError("invalid-request", { field: "prompt" }),
      "en-US": "Enter task instructions.",
      "zh-CN": "请输入任务指令。",
    },
    {
      error: new WorkbenchAgentCapabilityError("invalid-request", { field: "workspaceId" }),
      "en-US": "Select a trusted workspace.",
      "zh-CN": "请选择一个可信工作区。",
    },
    {
      error: new WorkbenchAgentCapabilityError("invalid-request", {
        field: "schedule.maxDurationSeconds",
        reason: "out-of-range",
      }),
      "en-US": "Enter a whole number from 1 to 525,600, or leave the field blank.",
      "zh-CN": "请输入 1 到 525,600 之间的整数，或将此项留空。",
    },
    {
      error: new WorkbenchAgentCapabilityError("invalid-request", { field: "unknown-field" }),
      "en-US": "The task configuration is invalid. Check the fields and try again.",
      "zh-CN": "任务配置无效，请检查填写内容后重试。",
    },
  ];
  for (const locale of ["en-US", "zh-CN"] as const) {
    const { t } = createI18n(locale);
    for (const entry of cases) {
      assert.equal(automationSaveErrorMessage(entry.error, t, true), entry[locale]);
    }
    for (const error of [
      new WorkbenchAgentCapabilityError("failed"),
      new WorkbenchAgentCapabilityError("unavailable"),
      new Error("internal server detail"),
      undefined,
    ]) {
      assert.equal(
        automationSaveErrorMessage(error, t, false),
        t("extensions.automations.automationTask.createFailed"),
      );
      assert.equal(
        automationSaveErrorMessage(error, t, true),
        t("extensions.automations.automationTask.saveFailed"),
      );
    }
  }
});
