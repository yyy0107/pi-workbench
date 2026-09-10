import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "../i18n";
import { WorkbenchSettingsProvider, type WorkbenchSettingsPort } from "../settings";
import type { WorkbenchComposerCommandResponseDetails } from "@workbench/contracts/composer/request";

import { WorkbenchComposerCommandResponse } from "./composer-command-response";

const TEST_SETTINGS: WorkbenchSettingsPort = {
  async load() {
    return { locale: "zh-CN" };
  },
  async update() {},
};

function renderResponse(
  response: WorkbenchComposerCommandResponseDetails,
  compactionDetail?: string,
): string {
  return renderToStaticMarkup(
    createElement(WorkbenchSettingsProvider, {
      service: TEST_SETTINGS,
      children: createElement(I18nProvider, {
        initialLocale: "zh-CN",
        children: createElement(WorkbenchComposerCommandResponse, {
          response,
          compactionDetail,
        }),
      }),
    }),
  );
}

test("renders the compact lifecycle as a conversation separator without a command token", () => {
  const markup = renderResponse({
    version: 2,
    submissionId: "submission-compact",
    source: "agent",
    commandId: "compact",
    label: "压缩上下文",
    status: "execution-failed",
    args: { customInstructions: "你好" },
    failureReason: "context-too-small",
  });

  assert.match(markup, /data-slot="conversation-separator"/);
  assert.match(markup, /data-kind="compaction"/);
  assert.match(markup, /data-command="compact"/);
  assert.match(markup, /data-status="execution-failed"/);
  assert.match(markup, /role="alert"/);
  assert.doesNotMatch(markup, /aria-orientation/);
  assert.match(markup, /无法压缩会话上下文/);
  assert.match(markup, /当前上下文太短/);
  assert.doesNotMatch(markup, /data-slot="composer-command-token"/);
  assert.match(markup, /自定义指令/);
  assert.match(markup, /你好/);
  assert.doesNotMatch(markup, /data-workbench-glass-surface/);
});

test("keeps successful compaction token counts in the lifecycle separator", () => {
  const markup = renderResponse(
    {
      version: 2,
      submissionId: "submission-compact-success",
      source: "agent",
      commandId: "compact",
      label: "压缩上下文",
      status: "success",
    },
    "42K → 12K tokens",
  );

  assert.match(markup, /role="status"/);
  assert.match(markup, /会话上下文已压缩/);
  assert.match(markup, /42K → 12K tokens/);
  assert.match(markup, /<span>压缩原因：手动触发<\/span>/);
  assert.match(markup, /aria-label="[^"]*压缩原因：手动触发/);
  assert.doesNotMatch(markup, /data-slot="composer-command-token"/);
});

test("keeps non-compaction command responses in the result card", () => {
  const markup = renderResponse({
    version: 2,
    submissionId: "submission-reload",
    source: "agent",
    commandId: "reload",
    label: "重新加载资源",
    status: "execution-failed",
    failureReason: "reload-failed",
  });

  assert.match(markup, /data-workbench-glass-surface/);
  assert.match(markup, /data-command="reload"/);
  assert.doesNotMatch(markup, /data-kind="compaction"/);
});

test("shows the effective configuration after reload", () => {
  const markup = renderResponse({
    version: 2,
    submissionId: "submission-reload-success",
    source: "agent",
    commandId: "reload",
    label: "重新加载资源",
    status: "success",
    reloadConfiguration: {
      extensions: ["/project/.pi/extensions/review.ts"],
      skills: ["react"],
      prompts: ["review"],
      contextFiles: ["/project/AGENTS.md"],
    },
  });

  assert.match(markup, /data-slot="composer-reload-configuration"/);
  assert.match(markup, /重新加载后的配置/);
  assert.match(markup, /扩展/);
  assert.match(markup, /<code[^>]*>\/project\/\.pi\/extensions\/review\.ts<\/code>/);
  assert.match(markup, /Skills/);
  assert.match(markup, /react/);
  assert.match(markup, /提示词/);
  assert.match(markup, /\/review/);
  assert.match(markup, /上下文文件/);
  assert.match(markup, /<code[^>]*>\/project\/AGENTS\.md<\/code>/);
});
