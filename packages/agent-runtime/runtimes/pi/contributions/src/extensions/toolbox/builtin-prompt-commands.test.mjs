import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@workbench/shell/i18n";
import { useToolCapabilityPreferencesController } from "@workbench/shell/tool-capability-preferences";
import { WorkbenchSettingsProvider } from "@workbench/shell/settings";
import { ComposerCommandRegistryImpl } from "../../../../../../../extension-platform/sdk/src/registries/composer-command-registry";
import { installMinimalReactDomEnvironment } from "../../../../../../../workbench/shell/test/react-dom-environment";
import {
  compileComposerDocument,
  parseComposerDocument,
  WORKBENCH_COMMAND_DIRECTIVE_TYPE,
  workbenchComposerDirectiveFormatter,
} from "../../../../../../../workbench/shell/src/chat/composer-document";
import { piTranslationBundle } from "../../i18n";
import { createBuiltinPromptCommands } from "./builtin-prompt-commands";

test("built-in commands keep the displayed request compact and apply localized templates at submit", async () => {
  const environment = installMinimalReactDomEnvironment();
  const root = createRoot(environment.container);
  const registry = new ComposerCommandRegistryImpl();
  const { commands, component: LocaleBridge } = createBuiltinPromptCommands(registry);
  let controller;
  function Controls() {
    controller = useToolCapabilityPreferencesController("piHookPromptEnabled");
    return createElement(LocaleBridge);
  }
  const settings = { load: async () => ({}), update: async () => undefined };
  try {
    assert.equal(registry.getAll().length, 0);
    for (const locale of ["en-US", "zh-CN"]) {
      await act(async () => {
        root.render(
          createElement(
            WorkbenchSettingsProvider,
            { service: settings },
            createElement(
              I18nProvider,
              { key: locale, initialLocale: locale, bundles: [piTranslationBundle] },
              createElement(Controls),
            ),
          ),
        );
      });
      assert.equal(registry.getAll().length, 4);
      for (const command of commands) {
        const token = workbenchComposerDirectiveFormatter.serialize({
          id: command.id,
          label: `/${command.id}`,
          type: WORKBENCH_COMMAND_DIRECTIVE_TYPE,
        });
        for (const arguments_ of ["", "Review src/example.ts"]) {
          const source = `${token} ${arguments_}`;
          const document = parseComposerDocument(source, registry);
          const request = compileComposerDocument(document, registry);
          assert.equal(request.sourceText, source);
          assert.deepEqual(request.document, document);
          assert.equal(request.commands[0]?.commandId, command.id);
          assert.equal(request.commands[0]?.source, "workbench");
          assert.match(request.text, /@earendil-works\/pi-coding-agent 0\.84\.2/);
          assert.doesNotMatch(request.sourceText, /@earendil-works\/pi-coding-agent/);
          assert.doesNotMatch(request.text, /argument-hint:|\$\{ARGUMENTS/);
          if (arguments_) assert(request.text.includes(arguments_));
          assert.equal(/[\u4e00-\u9fff]/u.test(request.text), locale === "zh-CN");
        }
      }
    }
    const command = commands.find((item) => item.id === "prompts-pi-hook");
    await act(async () => controller.setEnabled(false));
    assert.equal(registry.get("prompts-pi-hook"), undefined);
    assert.equal(registry.getAll().length, 3);
    assert.throws(() => command.composer.apply({ text: "example" }), /启用模板/);
    await act(async () => controller.setEnabled(true));
    assert.ok(registry.get("prompts-pi-hook"));
    assert.equal(registry.getAll().length, 4);
  } finally {
    await act(async () => root.unmount());
    environment.restore();
  }
  assert.equal(registry.getAll().length, 0);
});
