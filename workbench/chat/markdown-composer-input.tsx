"use client";

import { CodeNode } from "@lexical/code-core";
import { LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import {
  $convertFromMarkdownString,
  $convertSelectionToMarkdownString,
  $convertToMarkdownString,
  $generateNodesFromMarkdownString,
  TRANSFORMERS,
} from "@lexical/markdown";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import {
  INTERNAL,
  type Unstable_DirectiveFormatter,
  type Unstable_DirectiveSegment,
  type Unstable_RegisteredTrigger,
  type Unstable_TriggerItem,
  unstable_defaultDirectiveFormatter,
  unstable_useTriggerPopoverRootContextOptional,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import {
  $createDirectiveNodeWithFormatter,
  DirectiveChipProvider,
  DirectiveNode,
  DirectivePlugin,
  type DirectiveChipProps,
  type DirectivePluginProps,
} from "@assistant-ui/react-lexical";
import {
  $createParagraphNode,
  $createRangeSelection,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  PASTE_COMMAND,
  type LexicalEditor,
  type TextNode,
} from "lexical";
import {
  type ComponentPropsWithoutRef,
  type FC,
  type ReactNode,
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

import { hasRenderableMarkdown } from "./composer-markdown-detection";

const MARKDOWN_TRANSFORMERS = TRANSFORMERS;
const SYNC_TAG = "workbench-markdown-composer-sync";
const EMPTY_TRIGGERS: ReadonlyMap<string, Unstable_RegisteredTrigger> = new Map();
const noopSubscribe = () => () => {};

const MARKDOWN_COMPOSER_THEME = {
  code: "my-2 block overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-[0.875em] leading-5",
  heading: {
    h1: "mt-2 mb-1 text-xl font-semibold leading-7 first:mt-0",
    h2: "mt-2 mb-1 text-lg font-semibold leading-7 first:mt-0",
    h3: "mt-2 mb-1 text-base font-semibold leading-6 first:mt-0",
    h4: "mt-2 mb-1 text-base font-semibold leading-6 first:mt-0",
    h5: "mt-2 mb-1 text-base font-semibold leading-6 first:mt-0",
    h6: "mt-2 mb-1 text-base font-semibold leading-6 first:mt-0",
  },
  link: "text-blue-600 underline underline-offset-2 dark:text-blue-400",
  list: {
    listitem: "my-0.5",
    nested: { listitem: "list-none" },
    ol: "my-1 list-decimal ps-6",
    olDepth: ["list-decimal", "list-[lower-alpha]", "list-[lower-roman]"],
    ul: "my-1 list-disc ps-6",
    ulDepth: ["list-disc", "list-[circle]", "list-[square]"],
  },
  paragraph: "min-h-6",
  quote: "my-1 border-s-2 border-border ps-3 text-muted-foreground",
  text: {
    bold: "font-semibold",
    code: "rounded bg-muted px-1 py-0.5 font-mono text-[0.875em]",
    italic: "italic",
    strikethrough: "line-through",
  },
};

type ParsedSegment = {
  readonly segment: Unstable_DirectiveSegment;
  readonly formatter: Unstable_DirectiveFormatter;
};

type CompositeParser = (text: string) => readonly ParsedSegment[];

type DirectivePlaceholder = {
  readonly token: string;
  readonly item: Unstable_TriggerItem;
  readonly formatter: Unstable_DirectiveFormatter;
};

export type MarkdownComposerInputProps = Omit<
  ComponentPropsWithoutRef<"div">,
  "autoFocus" | "children" | "onChange"
> & {
  readonly submitMode?: "enter" | "ctrlEnter" | "none" | undefined;
  readonly cancelOnEscape?: boolean | undefined;
  readonly placeholder?: string | undefined;
  readonly autoFocus?: boolean | undefined;
  readonly directivePluginProps?: DirectivePluginProps | undefined;
  readonly directiveChip?: FC<DirectiveChipProps> | undefined;
  readonly formatter?: Unstable_DirectiveFormatter | undefined;
  readonly value: string;
  readonly onChange: (markdown: string) => void;
  readonly onCursorPositionChange?: ((position: number) => void) | undefined;
  readonly children?: ReactNode | undefined;
};

function collectFormatters(
  triggers: ReadonlyMap<string, Unstable_RegisteredTrigger>,
  propFormatter: Unstable_DirectiveFormatter | undefined,
): readonly Unstable_DirectiveFormatter[] {
  const ordered: Unstable_DirectiveFormatter[] = [];
  const seen = new Set<Unstable_DirectiveFormatter>();
  const push = (formatter: Unstable_DirectiveFormatter | undefined) => {
    if (!formatter || seen.has(formatter)) return;
    seen.add(formatter);
    ordered.push(formatter);
  };

  push(propFormatter);
  for (const trigger of triggers.values()) push(trigger.behavior?.formatter);
  push(unstable_defaultDirectiveFormatter);
  return ordered;
}

function composeParsers(formatters: readonly Unstable_DirectiveFormatter[]): CompositeParser {
  const ordered = formatters.length > 0 ? formatters : [unstable_defaultDirectiveFormatter];
  return (text) => {
    let fallback: readonly ParsedSegment[] | undefined;
    for (const formatter of ordered) {
      const segments = formatter.parse(text);
      const parsed = segments.map((segment) => ({ segment, formatter }));
      if (segments.some((segment) => segment.kind === "mention")) return parsed;
      fallback ??= parsed;
    }
    return fallback ?? [];
  };
}

function prepareMarkdownWithDirectivePlaceholders(
  runtimeText: string,
  parse: CompositeParser,
): { markdown: string; directives: readonly DirectivePlaceholder[] } {
  const directives: DirectivePlaceholder[] = [];
  const markdown = runtimeText
    .split("\n")
    .map((line) =>
      parse(line)
        .map(({ segment, formatter }) => {
          if (segment.kind === "text") return segment.text;
          const token = `\uE000aui-directive-${directives.length}\uE001`;
          directives.push({
            token,
            item: { id: segment.id, type: segment.type, label: segment.label },
            formatter,
          });
          return token;
        })
        .join(""),
    )
    .join("\n");

  return { markdown, directives };
}

function findFirstDirectivePlaceholder(
  text: string,
  directives: readonly DirectivePlaceholder[],
): { directive: DirectivePlaceholder; index: number } | undefined {
  let first: { directive: DirectivePlaceholder; index: number } | undefined;
  for (const directive of directives) {
    const index = text.indexOf(directive.token);
    if (index < 0 || (first && first.index <= index)) continue;
    first = { directive, index };
  }
  return first;
}

function $replaceDirectivePlaceholders(directives: readonly DirectivePlaceholder[]): void {
  if (directives.length === 0) return;

  for (const initialTextNode of $getRoot().getAllTextNodes()) {
    let textNode: TextNode | undefined = initialTextNode;
    while (textNode) {
      const match = findFirstDirectivePlaceholder(textNode.getTextContent(), directives);
      if (!match) break;

      if (match.index > 0) {
        const split = textNode.splitText(match.index);
        textNode = split[1];
      }
      if (!textNode) break;

      let nextTextNode: TextNode | undefined;
      if (textNode.getTextContentSize() > match.directive.token.length) {
        const split = textNode.splitText(match.directive.token.length);
        textNode = split[0];
        nextTextNode = split[1];
      }

      textNode.replace(
        $createDirectiveNodeWithFormatter(match.directive.item, match.directive.formatter),
      );
      textNode = nextTextNode;
    }
  }
}

function syncRuntimeToLexical(
  editor: LexicalEditor,
  runtimeText: string,
  parse: CompositeParser,
): void {
  editor.update(
    () => {
      if (runtimeText.length === 0) {
        const root = $getRoot();
        root.clear();
        root.append($createParagraphNode());
        root.selectEnd();
        return;
      }

      const { markdown, directives } = prepareMarkdownWithDirectivePlaceholders(runtimeText, parse);
      $convertFromMarkdownString(markdown, MARKDOWN_TRANSFORMERS, undefined, true);
      $replaceDirectivePlaceholders(directives);
      $getRoot().selectEnd();
    },
    { tag: SYNC_TAG },
  );
}

function MarkdownSyncPlugin({
  formatter: propFormatter,
  value,
  onChange,
}: Readonly<{
  formatter?: Unstable_DirectiveFormatter | undefined;
  value: string;
  onChange(markdown: string): void;
}>) {
  const [editor] = useLexicalComposerContext();
  const root = unstable_useTriggerPopoverRootContextOptional();
  const subscribe = useCallback(
    (listener: () => void) => (root ? root.subscribe(listener) : noopSubscribe()),
    [root],
  );
  const getSnapshot = useCallback(() => (root ? root.getTriggers() : EMPTY_TRIGGERS), [root]);
  const triggers = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const formatters = useMemo(
    () => collectFormatters(triggers, propFormatter),
    [propFormatter, triggers],
  );
  const parser = useMemo(() => composeParsers(formatters), [formatters]);
  const lastSyncedTextRef = useRef("");

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState, tags }) => {
        if (tags.has(SYNC_TAG)) return;

        editorState.read(() => {
          const markdown = $convertToMarkdownString(MARKDOWN_TRANSFORMERS, undefined, true);
          if (markdown === lastSyncedTextRef.current) return;
          lastSyncedTextRef.current = markdown;
          onChange(markdown);
        });
      }),
    [editor, onChange],
  );

  useEffect(() => {
    if (value === lastSyncedTextRef.current) return;
    lastSyncedTextRef.current = value;
    syncRuntimeToLexical(editor, value, parser);
  }, [editor, parser, value]);

  return null;
}

