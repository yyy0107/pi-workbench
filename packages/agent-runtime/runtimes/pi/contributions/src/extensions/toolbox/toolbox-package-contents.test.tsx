import assert from "node:assert/strict";
import test from "node:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@workbench/shell/i18n";
import { WorkbenchSettingsProvider } from "@workbench/shell/settings";
import { piTranslationBundle } from "../../i18n";
import { PackageUpdateRow } from "./toolbox-main-view";
import {
  ExtensionCapabilityDetailsPanel,
  PackageInstallContents,
  PackageResourceSections,
} from "./toolbox-capability-presentation";

function renderContent(content: ReactNode, locale: "en-US" | "zh-CN" = "en-US") {
  return renderToStaticMarkup(
    <WorkbenchSettingsProvider service={{ load: async () => ({}), update: async () => undefined }}>
      <I18nProvider initialLocale={locale} bundles={[piTranslationBundle]}>
        {content}
      </I18nProvider>
    </WorkbenchSettingsProvider>,
  );
}

test("update rows expose separate details and update actions, pending progress, failure retry, and success", () => {
  const props = {
    item: {
      source: "npm:example",
      displayName: "example",
      type: "npm" as const,
      scope: "user" as const,
      filtered: false,
      currentVersion: "1.0.0",
      targetVersion: "1.1.0",
    },
    onOpen: () => undefined,
    onUpdate: () => undefined,
  };
  const ready = renderContent(<PackageUpdateRow {...props} />);
  const buttons = [...ready.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)];
  assert.equal(buttons.length, 2);
  for (const button of buttons) assert.doesNotMatch(button[1], /<button\b/);
  assert.match(ready, /aria-label="Update example"/);
  assert.match(ready, /1\.0\.0/);
  assert.match(ready, /1\.1\.0/);
  const pending = renderContent(<PackageUpdateRow {...props} feedback={{ status: "updating" }} />);
  assert.equal([...pending.matchAll(/<button\b[^>]* disabled=""/g)].length, 2);
  assert.match(pending, /aria-busy="true"/);
  assert.match(pending, /role="progressbar"/);
  const failed = renderContent(
    <PackageUpdateRow {...props} feedback={{ status: "failed", errorCode: "session-busy" }} />,
    "zh-CN",
  );
  assert.match(failed, /role="alert"/);
  assert.match(failed, /aria-label="重试更新 example"/);
  assert.doesNotMatch(failed, /disabled=""/);
  const success = renderContent(<PackageUpdateRow {...props} feedback={{ status: "updated" }} />);
  assert.match(success, /role="status"/);
  assert.match(success, />Updated</);
  const git = renderContent(
    <PackageUpdateRow
      {...props}
      item={{
        ...props.item,
        type: "git",
        currentRevision: "1234567890abcdef",
        targetRevision: "fedcba0987654321",
      }}
    />,
  );
  assert.match(git, /1234567890ab/);
  assert.match(git, /fedcba098765/);
  assert.doesNotMatch(git, /1\.0\.0/);
});

test("installation contents distinguish prompt-related packages from bundled templates", () => {
  const render = (
    types: ("extension" | "skill" | "prompt")[] | undefined,
    loadState: "loading" | "ready" | "failed" = "ready",
    locale: "en-US" | "zh-CN" = "en-US",
  ) =>
    renderContent(
      <PackageInstallContents
        catalogTypes={["extension", "prompt"]}
        types={types}
        loadState={loadState}
      />,
      locale,
    );

  // pi-prompt-template-model is categorized as prompt-related but only ships these resources.
  const extension = render(["extension", "skill"]);
  assert.match(extension, />Extension</);
  assert.match(extension, />Skill</);
  assert.doesNotMatch(extension, />Prompt template</);
  assert.match(extension, /does not include prompt templates/);
  assert.match(render(["extension", "skill"], "ready", "zh-CN"), /未附带提示词模板/);

  const template = render(["prompt"]);
  assert.match(template, />Prompt template</);
  assert.doesNotMatch(template, /does not include prompt templates/);
  for (const state of ["loading", "failed"] as const) {
    const unavailable = render(undefined, state);
    assert.doesNotMatch(unavailable, /data-slot="status-badge"|does not include prompt templates/);
    assert.match(
      unavailable,
      state === "loading" ? /Loading resources/ : /contents are unavailable/,
    );
  }
});

test("package resource sections show names, descriptions and disabled contents, never directory counts", () => {
  const props = {
    types: ["extension", "skill", "prompt"] as const,
    loadState: "ready" as const,
    onRefresh: () => undefined,
  };
  const markup = renderContent(
    <PackageResourceSections
      {...props}
      types={[...props.types]}
      installedVersion="1.2.3"
      resources={[
        {
          type: "skill",
          name: "review-code",
          description: "Review code for regressions",
          enabled: true,
        },
        { type: "prompt", name: "plan", description: "Plan the implementation", enabled: false },
        {
          type: "extension",
          name: "workflow",
          enabled: true,
          commandNames: ["review"],
          toolNames: ["inspect"],
          eventNames: ["session_start"],
        },
      ]}
    />,
  );
  assert.match(markup, /review-code/);
  assert.match(markup, /Review code for regressions/);
  assert.match(markup, /Plan the implementation/);
  assert.match(markup, /Disabled/);
  assert.match(markup, /installed version 1.2.3/);
  assert.match(markup, /session_start/);
  assert.match(markup, /inspect/);
  assert.doesNotMatch(markup, /1 entry|\.\/skills|\.\/prompts/);
  const unknown = renderContent(<PackageResourceSections {...props} types={["skill"]} />);
  assert.match(unknown, /market does not publish their names or descriptions/);
  assert.doesNotMatch(unknown, /tabular-nums/);
  const chinese = renderContent(<PackageResourceSections {...props} types={["prompt"]} />, "zh-CN");
  assert.match(chinese, /市场未公开具体名称和说明/);
  const empty = renderContent(
    <PackageResourceSections {...props} types={["skill"]} resources={[]} />,
  );
  assert.match(empty, /No resources of this type/);
  assert.match(empty, />0</);
  const failed = renderContent(
    <PackageResourceSections {...props} types={["skill"]} loadState="failed" />,
  );
  assert.match(failed, /Could not read/);
  assert.match(failed, /Retry/);
});

test("extension contribution rows display descriptions without interactive controls", () => {
  const markup = renderContent(
    <ExtensionCapabilityDetailsPanel
      params={{
        capabilityId: "extension:test",
        capabilityKind: "extension",
        name: "test",
        commandNames: ["review"],
        commandDetails: [
          { name: "review", description: "Review the project", hasArgumentCompletions: false },
        ],
        eventNames: ["session_start"],
        toolNames: [],
      }}
    />,
  );
  assert.match(markup, /Review the project/);
  assert.match(markup, /review/);
  assert.match(markup, /session_start/);
  assert.doesNotMatch(markup, /<button|aria-haspopup|role="button"|tabindex=/);
  assert.ok(markup.indexOf("Review the project") < markup.indexOf("session_start"));
});
