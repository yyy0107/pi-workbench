"use client";
import { useComposerSubmission } from "./use-composer-submission";
import { useComposerAttachments } from "./use-composer-attachments";
import { useComposerCommandParameters } from "./use-composer-command-parameters";
import { useComposerMentions } from "./use-composer-mentions";
import { useComposerSuggestions } from "./use-composer-suggestions";
import {
  CaptureLexicalEditor,
  ComposerAccessibilityPlugin,
  ComposerEnterPlugin,
  ComposerSuggestionKeyboardPlugin,
} from "./composer-editor-plugins";

import {
  suggestionKey,
  suggestionParameterKey,
  suggestionHasParameterFields,
  suggestionGroupLabel,
  directiveGroup,
  type WorkbenchComposerSuggestion,
} from "../lib/composer-suggestion-model";

import { composerTranslationBundle } from "./i18n";
import { composerTranslationBundle as inputTriggerTranslationBundle } from "@workbench/ui-input-trigger/i18n";
import { useI18n } from "@workbench/i18n";
import type { CatalogTranslate } from "@workbench/i18n/runtime";

import {
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $nodesOfType,
  type LexicalEditor,
} from "lexical";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { ComposerCommandToken } from "@workbench/ui-input-trigger/tokens";
import { ComposerWorkspaceFeedback } from "@workbench/ui-workspace/presentation";
import {
  COMPOSER_CONVERSATION_MENTION_TYPE,
  COMPOSER_WORKSPACE_FILE_MENTION_TYPE,
} from "@workbench/core-contracts/composer";

import { useWorkbenchBranding } from "@workbench/shell-context/presentation";
import { cn } from "@workbench/ui/utils";
import { useComposerCommandRegistry, useExtensionErrorReporter } from "@workbench/extension-host";
import type { ComposerCommandDefinition } from "@workbench/extension-sdk";
import { SlotHost } from "@workbench/extension-host/hosts/slot-host";

import {
  WORKBENCH_COMPOSER_ATTACHMENT_ACCEPT,
  useAgentRuntime,
  useConversationSession,
  useCurrentSession,
  useSessionState,
  useThreadList,
} from "@workbench/agent-runtime-client";
import {
  useWorkbenchAgentCommands,
  useWorkbenchAgentWorkspaceFileSearch,
} from "@workbench/agent-runtime-client/context";
import { useWorkspaceSelection } from "@workbench/agent-runtime-client/workspaces";

import {
  applyImmediateComposerCommand,
  COMMAND_ARGUMENT_END_DIRECTIVE_TYPE,
  parseComposerDocument,
  workbenchComposerDirectiveFormatter,
} from "./composer-document";

import { ComposerCommandParameterPanel } from "@workbench/ui-input-trigger/composer-command-parameter-panel";
import {
  COMPOSER_COMMAND_TOKEN_ICON_ACCENT_CLASS_NAME,
  composerCommandIconColorMap,
} from "@workbench/ui-input-trigger/public-composer-command-icon-color";
import { withComposerCommandParameterDefaults } from "@workbench/ui-input-trigger/composer-command-parameters";
import { addComposerFilesFromPaste } from "@workbench/ui-attachment/public-composer-image-paste";

import { addComposerTextFromPaste } from "@workbench/ui-attachment/public-composer-text-paste";
import { ComposerAttachments } from "@workbench/ui-attachment/composer-attachments";
import { ComposerHistoryKeyboardPlugin } from "./composer-history-keyboard-plugin";
import { getComposerInputHistory } from "../lib/composer-input-history";
import {
  $insertDirectiveAtSelection,
  DirectiveNode,
  type ComposerTriggerItem,
  type DirectiveChipProps,
} from "./composer-directive";
import {
  ComposerCommandIcon,
  ComposerTokenIcon,
  type ComposerTokenKind,
} from "@workbench/ui-input-trigger/tokens";
import { MarkdownComposerInput } from "./markdown-composer-input";
import { runningComposerMode } from "./composer-submit";
import { useConversationPreferences } from "@workbench/settings-runtime/conversation-preferences";
import {
  ComposerTriggerEngine,
  excludeSlashPathOrCode,
} from "@workbench/ui-input-trigger/composer-trigger-engine";

import {
  ComposerAddMenuView,
  ComposerErrorAlertView,
  ComposerPrimaryActionView,
  WorkbenchComposerCommandMenuView,
  WorkbenchComposerContextMenuView,
  WorkbenchComposerSurfaceView,
} from "./workbench-composer-view";

