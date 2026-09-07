"use client";

import { useEffect, useRef, useState } from "react";
import { FileTextIcon, PlayIcon, PlusIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { useAgentRuntime } from "@workbench/agent-runtime-client";
import { useWorkspaceCapabilities } from "@workbench/agent-runtime-client/workspaces";
import { useMainViewService } from "@workbench/extension-host";
import { usePiResourceClient } from "@workbench/agent-runtime-pi-client/resources";
import type { PromptDescribeValue } from "@workbench/agent-runtime-pi-protocol/rpc";
import { useWorkbenchNavigation } from "@workbench/shell/navigation";
import {
  WORKBENCH_COMMAND_DIRECTIVE_TYPE,
  workbenchComposerDirectiveFormatter,
} from "@workbench/shell/chat";
import {
  Button,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Skeleton,
  TooltipIconButton,
} from "@workbench/shell/ui";
import { definePiMessage, usePiI18n } from "../../i18n";
import {
  bindCapabilityToCatalogTarget,
  promptSurfaceParams,
  type ToolboxCapabilitySurfaceParams,
} from "./toolbox-capability";
import { useToolboxCatalogs, type ToolboxCapabilityItem } from "./toolbox-catalog";
import { ToolboxDetailView } from "./toolbox-installed-view";
import { ToolboxResourceGroup } from "./toolbox-resource-group";
import { PromptEditorDialog, PromptUseDialog, promptErrorKey } from "./toolbox-prompt-dialogs";
import { toolboxScopeTarget } from "./toolbox-scope";
import { useToolboxScope } from "./toolbox-scope-store";
import { BuiltinPromptTemplates, type PromptTemplateDraft } from "./builtin-prompt-templates";
import { insertPromptDraft } from "./prompt-composer-draft";

export function ToolboxPromptsView({ initialQuery = "" }: { initialQuery?: string }) {
  const { t, locale } = usePiI18n();
  const scope = useToolboxScope();
  const client = usePiResourceClient();
  const runtime = useAgentRuntime();
  const { deactivateWorkspace } = useWorkspaceCapabilities();
  const navigation = useWorkbenchNavigation();
  const mainViews = useMainViewService();
  const { promptsCatalog: catalog, promptItems: items } = useToolboxCatalogs(scope, "prompt");
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState<ToolboxCapabilitySurfaceParams>();
  const [creating, setCreating] = useState<PromptTemplateDraft>();
  const [using, setUsing] = useState<PromptDescribeValue>();
  const [preparing, setPreparing] = useState<string>();
  const [error, setError] = useState<string>();
  const previous = useRef<HTMLButtonElement | null>(null);
  const back = useRef<HTMLButtonElement | null>(null);
  const search = useRef<HTMLInputElement | null>(null);
  const inFlight = useRef(false);
  const title = t("extensions.toolbox.prompts.title");
  const target = toolboxScopeTarget(scope);
  const normalized = query.trim().toLocaleLowerCase(locale);
  const visible = items.filter((item) =>
    item.searchText.toLocaleLowerCase(locale).includes(normalized),
  );
  useEffect(() => {
    if (selected) back.current?.focus();
    else if (previous.current)
      (previous.current.isConnected ? previous.current : search.current)?.focus({
        preventScroll: true,
      });
  }, [selected]);
  const useBuiltin = (commandName: string) => {
    setError(undefined);
    try {
      const current = runtime.current.getSnapshot();
      insertPromptDraft(
        runtime,
        current.isNewThread && current.sessionId ? `draft:${current.sessionId}` : "new",
        workbenchComposerDirectiveFormatter.serialize({
          id: commandName,
          label: `/${commandName}`,
          type: WORKBENCH_COMMAND_DIRECTIVE_TYPE,
        }) + " ",
      );
      deactivateWorkspace();
      mainViews.close();
      navigation.openHome();
    } catch (failure) {
      setError(t(promptErrorKey(failure)));
    }
  };
  const prepare = async (item: ToolboxCapabilityItem) => {
    if (inFlight.current || !item.params.promptId) return;
    inFlight.current = true;
    setPreparing(item.id);
    setError(undefined);
    try {
      setUsing(await client.describePrompt({ target, id: item.params.promptId }));
    } catch (failure) {
      setError(t(promptErrorKey(failure)));
    } finally {
      setPreparing(undefined);
      inFlight.current = false;
    }
  };
  return (
    <section aria-label={title} className="@container flex h-full min-h-0 min-w-0 flex-col">
      <div
        hidden={Boolean(selected)}
        className="min-h-0 flex-1 flex-col data-[visible=true]:flex"
        data-visible={!selected}
      >
        <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-5 pt-8 @2xl:px-10 @2xl:pt-10">
          <header className="mb-6 flex shrink-0 flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-medium tracking-tight">{title}</h1>
              <p className="text-muted-foreground mt-3 text-base leading-6">
                {t("extensions.toolbox.main.descriptions.prompts")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <TooltipIconButton
                tooltip={t("extensions.toolbox.main.refresh")}
                disabled={!catalog.hasTargets || catalog.loadState === "loading"}
                onClick={catalog.refresh}
              >
                <RefreshCwIcon aria-hidden="true" />
              </TooltipIconButton>
              <Button
                disabled={!catalog.hasTargets}
                onClick={() => setCreating({ name: "", content: "" })}
              >
                <PlusIcon aria-hidden="true" />
                {t("extensions.toolbox.prompts.create")}
              </Button>
            </div>
          </header>
          <InputGroup className="shrink-0">
            <InputGroupAddon>
              <SearchIcon aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              ref={search}
              type="search"
              value={query}
              autoComplete="off"
              spellCheck={false}
              placeholder={t("extensions.toolbox.main.searchIn", { name: title })}
              aria-label={t("extensions.toolbox.main.searchIn", { name: title })}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </InputGroup>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-3">
            <span className="text-muted-foreground text-xs">
              {catalog.loadState === "ready"
                ? t("extensions.toolbox.prompts.savedCount", { count: visible.length })
                : t("extensions.toolbox.main.loading")}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                mainViews.open({
                  kind: "toolbox",
                  title: definePiMessage("extensions.toolbox.packages.title"),
                  params: { section: "packages" },
                })
              }
            >
              {t("extensions.toolbox.browsePiPackages")}
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-destructive py-3 text-sm">
              {error}
            </p>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-3 [scrollbar-gutter:stable]">
            <BuiltinPromptTemplates
              query={query}
              onOpen={(template, event) => {
                previous.current = event.currentTarget;
                setSelected({
                  capabilityId: `builtin-prompt:${template.name}`,
                  capabilityKind: "prompt",
                  name: template.name,
                  builtin: true,
                });
              }}
              onUse={useBuiltin}
            />
            <h2 className="mb-3 border-b px-3 pb-3 text-base font-medium">
              {t("extensions.toolbox.prompts.savedTitle")}
            </h2>
            {!catalog.hasTargets ? (
              <p role="status" className="text-muted-foreground py-12 text-center text-sm">
                {t("extensions.toolbox.scopeUnavailable")}
              </p>
            ) : catalog.loadState === "loading" || catalog.loadState === "idle" ? (
              <div
                aria-busy="true"
                aria-label={t("extensions.toolbox.main.loading")}
                className="grid grid-cols-1 gap-x-6 gap-y-3 @2xl:grid-cols-2"
              >
                {[0, 1, 2].map((n) => (
                  <Skeleton key={n} className="h-20 w-full" />
                ))}
              </div>
            ) : catalog.loadState === "failed" ? (
              <div role="alert" className="py-12 text-center text-sm">
                <p>{t("extensions.toolbox.loadFailed")}</p>
                <Button variant="outline" className="mt-3" onClick={catalog.refresh}>
                  {t("extensions.toolbox.packages.retry")}
                </Button>
              </div>
            ) : visible.length === 0 ? (
              <p role="status" className="text-muted-foreground py-12 text-center text-sm">
                {t(
                  items.length
                    ? "extensions.toolbox.noMatches"
                    : "extensions.toolbox.prompts.empty",
                )}
              </p>
            ) : (
              <ToolboxResourceGroup
                items={visible}
                query={query}
                renderItem={(item) => (
                  <li key={item.id} className="flex min-w-0 items-center gap-2 py-2">
                    <Button
                      variant="ghost"
                      className="h-auto min-w-0 flex-1 items-start justify-start gap-3 px-3 py-[calc(var(--control-content-padding-block-default)*1.5)] text-left font-normal"
                      aria-label={t("extensions.toolbox.openDetails", { name: item.name })}
                      onClick={(event) => {
                        previous.current = event.currentTarget;
                        setSelected(item.params);
                      }}
                    >
                      <span className="bg-muted/30 group-hover/button:bg-card flex size-(--button-height-large) shrink-0 items-center justify-center rounded-(--button-radius) transition-colors">
                        <FileTextIcon
                          aria-hidden="true"
                          className="[--button-icon-size:calc(var(--icon-size-md)*1.75)]"
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base leading-5">{item.name}</span>
                        {item.description ? (
                          <span className="text-muted-foreground mt-1 block truncate text-sm leading-5">
                            {item.description}
                          </span>
                        ) : null}
                        <span className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          <code>/{item.params.invocationName}</code>
                          <span className="truncate">
                            {item.params.origin === "package"
                              ? item.params.source
                              : t("extensions.toolbox.prompts.independent")}
                          </span>
                          {item.params.enabled === false ? (
                            <span>{t("extensions.toolbox.skills.disabledStatus")}</span>
                          ) : null}
                        </span>
                      </span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mr-3 shrink-0"
                      disabled={item.params.enabled === false || Boolean(preparing)}
                      aria-label={t("extensions.toolbox.prompts.useNamed", { name: item.name })}
                      onClick={() => void prepare(item)}
                    >
                      <PlayIcon aria-hidden="true" />
                      {t(
                        preparing === item.id
                          ? "extensions.toolbox.prompts.preparing"
                          : "extensions.toolbox.prompts.use",
                      )}
                    </Button>
                  </li>
                )}
              />
            )}
          </div>
        </div>
      </div>
      {selected ? (
        <ToolboxDetailView
          params={selected}
          listTitle={title}
          backButtonRef={back}
          onBack={() => setSelected(undefined)}
        />
      ) : null}
      {creating ? (
        <PromptEditorDialog
          target={target}
          initialValue={creating}
          onClose={() => setCreating(undefined)}
          onSaved={(value) => {
            setCreating(undefined);
            setSelected(
              bindCapabilityToCatalogTarget(promptSurfaceParams(value), value.scope, target),
            );
          }}
        />
      ) : null}
      {using ? (
        <PromptUseDialog target={target} template={using} onClose={() => setUsing(undefined)} />
      ) : null}
    </section>
  );
}
