"use client";

import { createContext, useContext, type PropsWithChildren } from "react";

const DisclosureScrollDirectionContext = createContext(false);

export function DisclosureScrollDirectionProvider({
  preferUpward,
  children,
}: PropsWithChildren<{ preferUpward: boolean }>) {
  return (
    <DisclosureScrollDirectionContext.Provider value={preferUpward}>
      {children}
    </DisclosureScrollDirectionContext.Provider>
  );
}

export function useDisclosureScrollsUpward(): boolean {
  return useContext(DisclosureScrollDirectionContext);
}
