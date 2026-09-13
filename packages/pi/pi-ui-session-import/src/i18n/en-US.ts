export const messages = {
  extensions: {
    externalSessionImport: {
      title: "Import",
      description:
        "Bring local Codex, Claude Code, and Cursor conversations into Pi as native sessions. Source files remain unchanged; system prompts, credentials, encrypted state, and application-only metadata are not copied.",
      refresh: "Scan again",
      selectAll: "Select all available",
      clearSelection: "Clear selection",
      selectedCount: ({ count }: { count: string }) => `${count} selected`,
      importSelected: "Import selected",
      importing: "Importing…",
      empty: "No supported local Codex, Claude Code, or Cursor conversations were found.",
      noSessions: "No conversations were found for this source.",
      selectSession: ({ title }: { title: string }) => `Select ${title} for import`,
      messageCount: ({ count }: { count: string }) => `${count} records`,
      result: ({ imported, skipped }: { imported: string; skipped: string }) =>
        `Imported ${imported}; skipped ${skipped}.`,
      sources: {
        codex: "Codex",
        "claude-code": "Claude Code",
        cursor: "Cursor",
      },
      sourceStatus: {
        ready: "Ready",
        "not-found": "Not installed or no local data",
        error: "This source could not be read",
      },
      states: {
        ready: "Ready",
        imported: "Already imported",
        subagent: "Subagent",
        unknownProject: "Unknown project",
      },
      issues: {
        "source-unavailable": "Source unavailable",
        "source-unreadable": "Source unreadable",
        "workspace-missing": "Project folder no longer exists",
        "workspace-not-directory": "Project path is not a folder",
        "conversation-empty": "No complete conversation",
        "conversation-unsupported": "Unsupported conversation format",
      },
      errors: {
        requestFailed: "The scan or import could not be completed. Try again.",
      },
    },
  },
};
