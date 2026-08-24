"use client";

import { create } from "zustand";

interface ThreadOrderState {
  readonly manualOrderByScope: Readonly<Record<string, readonly string[]>>;
  readonly manualOrderRevisionByScope: Readonly<Partial<Record<string, number>>>;
  setManualOrder(scope: string, threadIds: readonly string[], sortRevision: number): void;
}

export const useThreadOrderStore = create<ThreadOrderState>((set) => ({
  manualOrderByScope: {},
  manualOrderRevisionByScope: {},
  setManualOrder: (scope, threadIds, sortRevision) =>
    set((state) => ({
      manualOrderByScope: {
        ...state.manualOrderByScope,
        [scope]: [...threadIds],
      },
      manualOrderRevisionByScope: {
        ...state.manualOrderRevisionByScope,
        [scope]: sortRevision,
      },
    })),
}));
