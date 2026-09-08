"use client";

import { ExternalLinkIcon, Globe2Icon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BrowserHistoryEntry } from "@workbench/browser-contracts";

import { useI18n } from "../../../i18n";
import { Button } from "../../../ui";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../../../ui/input-group";
import {
  SearchableSelector,
  SearchableSelectorContent,
  SearchableSelectorEmpty,
  SearchableSelectorInput,
  SearchableSelectorItem,
  SearchableSelectorList,
  SearchableSelectorStatus,
} from "../../../ui/searchable-selector";
import type { BrowserSessionService } from "./browser-session-service";

export function browserDisplayAddress(url: string, showFullUrl: boolean): string {
  if (showFullUrl || !/^https?:/.test(url)) return url;
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function BrowserAddressBar({
  browser,
  value,
  url,
  showFullUrl,
  error,
  onChange,
  onNavigate,
}: {
  browser: BrowserSessionService;
  value: string;
  url: string;
  showFullUrl: boolean;
  error?: boolean;
  onChange(value: string): void;
  onNavigate(value: string): void;
}) {
  const { t } = useI18n();
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [edited, setEdited] = useState(false);
  const [history, setHistory] = useState<BrowserHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const highlighted = useRef<BrowserHistoryEntry | undefined>(undefined);
  const query = edited ? value.trim() : "";
  const inputValue = focused || value !== url ? value : browserDisplayAddress(url, showFullUrl);

  useLayoutEffect(() => {
    if (focused) input.current?.select();
  }, [focused]);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setHistory([]);
    setHistoryError(false);
    setLoading(true);
    const timeout = setTimeout(
      () => {
        void browser.command<BrowserHistoryEntry[]>({ type: "history.list", query }).then(
          (entries) => {
            if (current) {
              setHistory(entries);
              setLoading(false);
            }
          },
          () => {
            if (current) {
              setHistoryError(true);
              setLoading(false);
            }
          },
        );
      },
      query ? 150 : 0,
    );
    return () => {
      current = false;
      clearTimeout(timeout);
    };
  }, [browser, open, query]);

  const close = () => {
    setOpen(false);
    highlighted.current = undefined;
    input.current?.blur();
  };
  const navigate = (address: string) => {
    onChange(address);
    onNavigate(address);
    close();
  };

  return (
    <SearchableSelector<BrowserHistoryEntry>
      items={history}
      filter={null}
      value={null}
      inputValue={inputValue}
      open={open}
      openOnInputClick
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) highlighted.current = undefined;
      }}
      onInputValueChange={(nextValue, details) => {
        if (details.reason !== "input-change") return;
        setEdited(true);
        highlighted.current = undefined;
        onChange(nextValue);
      }}
      onValueChange={(entry) => {
        if (entry) navigate(entry.url);
      }}
      onItemHighlighted={(entry) => {
        highlighted.current = entry;
      }}
      itemToStringLabel={(entry) => entry.url}
      itemToStringValue={(entry) => entry.url}
      isItemEqualToValue={(entry, selected) => entry.url === selected.url}
    >
      <InputGroup className="min-w-0 flex-1">
        <InputGroupAddon>
          <Globe2Icon aria-hidden="true" />
        </InputGroupAddon>
        <SearchableSelectorInput
          ref={input}
          render={<InputGroupInput />}
          className="min-w-0 border-0 text-xs focus-visible:outline-none"
          aria-label={t("extensions.workspaceBrowser.address")}
          aria-invalid={error || undefined}
          placeholder={t("extensions.workspaceBrowser.addressPlaceholder")}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onFocus={() => {
            setFocused(true);
            setEdited(false);
            setOpen(true);
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventBaseUIHandler();
              event.preventDefault();
              event.stopPropagation();
              close();
            } else if (event.key === "Enter") {
              if (event.nativeEvent.isComposing || event.which === 229) return;
              if (!open || !highlighted.current) {
                event.preventBaseUIHandler();
                event.preventDefault();
                navigate(value);
              }
            }
          }}
        />
        {/^https?:/.test(url) ? (
          <InputGroupAddon align="inline-end">
            <Button
              variant="ghost"
              size="icon-sm"
              nativeButton={false}
              render={
                <a href={url} target="_blank" rel="noopener noreferrer" data-browser-external />
              }
              aria-label={t("extensions.workspaceBrowser.openExternal")}
              title={t("extensions.workspaceBrowser.openExternal")}
            >
              <ExternalLinkIcon />
            </Button>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
      <SearchableSelectorContent className="w-[max(var(--anchor-width),20rem)]">
        <SearchableSelectorStatus>
          {t(
            loading
              ? "extensions.workspaceBrowser.historyLoading"
              : historyError
                ? "extensions.workspaceBrowser.historyError"
                : "extensions.workspaceBrowser.recentHistory",
          )}
        </SearchableSelectorStatus>
        {!loading && !historyError ? (
          <SearchableSelectorEmpty>
            {t(
              query
                ? "extensions.workspaceBrowser.historyNoResults"
                : "extensions.workspaceBrowser.historyEmpty",
            )}
          </SearchableSelectorEmpty>
        ) : null}
        <SearchableSelectorList>
          {(entry: BrowserHistoryEntry) => (
            <SearchableSelectorItem
              key={entry.url}
              value={entry}
              title={entry.title ? `${entry.title}\n${entry.url}` : entry.url}
            >
              <Globe2Icon aria-hidden="true" className="text-muted-foreground" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate">{entry.title || entry.url}</span>
                <span className="truncate text-xs text-muted-foreground">{entry.url}</span>
              </span>
            </SearchableSelectorItem>
          )}
        </SearchableSelectorList>
      </SearchableSelectorContent>
    </SearchableSelector>
  );
}