function KeyboardPlugin({
  submitMode,
  cancelOnEscape,
}: Readonly<{
  submitMode: "enter" | "ctrlEnter" | "none";
  cancelOnEscape: boolean;
}>) {
  const [editor] = useLexicalComposerContext();
  const aui = useAui();
  const pluginRegistry = INTERNAL.useComposerInputPluginRegistryOptional();

  useEffect(() => {
    const delegateToPlugins = (event: KeyboardEvent): boolean => {
      if (!pluginRegistry) return false;
      for (const plugin of pluginRegistry.getPlugins()) {
        if (plugin.handleKeyDown(event)) return true;
      }
      return false;
    };

    const unregister = [
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (!event || event.isComposing || event.shiftKey) return false;
          if (delegateToPlugins(event)) return true;
          if (submitMode === "none" || aui.thread.getState().isRunning) return false;
          const shouldSubmit =
            submitMode === "ctrlEnter"
              ? event.ctrlKey || event.metaKey
              : !event.ctrlKey && !event.metaKey;
          if (!shouldSubmit) return false;
          event.preventDefault();
          aui.composer.send();
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        (event) => {
          if (event && delegateToPlugins(event)) return true;
          if (!cancelOnEscape || !aui.composer.getState().canCancel) return false;
          aui.composer.cancel();
          event?.preventDefault();
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        (event) => (event ? delegateToPlugins(event) : false),
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        (event) => (event ? delegateToPlugins(event) : false),
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        (event) => (event ? delegateToPlugins(event) : false),
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_TAB_COMMAND,
        (event) => (event ? delegateToPlugins(event) : false),
        COMMAND_PRIORITY_HIGH,
      ),
    ];

    return () => {
      for (const cleanup of unregister) cleanup();
    };
  }, [aui, cancelOnEscape, editor, pluginRegistry, submitMode]);

  return null;
}

