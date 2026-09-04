export const AUTOMATION_TASK_PRESETS = [
  {
    id: "morning-briefing",
    nameKey: "extensions.automations.automationHome.templates.morningBriefing.name",
    descriptionKey: "extensions.automations.automationHome.templates.morningBriefing.description",
    promptKey: "extensions.automations.automationHome.templates.morningBriefing.prompt",
    scheduleLabelKey: "extensions.automations.automationHome.weekdayMorning",
    frequency: "weekdays",
    time: "09:00",
  },
  {
    id: "risk-scan",
    nameKey: "extensions.automations.automationHome.templates.riskScan.name",
    descriptionKey: "extensions.automations.automationHome.templates.riskScan.description",
    promptKey: "extensions.automations.automationHome.templates.riskScan.prompt",
    scheduleLabelKey: "extensions.automations.automationHome.dailyMorning",
    frequency: "daily",
    time: "10:00",
  },
  {
    id: "git-standup",
    nameKey: "extensions.automations.automationHome.templates.gitStandup.name",
    descriptionKey: "extensions.automations.automationHome.templates.gitStandup.description",
    promptKey: "extensions.automations.automationHome.templates.gitStandup.prompt",
    scheduleLabelKey: "extensions.automations.automationHome.fridayAfternoon",
    frequency: "custom",
    time: "16:00",
    customCron: "0 16 * * 5",
  },
  {
    id: "docs-sync",
    nameKey: "extensions.automations.automationHome.templates.docsSync.name",
    descriptionKey: "extensions.automations.automationHome.templates.docsSync.description",
    promptKey: "extensions.automations.automationHome.templates.docsSync.prompt",
    scheduleLabelKey: "extensions.automations.automationHome.wednesdayAfternoon",
    frequency: "custom",
    time: "15:00",
    customCron: "0 15 * * 3",
  },
] as const;

export type AutomationTaskPreset = (typeof AUTOMATION_TASK_PRESETS)[number]["id"];

export function findAutomationTaskPreset(preset: AutomationTaskPreset) {
  return AUTOMATION_TASK_PRESETS.find(({ id }) => id === preset);
}
