"use client";

import {
  createContext,
  useCallback,
  useContext,
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

export function MessageDisclosureProvider({
  phase,
  children,
}: PropsWithChildren<{ phase: MessagePresentationPhase }>) {
  const [openByKey, setOpenByKey] = useState<Readonly<Record<string, boolean>>>({});
  const setOpen = useCallback((key: string, open: boolean) => {
    setOpenByKey((current) =>
      current[key] === open
        ? current
        : {
            ...current,
            [key]: open,
          },
    );
  }, []);
  const value = useMemo(() => ({ phase, openByKey, setOpen }), [openByKey, phase, setOpen]);

  return (
    <MessageDisclosureContext.Provider value={value}>{children}</MessageDisclosureContext.Provider>
  );
}

export function useMessageDisclosure(
  kind: MessagePresentationDisclosure,
  id: string | number,
): readonly [boolean, (open: boolean) => void] {
  const context = useContext(MessageDisclosureContext);
  if (!context) {
    throw new Error("useMessageDisclosure must be used within MessageDisclosureProvider");
  }

  const key = `${kind}:${id}`;
  const open = context.openByKey[key] ?? defaultMessageDisclosureOpen(kind, context.phase);
  const onOpenChange = useCallback(
    (nextOpen: boolean) => context.setOpen(key, nextOpen),
    [context, key],
  );

  return [open, onOpenChange] as const;
}
