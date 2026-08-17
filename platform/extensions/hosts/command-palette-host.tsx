"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import type { CommandDefinition } from "../api/command";
import { useExtensionEnvironment } from "../extension-context";
import { formatShortcut, matchesShortcut } from "@/services/command-service";

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
  placeholder = "Type a command or search…",
  emptyMessage = "No commands found.",
}: CommandPaletteHostProps) {
  const { commands: commandService, reportError } = useExtensionEnvironment();
  const commands = useSyncExternalStore(
    commandService.subscribe,
    commandService.getAll,
    () => EMPTY_COMMANDS,
  );
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? internalOpen;
  const paletteShortcut = useMemo(
    () =>
      typeof shortcut === "string" ? shortcut.split("+").map((token) => token.trim()) : shortcut,
    [shortcut],
  );

  const setOpen = useCallback(
    (nextOpen: boolean) => {
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
      });
    },
    [commandService, reportError, setOpen],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;

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
  }, [commandService, executeCommand, open, paletteShortcut, setOpen]);

  const groupedCommands = useMemo(() => {
    const groups = new Map<string, CommandDefinition[]>();
    for (const command of commands) {
      const category = command.category ?? "Commands";
      const group = groups.get(category);
      if (group) group.push(command);
      else groups.set(category, [command]);
    }
    return Array.from(groups);
  }, [commands]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      className={className}
      title="Command Palette"
      description="Search for a workbench command to run."
    >
      <Command>
        <CommandInput placeholder={placeholder} autoFocus />
        <CommandList>
          <CommandEmpty>{emptyMessage}</CommandEmpty>
          {groupedCommands.map(([category, categoryCommands]) => (
            <CommandGroup key={category} heading={category}>
              {categoryCommands.map((command) => {
                const Icon = command.icon;
                return (
                  <CommandItem
                    key={command.id}
                    value={`${command.title} ${command.description ?? ""} ${category}`}
                    onSelect={() => executeCommand(command.id)}
                  >
                    {Icon ? <Icon aria-hidden="true" /> : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{command.title}</span>
                      {command.description ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {command.description}
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
