export type AutomationInvalidFocusTarget =
  | "title"
  | "addSchedule"
  | "customCron"
  | "time"
  | "maxRunDuration"
  | "prompt"
  | "workspace";

export interface AutomationInvalidFocusState {
  readonly titleMissing: boolean;
  readonly hasSchedule: boolean;
  readonly customCronInvalid: boolean;
  readonly scheduleUsesTime: boolean;
  readonly timeInvalid: boolean;
  readonly maxRunDurationInvalid: boolean;
  readonly promptMissing: boolean;
  readonly workspaceMissing: boolean;
}

export interface AutomationInvalidFocusTargets {
  readonly title: { focus(): void } | null;
  readonly addSchedule: { focus(): void } | null;
  readonly customCron: { focus(): void } | null;
  readonly time: { focus(): void } | null;
  readonly maxRunDuration: { focus(): void } | null;
  readonly prompt: { focus(): void } | null;
  readonly workspace: { focus(): void } | null;
}

/** Focuses the first invalid field owned by one AutomationTaskForm installation. */
export function focusFirstInvalidAutomationField(
  state: AutomationInvalidFocusState,
  targets: AutomationInvalidFocusTargets,
): AutomationInvalidFocusTarget | undefined {
  let key: AutomationInvalidFocusTarget | undefined;
  if (state.titleMissing) key = "title";
  else if (!state.hasSchedule) key = "addSchedule";
  else if (state.customCronInvalid) key = "customCron";
  else if (state.scheduleUsesTime && state.timeInvalid) key = "time";
  else if (state.maxRunDurationInvalid) key = "maxRunDuration";
  else if (state.promptMissing) key = "prompt";
  else if (state.workspaceMissing) key = "workspace";

  if (!key) return undefined;
  const target = targets[key];
  if (!target) return undefined;
  target.focus();
  return key;
}
