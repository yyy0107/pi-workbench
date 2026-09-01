"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "../ui/command";
import { useI18n } from "../i18n";
import { shellOwnsKeyboardEvent } from "../keyboard-shortcut-owner";
import { useWorkbenchPortalContainer } from "../ui/workbench-portal-container";
import type { CommandDefinition } from "@workbench/extension-sdk";
import { useCommandService, useExtensionErrorReporter } from "@workbench/extension-host";
import { formatShortcut, matchesShortcut } from "@workbench/extension-host/services";

const EMPTY_COMMANDS = Object.freeze([]) as readonly CommandDefinition[];
const DEFAULT_PALETTE_SHORTCUT = Object.freeze(["Mod", "K"]);

export interface CommandPaletteHostProps {
  className?: string;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?(open: boolean): void;
  shortcut?: readonly string[] | string;
  placeholder?: string;
  emptyMessage?: string;
  ownerRootRef: RefObject<HTMLElement | null>;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export function CommandPaletteHost({
  className,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  shortcut = DEFAULT_PALETTE_SHORTCUT,
  placeholder,
  emptyMessage,
  ownerRootRef,
}: CommandPaletteHostProps) {
  const { t, text } = useI18n();
  const commandService = useCommandService();
  const reportError = useExtensionErrorReporter();
  const commands = useSyncExternalStore(
    commandService.subscribe,
    commandService.getAll,
    () => EMPTY_COMMANDS,
  );
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [executionError, setExecutionError] = useState<string>();
  const portalContainer = useWorkbenchPortalContainer();
  const open = controlledOpen ?? internalOpen;
  const paletteShortcut = useMemo(
    () =>
      typeof shortcut === "string" ? shortcut.split("+").map((token) => token.trim()) : shortcut,
    [shortcut],
  );

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) setExecutionError(undefined);
      if (controlledOpen === undefined) setInternalOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [controlledOpen, onOpenChange],
  );

  const executeCommand = useCallback(
    (commandId: string) => {
      setOpen(false);
      void commandService.execute(commandId).catch((error: unknown) => {
        reportError(error, { source: "command", commandId });
        setExecutionError(t("platform.extensions.commandPalette.executionFailed"));
        setOpen(true);
      });
    },
    [commandService, reportError, setOpen, t],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      if (!shellOwnsKeyboardEvent(ownerRootRef.current, event, portalContainer?.current)) {
        return;
      }

      if (matchesShortcut(event, paletteShortcut)) {
        event.preventDefault();
        setOpen(!open);
        return;
      }

      const command = commandService.findByKeyboardEvent(event);
      if (!command) return;
      if (isEditableTarget(event.target) && !event.altKey && !event.ctrlKey && !event.metaKey) {
        return;
      }

      event.preventDefault();
      executeCommand(command.id);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    commandService,
    executeCommand,
    open,
    ownerRootRef,
    paletteShortcut,
    portalContainer,
    setOpen,
  ]);

  const groupedCommands = useMemo(() => {
    const groups = new Map<
      string,
      Array<{ command: CommandDefinition; title: string; description?: string }>
    >();
    for (const command of commands) {
      const category = command.category
        ? text(command.category)
        : t("platform.extensions.commandPalette.defaultCategory");
      const localizedCommand = {
        command,
        title: text(command.title),
        description: command.description ? text(command.description) : undefined,
      };
      const group = groups.get(category);
      if (group) group.push(localizedCommand);
      else groups.set(category, [localizedCommand]);
    }
    return Array.from(groups);
  }, [commands, t, text]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      className={className}
      title={t("platform.extensions.commandPalette.title")}
      description={t("platform.extensions.commandPalette.description")}
      closeLabel={t("platform.extensions.commandPalette.close")}
    >
      <Command>
        {executionError ? (
          <p className="text-destructive px-3 py-2 text-sm" role="alert">
            {executionError}
          </p>
        ) : null}
        <CommandInput
          placeholder={placeholder ?? t("platform.extensions.commandPalette.placeholder")}
          autoFocus
        />
        <CommandList>
          <CommandEmpty>
            {emptyMessage ?? t("platform.extensions.commandPalette.empty")}
          </CommandEmpty>
          {groupedCommands.map(([category, categoryCommands]) => (
            <CommandGroup key={category} heading={category}>
              {categoryCommands.map(({ command, title, description }) => {
                const Icon = command.icon;
                return (
                  <CommandItem
                    key={command.id}
                    value={`${title} ${description ?? ""} ${category}`}
                    onSelect={() => executeCommand(command.id)}
                  >
                    {Icon ? <Icon aria-hidden="true" /> : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{title}</span>
                      {description ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {description}
                        </span>
                      ) : null}
                    </span>
                    {command.shortcut ? (
                      <CommandShortcut>{formatShortcut(command.shortcut)}</CommandShortcut>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
