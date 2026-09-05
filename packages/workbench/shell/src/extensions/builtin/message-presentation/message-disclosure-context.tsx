"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

import {
  defaultMessageDisclosureOpen,
  type MessagePresentationDisclosure,
  type MessagePresentationPhase,
} from "./message-presentation-policy";

interface MessageDisclosureContextValue {
  phase: MessagePresentationPhase;
  openByKey: Readonly<Record<string, boolean>>;
  setOpen(key: string, open: boolean): void;
}

const MessageDisclosureContext = createContext<MessageDisclosureContextValue | null>(null);
const MessageDisclosureParentContext = createContext("");
const EMPTY_DISCLOSURES: Readonly<Record<string, boolean>> = Object.freeze({});

interface MessageDisclosureState {
  phase: MessagePresentationPhase;
  openByKey: Readonly<Record<string, boolean>>;
}

export function MessageDisclosureProvider({
  phase,
  children,
}: PropsWithChildren<{ phase: MessagePresentationPhase }>) {
  const [state, setState] = useState<MessageDisclosureState>(() => ({
    phase,
    openByKey: EMPTY_DISCLOSURES,
  }));
  const openByKey = state.phase === phase ? state.openByKey : EMPTY_DISCLOSURES;

  // A phase change resets user overrides, but the provider and its Markdown descendants stay
  // mounted. Re-keying this boundary at stream completion left the old deferred Markdown tree and
  // its replacement on separate browser compositor frames, which appeared as a duplicate ghost.
  useEffect(() => {
    setState((current) =>
      current.phase === phase
        ? current
        : {
            phase,
            openByKey: EMPTY_DISCLOSURES,
          },
    );
  }, [phase]);

  const setOpen = useCallback(
    (key: string, open: boolean) => {
      setState((current) => {
        const currentOpenByKey = current.phase === phase ? current.openByKey : EMPTY_DISCLOSURES;
        const openByKey = { ...currentOpenByKey, [key]: open };
        if (!open) {
          for (const childKey of Object.keys(openByKey)) {
            if (childKey.startsWith(`${key}/`)) openByKey[childKey] = false;
          }
        }
        return { phase, openByKey };
      });
    },
    [phase],
  );
  const value = useMemo(() => ({ phase, openByKey, setOpen }), [openByKey, phase, setOpen]);

  return (
    <MessageDisclosureContext.Provider value={value}>{children}</MessageDisclosureContext.Provider>
  );
}

export function MessageDisclosureScope({
  kind,
  id,
  children,
}: PropsWithChildren<{ kind: MessagePresentationDisclosure; id: string | number }>) {
  const parent = useContext(MessageDisclosureParentContext);
  return (
    <MessageDisclosureParentContext.Provider value={`${parent}${JSON.stringify([kind, id])}/`}>
      {children}
    </MessageDisclosureParentContext.Provider>
  );
}

export function useMessageDisclosure(
  kind: MessagePresentationDisclosure,
  id: string | number,
): readonly [boolean, (open: boolean) => void] {
  const context = useContext(MessageDisclosureContext);
  const parent = useContext(MessageDisclosureParentContext);
  if (!context) {
    throw new Error("useMessageDisclosure must be used within MessageDisclosureProvider");
  }

  const key = `${parent}${JSON.stringify([kind, id])}`;
  const open = context.openByKey[key] ?? defaultMessageDisclosureOpen(kind, context.phase);
  const onOpenChange = useCallback(
    (nextOpen: boolean) => context.setOpen(key, nextOpen),
    [context, key],
  );

  return [open, onOpenChange] as const;
}
