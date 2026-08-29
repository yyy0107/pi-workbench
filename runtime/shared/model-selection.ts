/**
 * Runtime-neutral model choice emitted by the shared Composer model selector.
 *
 * Concrete agent runtimes translate this value to their own initial-session
 * representation at the adapter boundary.
 */
export interface ModelSelection {
  provider: string;
  model: string;
  reasoningEffort?: string;
}
