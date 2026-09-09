import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { RuntimeProvider, SessionProvider } from "@workbench/agent-runtime-client";
import type { DataBlock } from "@workbench/agent-runtime-contracts/conversation";
import { I18nProvider, type Locale } from "@workbench/shell/i18n";
import { WorkbenchSettingsProvider } from "@workbench/shell/settings";
import { piTranslationBundle } from "../../i18n";
import { CacheMissAction, CacheMissBody, CacheMissNotice } from "./cache-miss-notice";

function render(data: DataBlock["data"], locale: Locale = "en-US") {
  return renderToStaticMarkup(
    <WorkbenchSettingsProvider service={{ load: async () => ({}), update: async () => undefined }}>
      <I18nProvider initialLocale={locale} bundles={[piTranslationBundle]}>
        <CacheMissNotice
          node={{ kind: "assistant", key: "assistant", status: "complete", blocks: [] }}
          block={{ kind: "data", key: "miss", name: "pi-cache-miss", data }}
          fallback={<span>fallback</span>}
        />
      </I18nProvider>
    </WorkbenchSettingsProvider>,
  );
}

test("cache miss notices localize estimates and causes, and never present unknown costs as zero", () => {
  const notice = { missedTokens: 10_000, missedCost: 0.027, idleMs: 360_000, modelChanged: true };
  const english = render(notice);
  assert.match(english, /role="status"/);
  assert.match(english, /10,000/);
  assert.match(english, /\$0\.0270/);
  assert.match(english, /model changed/);
  assert.match(english, /Idle for 6 minutes/);
  const chinese = render(notice, "zh-CN");
  assert.match(chinese, /提示词缓存缺失/);
  assert.match(chinese, /估算额外费用/);
  assert.match(chinese, /模型已切换/);
  const unknown = render({ ...notice, missedCost: 0, idleMs: 0, modelChanged: false });
  assert.match(unknown, /unavailable/);
  assert.doesNotMatch(unknown, /\$0\.0000|model changed|Idle for/);
  assert.equal(render({ ...notice, missedCost: NaN }), "<span>fallback</span>");
});

test("cache miss details are hidden in the body and exposed by an assistant action icon", () => {
  const block: DataBlock = {
    kind: "data",
    key: "miss",
    name: "pi-cache-miss",
    data: { missedTokens: 10_000, missedCost: 0.027, idleMs: 0, modelChanged: false },
  };
  const node = {
    kind: "assistant" as const,
    key: "assistant",
    status: "complete" as const,
    blocks: [block],
  };
  assert.equal(
    renderToStaticMarkup(
      <CacheMissBody node={node} block={block} fallback={<span>fallback</span>} />,
    ),
    "",
  );
  const source = (value: unknown) => ({ getSnapshot: () => value, subscribe: () => () => {} });
  const runtime = {
    current: source({ sessionId: "test" }),
    session: () => ({ id: "test", node: () => source(node) }),
  } as unknown as ComponentProps<typeof RuntimeProvider>["runtime"];
  function action(role: "assistant" | "user" = "assistant") {
    return renderToStaticMarkup(
      <RuntimeProvider runtime={runtime}>
        <SessionProvider>
          <WorkbenchSettingsProvider
            service={{ load: async () => ({}), update: async () => undefined }}
          >
            <I18nProvider initialLocale="en-US" bundles={[piTranslationBundle]}>
              <CacheMissAction messageId="assistant" role={role} isLast />
            </I18nProvider>
          </WorkbenchSettingsProvider>
        </SessionProvider>
      </RuntimeProvider>,
    );
  }
  assert.match(action(), /aria-label="Prompt cache miss"/);
  assert.doesNotMatch(action(), /10,000|\$0\.0270/);
  assert.equal(action("user"), "");
  node.blocks = [];
  assert.equal(action(), "");
});