const EMPTY_COMPOSER_COMMANDS = Object.freeze([]) as readonly ComposerCommandDefinition[];

function $removeDirectiveAndBuffer(node: DirectiveNode): void {
  const next = node.getNextSibling();
  if ($isTextNode(next) && next.getTextContent().startsWith(" ")) {
    const text = next.getTextContent();
    if (text === " ") next.remove();
    else next.setTextContent(text.slice(1));
  }
  node.remove();
}

function $selectAfterDirective(node: DirectiveNode): void {
  const next = node.getNextSibling();
  if ($isTextNode(next) && next.getTextContent().startsWith(" ")) {
    next.select(1, 1);
    return;
  }

  const buffer = $createTextNode(" ");
  node.insertAfter(buffer);
  buffer.select(1, 1);
}

function composerErrorMessage(
  error: string,
  t: CatalogTranslate<(typeof composerTranslationBundle.messages)["en-US"]>,
): string {
  switch (error) {
    case "model-attachment-unsupported":
      return t("composer.errors.modelDoesNotSupportAttachments");
    case "attachment-too-large":
      return t("composer.errors.attachmentTooLarge");
    case "too-many-attachments":
      return t("composer.errors.tooManyAttachments");
    case "attachment-invalid":
      return t("composer.errors.invalidAttachment");
    default:
      return t("composer.errors.queueSendFailedRestored");
  }
}

