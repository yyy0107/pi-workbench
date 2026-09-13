export interface NavigationAdapter {
  newThread(): void;
  openThread(threadId: string): void;
}

export interface BrowserNavigationOptions {
  newThreadPath?: string;
  threadPath?(threadId: string): string;
}

function navigateTo(path: string): void {
  if (typeof window === "undefined") {
    throw new Error("Navigation is only available in the browser");
  }
  window.location.assign(path);
}

export class NavigationService implements NavigationAdapter {
  readonly #adapter: NavigationAdapter;

  constructor(adapter?: NavigationAdapter) {
    this.#adapter = adapter ?? createBrowserNavigationAdapter();
  }

  readonly newThread = (): void => {
    this.#adapter.newThread();
  };

  readonly openThread = (threadId: string): void => {
    if (threadId.trim().length === 0) {
      throw new Error("Thread id must be a non-empty string");
    }
    this.#adapter.openThread(threadId);
  };
}

export function createBrowserNavigationAdapter(
  options: BrowserNavigationOptions = {},
): NavigationAdapter {
  const newThreadPath = options.newThreadPath ?? "/";
  const threadPath =
    options.threadPath ?? ((threadId: string) => `/c/${encodeURIComponent(threadId)}`);

  return {
    newThread: () => navigateTo(newThreadPath),
    openThread: (threadId) => navigateTo(threadPath(threadId)),
  };
}
