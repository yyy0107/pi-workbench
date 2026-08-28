export const AUTOMATION_TASK_PRESETS = [
  {
    id: "morning-briefing",
    nameKey: "extensions.workflows.automationHome.templates.morningBriefing.name",
    descriptionKey: "extensions.workflows.automationHome.templates.morningBriefing.description",
    promptKey: "extensions.workflows.automationHome.templates.morningBriefing.prompt",
    scheduleLabelKey: "extensions.workflows.automationHome.weekdayMorning",
    frequency: "weekdays",
    time: "09:00",
  },
  {
    id: "risk-scan",
    nameKey: "extensions.workflows.automationHome.templates.riskScan.name",
    descriptionKey: "extensions.workflows.automationHome.templates.riskScan.description",
    promptKey: "extensions.workflows.automationHome.templates.riskScan.prompt",
    scheduleLabelKey: "extensions.workflows.automationHome.dailyMorning",
    frequency: "daily",
    time: "10:00",
  },
  {
    id: "git-standup",
    nameKey: "extensions.workflows.automationHome.templates.gitStandup.name",
    descriptionKey: "extensions.workflows.automationHome.templates.gitStandup.description",
    promptKey: "extensions.workflows.automationHome.templates.gitStandup.prompt",
    scheduleLabelKey: "extensions.workflows.automationHome.fridayAfternoon",
    frequency: "custom",
    time: "16:00",
    customCron: "0 16 * * 5",
  },
  {
    id: "docs-sync",
    nameKey: "extensions.workflows.automationHome.templates.docsSync.name",
    descriptionKey: "extensions.workflows.automationHome.templates.docsSync.description",
    promptKey: "extensions.workflows.automationHome.templates.docsSync.prompt",
    scheduleLabelKey: "extensions.workflows.automationHome.wednesdayAfternoon",
    frequency: "custom",
    time: "15:00",
    customCron: "0 15 * * 3",
  },
] as const;

export type AutomationTaskPreset = (typeof AUTOMATION_TASK_PRESETS)[number]["id"];

export function findAutomationTaskPreset(preset: AutomationTaskPreset) {
  return AUTOMATION_TASK_PRESETS.find(({ id }) => id === preset);
}
