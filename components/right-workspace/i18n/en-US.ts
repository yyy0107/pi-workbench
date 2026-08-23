import type { MessageFormatters } from "@/i18n/types";

export const rightWorkspaceEnUS = {
  region: "Inspector workspace",
  expand: "Open inspector workspace",
  collapse: "Close inspector workspace",
  maximize: "Maximize inspector workspace",
  restore: "Restore inspector workspace size",
  resize: "Resize inspector workspace",
  resizeAuxiliary: "Resize auxiliary workspace",
  addSurface: "Open a workspace surface",
  tabs: "Open workspace surfaces",
  closeTab: ({ title }: { title: string }) => `Close ${title}`,
  closeTabAction: "Close Tab",
  closeToRight: "Close Tabs to the Right",
  closeOthers: "Close Other Tabs",
  closeAll: "Close all surfaces",
  pin: "Pin surface",
  unpin: "Unpin surface",
  empty: {
    title: "Open a workspace capability",
    description: "Enabled extensions can add inspector surfaces beside the conversation.",
  },
  status: {
    loading: "Loading surface…",
    disconnected: "The backing resource is disconnected.",
    permissionRequired: "Permission is required to continue.",
    resourceChanged: "The resource changed outside this view.",
    error: "This surface could not be loaded.",
    capabilityUnavailable: "The extension for this surface is not enabled.",
    retry: "Retry",
  },
  feedback: {
    title: "Workspace feedback",
    add: "Add feedback",
    placeholder: "Describe the change you want…",
    save: "Add comment",
    cancel: "Cancel",
    remove: "Remove feedback",
    pending: ({ count }: { count: number }, { number }: MessageFormatters) =>
      `${number(count)} workspace ${count === 1 ? "comment" : "comments"}`,
    composerHint: "These comments will be sent with your next message.",
  },
} as const;