function markdownCursorPosition(): number {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return 0;

  const prefixSelection = $createRangeSelection();
  const root = $getRoot();
  const firstTextNode = root.getAllTextNodes()[0];
  if (!firstTextNode || !$isTextNode(selection.anchor.getNode())) return selection.anchor.offset;
  prefixSelection.anchor.set(firstTextNode.getKey(), 0, "text");
  prefixSelection.focus.set(selection.anchor.key, selection.anchor.offset, selection.anchor.type);
  return $convertSelectionToMarkdownString(MARKDOWN_TRANSFORMERS, prefixSelection, true).length;
}

function CursorPlugin({
  onChange,
}: Readonly<{ onChange?: ((position: number) => void) | undefined }>) {
  const [editor] = useLexicalComposerContext();
  const pluginRegistry = INTERNAL.useComposerInputPluginRegistryOptional();

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(
          () => {
            const position = markdownCursorPosition();
            onChange?.(position);
            if (!pluginRegistry) return;
            for (const plugin of pluginRegistry.getPlugins()) plugin.setCursorPosition(position);
          },
          { editor },
        );
      }),
    [editor, onChange, pluginRegistry],
  );

  return null;
}

function FocusPlugin({ autoFocus }: Readonly<{ autoFocus: boolean }>) {
  const [editor] = useLexicalComposerContext();
  const aui = useAui();

  useEffect(() => {
    if (autoFocus) editor.focus();
  }, [autoFocus, editor]);

  useEffect(() => aui.on("thread.runStart", () => editor.focus()), [aui, editor]);
  return null;
}