export function WorkbenchComposer({
  forceExistingThread = false,
}: Readonly<{ forceExistingThread?: boolean }> = {}) {
  const { t, text: localize } = useI18n(composerTranslationBundle);
  const { t: triggerT } = useI18n(inputTriggerTranslationBundle);
  const { runtimeName } = useWorkbenchBranding();
  const runtime = useAgentRuntime();
  const session = useConversationSession();
  const currentSession = useCurrentSession();
  const composer = useSessionState((snapshot) => snapshot.composer);
  const isRunning = useSessionState((snapshot) => snapshot.isRunning);
  const threads = useThreadList((snapshot) => snapshot.threads);
  const composerValue = composer.text;
  const composerAttachments = composer.attachments;
  const isEmpty = !composerValue.trim() && composerAttachments.length === 0;
  const preferredRunningMode = useConversationPreferences(
    (state) => state.preferences.runningMessageMode,
  );
  const runningMode = runningComposerMode(session.actions, preferredRunningMode);
  const canSendWhileRunning = session.actions[runningMode] !== undefined;
  const canSend = composer.phase !== "submitting" && !isEmpty;
  const attachmentsEnabled = session.actions.addComposerAttachment !== undefined;
  const mainThreadId = session.id;
  const isNewThread =
    !forceExistingThread && currentSession.sessionId === mainThreadId && currentSession.isNewThread;
  const { activeWorkspace, draftWorkspace } = useWorkspaceSelection();
  const inputHistory = getComposerInputHistory(runtime, session, draftWorkspace?.id);
  const navigateInputHistory = useCallback(
    (direction: "previous" | "next") => inputHistory.navigate(session, direction),
    [inputHistory, session],
  );
  const contextWorkspace = draftWorkspace ?? activeWorkspace;
  const workspaceFileSearch = useWorkbenchAgentWorkspaceFileSearch();
  const composerCommandRegistry = useComposerCommandRegistry();
  const reportExtensionError = useExtensionErrorReporter();
  const getComposerCommands = useCallback(
    () => composerCommandRegistry.getAll(),
    [composerCommandRegistry],
  );
  const registeredComposerCommands = useSyncExternalStore(
    composerCommandRegistry.subscribe,
    getComposerCommands,
    () => EMPTY_COMPOSER_COMMANDS,
  );
  const composerRef = useRef<HTMLFormElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [composerOverlayCount, setComposerOverlayCount] = useState(0);
  const lexicalEditorRef = useRef<LexicalEditor | null>(null);
  const activeSessionRef = useRef(session);
  activeSessionRef.current = session;
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const [isComposerComposing, setIsComposerComposing] = useState(false);
  const [composerCursorPosition, setComposerCursorPosition] = useState(0);
  const [contextHighlightedIndex, setContextHighlightedIndex] = useState(0);
  const [commandHighlightedIndex, setCommandHighlightedIndex] = useState(0);
  const [suppressedMatchKey, setSuppressedMatchKey] = useState<string>();
  const [submissionBlocked, setSubmissionBlocked] = useState(false);
  const submissionGuards = useRef(new Set<() => boolean>());
  const registerSubmissionGuard = useCallback((guard: () => boolean) => {
    submissionGuards.current.add(guard);
    return () => {
      submissionGuards.current.delete(guard);
    };
  }, []);
  const [composerCommandError, setComposerCommandError] = useState(false);
  const {
    commandParametersByKey,
    activeCommandParameterKey,
    setActiveCommandParameterKey,
    commandParameterValidationKey,
    setCommandParameterValidationKey,
    updateCommandParameterValues,
    clearCommandParameterValues,
  } = useComposerCommandParameters({ mainThreadId, composerValue, lexicalEditorRef });
  const agentCommands = useWorkbenchAgentCommands();

  const { composerSuggestions, composerSuggestionsByKey, composerSuggestionsByCommandKey } =
    useComposerSuggestions({ agentCommands, registeredComposerCommands, localize, triggerT });
  const activeCommandParameterSuggestion = useMemo(
    () =>
      activeCommandParameterKey === undefined
        ? undefined
        : composerSuggestions.find(
            (suggestion) =>
              suggestionHasParameterFields(suggestion) &&
              suggestionParameterKey(suggestion.item) === activeCommandParameterKey,
          ),
    [activeCommandParameterKey, composerSuggestions],
  );
  const { workspaceFileMentionSearch, contextMentionMatch, contextMentionItems } =
    useComposerMentions({
      threads,
      mainThreadId,
      t,
      contextWorkspace,
      workspaceFileSearch,
      isComposerFocused,
      composerValue,
      composerCursorPosition,
      isComposerComposing,
    });
  const slashCommandTriggerEngine = useMemo(
    () =>
      new ComposerTriggerEngine<WorkbenchComposerSuggestion>([
        {
          id: "slash-command",
          character: "/",
          isExcluded: excludeSlashPathOrCode,
          search: (query) => {
            const normalized = query.toLowerCase();
            return composerSuggestions.filter(
              ({ item }) =>
                item.id.toLowerCase().startsWith(normalized) ||
                item.label.toLowerCase().startsWith(normalized) ||
                item.description?.toLowerCase().includes(normalized),
            );
          },
        },
      ]),
    [composerSuggestions],
  );
  const slashCommandMatch = useMemo(
    () =>
      isComposerFocused
        ? slashCommandTriggerEngine.detect({
            value: composerValue,
            cursorPosition: composerCursorPosition,
            isComposing: isComposerComposing,
          })
        : undefined,
    [
      composerCursorPosition,
      composerValue,
      isComposerComposing,
      isComposerFocused,
      slashCommandTriggerEngine,
    ],
  );
  const slashCommandItems = useMemo(
    () => slashCommandMatch?.suggestions.map(({ item }) => item) ?? [],
    [slashCommandMatch],
  );
  const commandIconColorBySuggestionKey = useMemo(
    () => composerCommandIconColorMap(slashCommandItems),
    [slashCommandItems],
  );
  const contextMenuOpen =
    contextMentionMatch !== undefined && suppressedMatchKey !== contextMentionMatch.key;
  const commandMenuOpen =
    slashCommandMatch !== undefined && suppressedMatchKey !== slashCommandMatch.key;
  useEffect(() => setContextHighlightedIndex(0), [contextMentionMatch?.key]);
  useEffect(() => setCommandHighlightedIndex(0), [slashCommandMatch?.key]);
  const hasDraftWorkspace = draftWorkspace !== undefined;
  const canSubmit = !isNewThread || hasDraftWorkspace;
  const context = { isRunning, isEmpty, submissionBlocked, registerSubmissionGuard };
  const setComposerOverlayVisible = useCallback((visible: boolean) => {
    setComposerOverlayCount((count) => Math.max(0, count + (visible ? 1 : -1)));
  }, []);
  const composerOverlayContext = {
    ...context,
    setOverlayVisible: setComposerOverlayVisible,
  };
  const composerOverlayVisible = composerOverlayCount > 0;
  useEffect(() => {
    if (canSubmit) setSubmissionBlocked(false);
  }, [canSubmit]);

  useEffect(() => {
    setComposerCommandError(false);
  }, [composerValue]);

  const reportComposerCommandError = useCallback(
    (error: unknown, commandId?: string) => {
      setComposerCommandError(true);
      reportExtensionError(error, {
        source: "composer-command",
        ...(commandId ? { commandId } : {}),
      });
    },
    [reportExtensionError],
  );

  const handleDirectiveSelect = useCallback(
    (item: ComposerTriggerItem, trigger: "@" | "/") => {
      const editor = lexicalEditorRef.current;
      if (!editor) return;
      setSuppressedMatchKey(undefined);
      const selectedSuggestionKey = suggestionKey(item);
      const selectedSuggestion = composerSuggestionsByKey.get(selectedSuggestionKey);
      const parameterSelection =
        selectedSuggestion?.argsSchema && suggestionHasParameterFields(selectedSuggestion)
          ? {
              key: suggestionParameterKey(item),
              values: withComposerCommandParameterDefaults(
                selectedSuggestion.argsSchema,
                selectedSuggestion.argsBinding,
                commandParametersByKey[suggestionParameterKey(item)],
              ),
            }
          : undefined;
      let immediateSelection:
        | { document: ReturnType<typeof parseComposerDocument>; index: number }
        | undefined;

      editor.update(
        () => {
          const selected = $insertDirectiveAtSelection(
            trigger,
            item,
            workbenchComposerDirectiveFormatter,
          );
          if (!selected) return;

          const selectedExclusive =
            composerSuggestionsByKey.get(suggestionKey(item))?.exclusive ?? false;
          for (const node of $nodesOfType(DirectiveNode)) {
            if (node === selected) continue;
            const directive = node.getDirectiveItem();
            const existingExclusive =
              composerSuggestionsByKey.get(suggestionKey(directive))?.exclusive ?? false;
            if (selectedExclusive || existingExclusive) $removeDirectiveAndBuffer(node);
          }

          const group = directiveGroup(item, composerCommandRegistry);
          if (group) {
            for (const node of $nodesOfType(DirectiveNode)) {
              if (node === selected) continue;
              if (directiveGroup(node.getDirectiveItem(), composerCommandRegistry) === group) {
                $removeDirectiveAndBuffer(node);
              }
            }
          }

          const definition = composerCommandRegistry.get(item.id);
          if (definition?.composer.behavior === "immediate") {
            const document = parseComposerDocument(
              $getRoot().getTextContent(),
              composerCommandRegistry,
              agentCommands,
            );
            const index = document.findLastIndex(
              (node) => node.type === "command" && node.commandId === item.id,
            );
            $removeDirectiveAndBuffer(selected);
            if (index >= 0) immediateSelection = { document, index };
            return;
          }

          $selectAfterDirective(selected);
        },
        {
          tag: "history-merge",
          onUpdate: () => {
            if (immediateSelection) {
              try {
                applyImmediateComposerCommand(
                  immediateSelection.document,
                  immediateSelection.index,
                  composerCommandRegistry,
                );
              } catch (error) {
                reportComposerCommandError(error, item.id);
              }
              return;
            }

            if (!parameterSelection) return;
            updateCommandParameterValues(parameterSelection.key, parameterSelection.values);
            setCommandParameterValidationKey(undefined);
            setActiveCommandParameterKey(parameterSelection.key);
          },
        },
      );
    },
    [
      commandParametersByKey,
      composerCommandRegistry,
      composerSuggestionsByKey,
      agentCommands,
      reportComposerCommandError,
      updateCommandParameterValues,
    ],
  );

  const dispatchComposer = useComposerSubmission({
    session,
    preferredRunningMode,
    canSubmit,
    submissionGuards,
    setSubmissionBlocked,
    composerCommandRegistry,
    agentCommands,
    commandParametersByKey,
    composerSuggestionsByCommandKey,
    updateCommandParameterValues,
    setCommandParameterValidationKey,
    setActiveCommandParameterKey,
    setComposerCommandError,
    lexicalEditorRef,
    inputHistory,
    clearCommandParameterValues,
    reportComposerCommandError,
  });

  const captureLexicalEditor = useCallback((editor: LexicalEditor | null) => {
    lexicalEditorRef.current = editor;
  }, []);

  const focusComposerInput = useCallback(() => {
    lexicalEditorRef.current?.focus();
  }, []);

  const insertComposerTrigger = useCallback((trigger: "@" | "/") => {
    const editor = lexicalEditorRef.current;
    if (!editor) return;

    editor.focus(() => {
      editor.update(
        () => {
          let selection = $getSelection();
          if (!$isRangeSelection(selection)) {
            $getRoot().selectEnd();
            selection = $getSelection();
          }
          if ($isRangeSelection(selection)) selection.insertText(trigger);
        },
        { tag: "history-merge" },
      );
    });
  }, []);

  const { restorePastedText, addComposerFiles } = useComposerAttachments({
    session,
    lexicalEditorRef,
    activeSessionRef,
  });

  const updateComposerMarkdown = useCallback(
    (markdown: string) => session.actions.setComposerText?.(markdown),
    [session],
  );

  const renderDirectiveChip = useCallback(
    ({ directiveId, directiveType, label }: DirectiveChipProps) => {
      if (directiveType === COMMAND_ARGUMENT_END_DIRECTIVE_TYPE) {
        return (
          <span
            data-slot="composer-command-argument-end"
            aria-hidden="true"
            className="inline-block w-0 overflow-hidden"
          />
        );
      }
      const directiveSuggestionKey = suggestionKey({ id: directiveId, type: directiveType });
      const suggestion = composerSuggestionsByKey.get(directiveSuggestionKey);
      const parameterKey = suggestionHasParameterFields(suggestion)
        ? suggestionParameterKey({ id: directiveId, type: directiveType })
        : undefined;
      const editLabel = parameterKey
        ? triggerT("workbench.chat.composer.commandParameters.edit", { command: label })
        : undefined;
      const tokenKind: ComposerTokenKind | undefined =
        directiveType === COMPOSER_CONVERSATION_MENTION_TYPE
          ? "conversation"
          : directiveType === COMPOSER_WORKSPACE_FILE_MENTION_TYPE
            ? "workspace-file"
            : suggestion?.group;
      return (
        <ComposerCommandToken
          icon={
            suggestion ? (
              <ComposerCommandIcon kind={suggestion.group} />
            ) : tokenKind ? (
              <ComposerTokenIcon kind={tokenKind} />
            ) : undefined
          }
          iconClassName={suggestion ? COMPOSER_COMMAND_TOKEN_ICON_ACCENT_CLASS_NAME : undefined}
          iconSize="md-lg"
          label={label}
          role={parameterKey ? "button" : undefined}
          tabIndex={parameterKey ? 0 : undefined}
          title={editLabel}
          aria-label={editLabel}
          className={cn(
            "mx-0.5 align-baseline",
            parameterKey &&
              "cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          )}
          onPointerDown={
            parameterKey
              ? (event) => {
                  event.preventDefault();
                  setCommandParameterValidationKey(undefined);
                  setActiveCommandParameterKey(parameterKey);
                }
              : undefined
          }
          onKeyDown={
            parameterKey
              ? (event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  setCommandParameterValidationKey(undefined);
                  setActiveCommandParameterKey(parameterKey);
                }
              : undefined
          }
        />
      );
    },
    [composerSuggestionsByKey, t],
  );

  return (
    <div
      data-workbench-composer-overlay-open={composerOverlayVisible ? "" : undefined}
      className="grid w-full min-w-0 max-w-full grid-rows-[auto_auto_auto]"
    >
      <SlotHost
        name="composer.before"
        context={context}
        className="col-start-1 row-start-1 flex flex-col gap-2 empty:hidden [&:not(:empty)]:mb-2"
      />

      <form
        ref={composerRef}
        inert={composerOverlayVisible}
        aria-hidden={composerOverlayVisible || undefined}
        className="group/composer relative col-start-1 row-start-2 flex w-full min-w-0 max-w-full flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          if (!composerOverlayVisible) dispatchComposer();
        }}
      >
        <WorkbenchComposerContextMenuView
          open={contextMenuOpen}
          items={contextMentionItems}
          highlightedIndex={contextHighlightedIndex}
          isLoading={workspaceFileMentionSearch.loading}
          hasWorkspace={contextWorkspace !== undefined}
          loadError={workspaceFileMentionSearch.loadError}
          visible={isComposerFocused}
          ariaLabel={t("workbench.chat.composer.contextMentions.suggestions")}
          labels={{
            conversations: t("workbench.chat.composer.contextMentions.conversations"),
            workspaceFiles: t("workbench.chat.composer.contextMentions.workspaceFiles"),
            loading: t("workbench.chat.composer.contextMentions.loading"),
            loadError: t("workbench.chat.composer.contextMentions.loadError"),
            empty: t("workbench.chat.composer.contextMentions.empty"),
          }}
          onSelect={(item) => handleDirectiveSelect(item, "@")}
        />
        <WorkbenchComposerCommandMenuView
          open={commandMenuOpen}
          items={slashCommandItems}
          highlightedIndex={commandHighlightedIndex}
          suggestions={composerSuggestionsByKey}
          iconColorBySuggestionKey={commandIconColorBySuggestionKey}
          groupLabel={(group, count) => suggestionGroupLabel(group, triggerT, runtimeName, count)}
          ariaLabel={triggerT("workbench.chat.composer.commandSuggestions")}
          onSelect={(item) => handleDirectiveSelect(item, "/")}
        />

        {activeCommandParameterSuggestion?.argsSchema ? (
          <ComposerCommandParameterPanel
            key={activeCommandParameterKey}
            command={{
              label: activeCommandParameterSuggestion.item.label,
              argsSchema: activeCommandParameterSuggestion.argsSchema,
              ...(activeCommandParameterSuggestion.argsBinding
                ? { argsBinding: activeCommandParameterSuggestion.argsBinding }
                : {}),
            }}
            values={
              activeCommandParameterKey
                ? (commandParametersByKey[activeCommandParameterKey] ?? {})
                : {}
            }
            revealValidation={commandParameterValidationKey === activeCommandParameterKey}
            onChange={(values) => {
              if (activeCommandParameterKey) {
                updateCommandParameterValues(activeCommandParameterKey, values);
              }
            }}
            onClose={() => setActiveCommandParameterKey(undefined)}
          />
        ) : null}

        <WorkbenchComposerSurfaceView
          isNewThread={isNewThread}
          isRunning={isRunning}
          headerLeft={
            <SlotHost
              name="composer.header.left"
              context={context}
              className="flex min-w-0 flex-1 items-center gap-2 empty:hidden"
            />
          }
          headerRight={
            <SlotHost
              name="composer.header.right"
              context={context}
              className="flex min-w-0 shrink-0 items-center justify-end gap-2 empty:hidden"
            />
          }
          feedback={<ComposerWorkspaceFeedback />}
          attachments={
            <ComposerAttachments
              attachments={composerAttachments}
              onRemove={(key) => session.actions.removeComposerAttachment?.(key)}
              onRetry={(key) => {
                void session.actions.retryPastedTextAttachment?.(key);
              }}
              onRestore={restorePastedText}
            />
          }
          input={
            <MarkdownComposerInput
              autoFocus={composer.phase === "submitting"}
              formatter={workbenchComposerDirectiveFormatter}
              value={composerValue}
              onChange={updateComposerMarkdown}
              directiveChip={renderDirectiveChip}
              onCursorPositionChange={setComposerCursorPosition}
              placeholder={t(
                isRunning && canSendWhileRunning
                  ? runningMode === "steer"
                    ? "workbench.chat.composer.runningSteerPlaceholder"
                    : "workbench.chat.composer.runningPlaceholder"
                  : "workbench.chat.composer.placeholder",
              )}
              className={cn(
                "relative max-h-[336px] min-w-0 flex-1 overflow-y-auto bg-transparent text-base leading-6 outline-none",
                "[&_.aui-lexical-input]:min-h-7 [&_.aui-lexical-input]:whitespace-pre-wrap [&_.aui-lexical-input]:break-words [&_.aui-lexical-input]:outline-none",
                "[&_.aui-lexical-placeholder]:text-muted-foreground/85 [&_.aui-lexical-placeholder]:pointer-events-none [&_.aui-lexical-placeholder]:absolute [&_.aui-lexical-placeholder]:start-0 [&_.aui-lexical-placeholder]:top-0",
                isNewThread && "min-h-10 [&_.aui-lexical-input]:min-h-10",
              )}
              onFocusCapture={() => setIsComposerFocused(true)}
              onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setIsComposerFocused(false);
                }
              }}
              onCompositionStartCapture={() => setIsComposerComposing(true)}
              onCompositionEndCapture={() => setIsComposerComposing(false)}
              onPasteCapture={(event) => {
                if (addComposerTextFromPaste(event, session.actions.addPastedTextAttachment))
                  return;
                void addComposerFilesFromPaste(event, {
                  attachmentsEnabled,
                  addAttachment: async (file) => addComposerFiles([file]),
                });
              }}
            >
              <CaptureLexicalEditor onChange={captureLexicalEditor} />
              <ComposerAccessibilityPlugin
                enabled
                label={t("workbench.chat.composer.messageInput")}
              />
              <ComposerSuggestionKeyboardPlugin
                active={contextMenuOpen}
                items={contextMentionItems}
                highlightedIndex={contextHighlightedIndex}
                onHighlightedIndexChange={setContextHighlightedIndex}
                onSelect={(item) => handleDirectiveSelect(item, "@")}
                onDismiss={() => setSuppressedMatchKey(contextMentionMatch?.key)}
              />
              <ComposerSuggestionKeyboardPlugin
                active={commandMenuOpen}
                items={slashCommandItems}
                highlightedIndex={commandHighlightedIndex}
                onHighlightedIndexChange={setCommandHighlightedIndex}
                onSelect={(item) => handleDirectiveSelect(item, "/")}
                onDismiss={() => setSuppressedMatchKey(slashCommandMatch?.key)}
              />
              <ComposerEnterPlugin onSubmit={dispatchComposer} />
              <ComposerHistoryKeyboardPlugin
                enabled={
                  !isComposerComposing &&
                  !contextMenuOpen &&
                  !commandMenuOpen &&
                  !composerOverlayVisible &&
                  composer.phase !== "submitting"
                }
                onNavigate={navigateInputHistory}
              />
            </MarkdownComposerInput>
          }
          actionsLeft={
            <>
              <SlotHost
                name="composer.actions.left"
                context={context}
                className="flex min-w-0 items-center gap-2 empty:hidden"
              />
              <ComposerAddMenuView
                attachmentsEnabled={attachmentsEnabled}
                labels={{
                  open: t("workbench.chat.composer.addMenu.open"),
                  attachment: t("workbench.chat.composer.addMenu.attachment"),
                  context: t("workbench.chat.composer.addMenu.context"),
                  capability: t("workbench.chat.composer.addMenu.capability"),
                }}
                onInsertTrigger={insertComposerTrigger}
                onChooseAttachment={() => attachmentInputRef.current?.click()}
              />
              <input
                ref={attachmentInputRef}
                type="file"
                multiple
                accept={WORKBENCH_COMPOSER_ATTACHMENT_ACCEPT}
                tabIndex={-1}
                className="sr-only"
                onChange={(event) => {
                  void addComposerFiles(Array.from(event.currentTarget.files ?? []));
                  event.currentTarget.value = "";
                }}
              />
            </>
          }
          actionsRight={
            <>
              <SlotHost
                name="composer.actions.right"
                context={context}
                className="flex min-w-0 items-center justify-end gap-2 empty:hidden"
              />
              <ComposerPrimaryActionView
                isRunning={isRunning}
                canSend={canSend}
                sendLabel={t(
                  isRunning
                    ? runningMode === "steer"
                      ? "workbench.chat.composer.steerMessage"
                      : "workbench.chat.composer.queueFollowUp"
                    : "workbench.chat.composer.sendMessage",
                )}
                stopLabel={t("workbench.chat.composer.stopGenerating")}
                onSend={() => dispatchComposer()}
                onCancel={() => void session.actions.cancel?.().catch(console.error)}
              />
            </>
          }
          attachmentsEnabled={attachmentsEnabled}
          onDropFiles={(files) => void addComposerFiles(files)}
          onCardClick={focusComposerInput}
        />

        {composer.error || composerCommandError ? (
          <ComposerErrorAlertView
            message={
              composer.error
                ? composerErrorMessage(composer.error.code, t)
                : t("composer.errors.commandCompileFailed")
            }
            dismissLabel={t("workbench.chat.composer.dismissError")}
            onDismiss={() => {
              session.actions.dismissComposerError?.();
              setComposerCommandError(false);
            }}
          />
        ) : null}
      </form>

      <SlotHost
        name="composer.overlay"
        context={composerOverlayContext}
        className={cn(
          "relative z-10 col-start-1 row-start-2 min-w-0 empty:hidden",
          !composerOverlayVisible && "pointer-events-none",
        )}
      />

      <SlotHost
        name="composer.after"
        context={context}
        className="col-start-1 row-start-3 flex flex-col gap-2 empty:hidden [&:not(:empty)]:mt-2"
      />
    </div>
  );
}
