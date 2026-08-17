"use client";

import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileCode2Icon,
  FolderOpenIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";

import { useI18n } from "@/i18n";
import type { PanelComponentProps } from "@/platform/extensions";

interface EditorDocument {
  id: string;
  name: string;
  path: readonly string[];
  content: string;
}

const EXTENSIONS_INDEX_SOURCE = `export { codeEditorExtension } from "./builtin/code-editor";
export { connectionStatusExtension } from "./builtin/connection-status";
export { modelSelectorExtension } from "./builtin/model-selector";
export { skillsExtension } from "./builtin/skills";
export { terminalExtension } from "./builtin/terminal";
export { tokenUsageExtension } from "./builtin/token-usage";
export { enabledExtensions } from "./enabled-extensions";`;

const SLOT_SOURCE = `import type { ComponentType } from "react";

import type { Disposable } from "./disposable";

export const WORKBENCH_SLOTS = [
  "header.left",
  "header.center",
  "header.right",
  "sidebar.brand",
  "sidebar.navigation",
  "panel.right.add-menu",
  "panel.right.actions",
  "composer.actions.left",
  "composer.actions.right",
  "statusbar.left",
  "statusbar.right",
] as const;

export type WorkbenchSlot = (typeof WORKBENCH_SLOTS)[number];`;

const PANEL_SOURCE = `import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

export type PanelLocation = "left" | "right" | "bottom";

export interface PanelTabComponentProps {
  panelId: string;
  isActive: boolean;
}

export type PanelTabClassName =
  | string
  | ((context: PanelTabComponentProps) => string | undefined);

export interface PanelTabClassNames {
  root?: PanelTabClassName;
  trigger?: PanelTabClassName;
  closeButton?: PanelTabClassName;
}

export interface PanelDefinition {
  id: string;
  title?: string;
  icon?: LucideIcon;
  tabComponent?: ComponentType<PanelTabComponentProps>;
  tabClassNames?: PanelTabClassNames;
  component: ComponentType<PanelComponentProps>;
  defaultLocation: PanelLocation;
  defaultSize?: number;
}`;

const INITIAL_DOCUMENTS: readonly EditorDocument[] = [
  {
    id: "extensions-index",
    name: "index.ts",
    path: ["workbench-ui", "extensions", "index.ts"],
    content: EXTENSIONS_INDEX_SOURCE,
  },
  {
    id: "slot-contract",
    name: "slot.ts",
    path: ["workbench-ui", "platform", "extensions", "api", "slot.ts"],
    content: SLOT_SOURCE,
  },
  {
    id: "panel-contract",
    name: "panel.ts",
    path: ["workbench-ui", "platform", "extensions", "api", "panel.ts"],
    content: PANEL_SOURCE,
  },
];

const TOKEN_PATTERN =
  /(\/\/.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:as|async|await|break|case|catch|class|const|continue|default|else|export|extends|false|finally|for|from|function|if|import|in|interface|let|new|null|of|return|satisfies|static|switch|throw|true|try|type|typeof|undefined|while)\b|\b\d+(?:\.\d+)?\b)/g;