function EditablePlugin({ disabled }: Readonly<{ disabled: boolean }>) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.setEditable(!disabled), [disabled, editor]);
  return null;
}

function MarkdownPastePlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () =>
      editor.registerCommand(
        PASTE_COMMAND,
        (event) => {
          if (!(event instanceof ClipboardEvent)) return false;
          const clipboardData = event.clipboardData;
          if (!clipboardData || clipboardData.files.length > 0) return false;
          const markdown = clipboardData.getData("text/plain");
          if (!hasRenderableMarkdown(markdown)) return false;
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return false;
          event.preventDefault();
          selection.insertNodes(
            $generateNodesFromMarkdownString(markdown, MARKDOWN_TRANSFORMERS, true),
          );
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor],
  );
  return null;
}

export const MarkdownComposerInput = forwardRef<HTMLDivElement, MarkdownComposerInputProps>(
  (
    {
      submitMode = "enter",
      cancelOnEscape = true,
      placeholder,
      autoFocus = false,
      directivePluginProps,
      directiveChip,
      formatter,
      value,
      onChange,
      onCursorPositionChange,
      className,
      children,
      ...rest
    },
    ref,
  ) => {
    const isDisabled = useAuiState(
      (state) => state.thread.isDisabled || state.composer.dictation?.inputDisabled,
    );
    const initialConfig = useMemo(
      () => ({
        namespace: "workbench-markdown-composer",
        nodes: [DirectiveNode, HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode, LinkNode],
        onError: (error: Error) => console.error("[MarkdownComposerInput]", error),
        theme: MARKDOWN_COMPOSER_THEME,
      }),
      [],
    );

    return (
      <LexicalComposer initialConfig={initialConfig}>
        <DirectiveChipProvider value={directiveChip ?? null}>
          <div
            ref={ref}
            className={className ? `aui-lexical-editor ${className}` : "aui-lexical-editor"}
            {...rest}
            style={{ overflowY: "auto", ...rest.style }}
          >
            <RichTextPlugin
              contentEditable={<ContentEditable className="aui-lexical-input" />}
              placeholder={
                placeholder ? <div className="aui-lexical-placeholder">{placeholder}</div> : null
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
            <HistoryPlugin />
            <MarkdownSyncPlugin formatter={formatter} value={value} onChange={onChange} />
            <DirectivePlugin {...directivePluginProps} />
            <MarkdownShortcutPlugin transformers={MARKDOWN_TRANSFORMERS} />
            <MarkdownPastePlugin />
            <KeyboardPlugin submitMode={submitMode} cancelOnEscape={cancelOnEscape} />
            <CursorPlugin onChange={onCursorPositionChange} />
            <FocusPlugin autoFocus={autoFocus} />
            <EditablePlugin disabled={!!isDisabled} />
            {children}
          </div>
        </DirectiveChipProvider>
      </LexicalComposer>
    );
  },
);

MarkdownComposerInput.displayName = "MarkdownComposerInput";