function tokenClassName(token: string): string {
  if (token.startsWith("//")) return "text-emerald-700 dark:text-emerald-400";
  if (/^["'`]/.test(token)) return "text-green-700 dark:text-green-400";
  if (/^\d/.test(token)) return "text-blue-600 dark:text-blue-400";
  if (/^(?:false|null|true|undefined)$/.test(token)) {
    return "text-violet-600 dark:text-violet-400";
  }
  return "text-rose-600 dark:text-rose-400";
}

function highlightLine(line: string): ReactNode {
  const nodes: ReactNode[] = [];
  let cursor = 0;

  for (const [index, match] of Array.from(line.matchAll(TOKEN_PATTERN)).entries()) {
    const start = match.index;
    if (start > cursor) nodes.push(line.slice(cursor, start));
    nodes.push(
      <span key={`${start}-${index}`} className={tokenClassName(match[0])}>
        {match[0]}
      </span>,
    );
    cursor = start + match[0].length;
  }

  if (cursor < line.length) nodes.push(line.slice(cursor));
  return nodes.length > 0 ? nodes : " ";
}

function pathFromFile(file: File): readonly string[] {
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return (relativePath || file.name).split("/").filter(Boolean);
}

function TypeScriptFileIcon() {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-slate-700 text-[7px] font-bold leading-none text-white dark:bg-slate-300 dark:text-slate-900">
      TS
    </span>
  );
}

export function CodeEditorPanel({ panelId }: PanelComponentProps) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<readonly EditorDocument[]>(INITIAL_DOCUMENTS);
  const [activeDocumentId, setActiveDocumentId] = useState(INITIAL_DOCUMENTS[0].id);
  const activeDocument =
    documents.find((document) => document.id === activeDocumentId) ?? documents[0];
  const lines = useMemo(() => activeDocument?.content.split("\n") ?? [], [activeDocument]);

  const openFiles = async (files: FileList | null) => {
    if (!files?.length) return;

    const opened = await Promise.all(
      Array.from(files).map(async (file) => {
        const path = pathFromFile(file);
        return {
          id: `${path.join("/")}-${file.lastModified}-${file.size}`,
          name: file.name,
          path,
          content: await file.text(),
        } satisfies EditorDocument;
      }),
    );

    setDocuments((current) => {
      const openedIds = new Set(opened.map((document) => document.id));
      return [...current.filter((document) => !openedIds.has(document.id)), ...opened];
    });
    setActiveDocumentId(opened.at(-1)?.id ?? activeDocumentId);
  };

  const closeDocument = (documentId: string) => {
    const index = documents.findIndex((document) => document.id === documentId);
    if (index < 0) return;

    const nextDocuments = documents.filter((document) => document.id !== documentId);
    setDocuments(nextDocuments);

    if (documentId === activeDocumentId) {
      const nextActive = nextDocuments[Math.min(index, nextDocuments.length - 1)];
      setActiveDocumentId(nextActive?.id ?? "");
    }
  };

  const chooseFiles = () => fileInputRef.current?.click();

  return (
    <section
      data-panel-id={panelId}
      aria-label={t("extensions.codeEditor.region")}
      className="bg-background flex h-full min-h-0 flex-col"
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        accept=".c,.cc,.cpp,.css,.go,.h,.html,.java,.js,.json,.jsx,.md,.mdx,.py,.rs,.sh,.sql,.toml,.ts,.tsx,.txt,.yaml,.yml"
        onChange={(event) => {
          void openFiles(event.currentTarget.files).catch((error) => {
            console.error("Unable to open files in the code editor.", error);
          });
          event.currentTarget.value = "";
        }}
      />

      <div className="bg-muted/20 flex h-11 shrink-0 items-end border-b px-2 pt-1.5">
        <div
          role="tablist"
          aria-label={t("extensions.codeEditor.openedFiles")}
          className="flex min-w-0 flex-1 gap-1 overflow-x-auto"
        >
          {documents.map((document) => {
            const isActive = document.id === activeDocument?.id;

            return (
              <div
                key={document.id}
                className={`group relative flex h-8 min-w-28 max-w-48 shrink-0 items-center rounded-t-lg border text-xs transition-colors ${
                  isActive
                    ? "bg-background text-foreground border-border border-b-background"
                    : "text-muted-foreground hover:bg-muted/55 hover:text-foreground border-transparent"
                }`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  title={document.path.join("/")}
                  className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-t-lg py-0 pr-7 pl-2.5"
                  onClick={() => setActiveDocumentId(document.id)}
                >
                  <TypeScriptFileIcon />
                  <span className="min-w-0 flex-1 truncate text-left">{document.name}</span>
                </button>
                <button
                  type="button"
                  aria-label={t("extensions.codeEditor.closeFile", { name: document.name })}
                  className={`hover:bg-muted absolute right-2 flex size-4 shrink-0 items-center justify-center rounded ${
                    isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeDocument(document.id);
                  }}
                >
                  <XIcon className="size-3" />
                </button>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          aria-label={t("extensions.codeEditor.openFile")}
          title={t("extensions.codeEditor.openFile")}
          className="text-muted-foreground hover:bg-muted hover:text-foreground mb-1 flex size-7 shrink-0 items-center justify-center rounded-md transition-colors"
          onClick={chooseFiles}
        >
          <PlusIcon className="size-4" />
        </button>
      </div>

      <div className="flex h-11 shrink-0 items-center gap-3 border-b px-3">
        {activeDocument ? (
          <nav
            aria-label={t("extensions.codeEditor.filePath")}
            className="flex min-w-0 flex-1 items-center overflow-hidden text-xs"
          >
            {activeDocument.path.map((segment, index) => (
              <Fragment key={`${segment}-${index}`}>
                {index > 0 ? (
                  <ChevronRightIcon className="text-muted-foreground/60 mx-1 size-3.5 shrink-0" />
                ) : null}
                <span
                  className={`truncate ${
                    index === activeDocument.path.length - 1
                      ? "text-foreground font-medium"
                      : "text-muted-foreground"
                  }`}
                >
                  {segment}
                </span>
              </Fragment>
            ))}
          </nav>
        ) : (
          <span className="text-muted-foreground min-w-0 flex-1 text-xs">
            {t("extensions.codeEditor.noOpenFile")}
          </span>
        )}

        <button
          type="button"
          aria-label={t("extensions.codeEditor.chooseLocalFiles")}
          title={t("extensions.codeEditor.chooseLocalFiles")}
          className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-md transition-colors"
          onClick={chooseFiles}
        >
          <FolderOpenIcon className="size-4" />
        </button>
        <button
          type="button"
          className="hover:bg-muted flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors"
          onClick={chooseFiles}
        >
          <FileCode2Icon className="size-4 text-blue-500" />
          {t("extensions.codeEditor.open")}
          <ChevronDownIcon className="text-muted-foreground size-3.5" />
        </button>
      </div>

      {activeDocument ? (
        <div className="min-h-0 flex-1 overflow-auto py-1 font-mono text-[12px] leading-6 selection:bg-blue-500/20">
          <ol
            className="min-w-max"
            aria-label={t("extensions.codeEditor.sourceCode", { name: activeDocument.name })}
          >
            {lines.map((line, index) => (
              <li key={index} className="flex min-h-6">
                <span
                  aria-hidden="true"
                  className="bg-background text-muted-foreground/60 sticky left-0 w-12 shrink-0 select-none border-r pr-3 text-right"
                >
                  {index + 1}
                </span>
                <code className="whitespace-pre px-3 text-slate-800 dark:text-slate-200">
                  {highlightLine(line)}
                </code>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div className="text-muted-foreground flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <FileCode2Icon className="size-8 opacity-45" />
          <div>
            <p className="text-foreground text-sm font-medium">
              {t("extensions.codeEditor.emptyTitle")}
            </p>
            <p className="mt-1 text-xs">{t("extensions.codeEditor.emptyDescription")}</p>
          </div>
          <button
            type="button"
            className="text-foreground hover:bg-muted h-8 rounded-lg border px-3 text-xs font-medium transition-colors"
            onClick={chooseFiles}
          >
            {t("extensions.codeEditor.chooseFiles")}
          </button>
        </div>
      )}
    </section>
  );
}
