import type { MessageFormatters } from "@workbench/i18n/runtime";
export const messages = {
  extensions: {
    terminal: {
      panelsCategory: "Panels",
      title: "Terminal",
      newTerminal: "New terminal",
      toggleTitle: "Toggle terminal",
      toggleDescription: "Create a new terminal or close the active terminal",
      clear: "Clear terminal display",
      reconnect: "Reconnect terminal",
      output: "Terminal output",
      status: {
        connecting: "Connecting to PTY…",
        connected: "Connected",
        connectedProcess: ({ process, pid }: { process: string; pid: number }) =>
          `${process} · PID ${pid}`,
        disconnected: "PTY disconnected · reconnecting…",
        exited: ({ code }: { code: number }) => `Process exited with code ${code}`,
        error: "The terminal session could not be opened.",
      },
      tool: {
        view: "View in terminal",
        activityComplete: "Ran",
        activityRunning: "Running",
        collapseCommand: "Collapse command",
        expandCommand: "Expand command",
        shellTitle: "Shell",
        statusRunning: "Running",
        statusSuccess: "Success",
        interactionPossible: "May be waiting for input",
        interactionActive: "Terminal input active",
        userInputRequested: "Waiting for your input",
        openTerminal: "Open terminal",
      },
      transcript: {
        output: "Conversation terminal output",
        connecting: "Connecting to command terminal…",
        reconnecting: "Command terminal disconnected · reconnecting…",
        stopping: "Stopping command…",
        connectionError: "The command terminal connection failed",
        stop: "Stop command",
        running: "Running · awaiting process exit notification",
        elapsed: ({ seconds }: { seconds: number }, { number }: MessageFormatters) =>
          `Running for ${number(seconds)} s`,
        quiet: ({ seconds }: { seconds: number }, { number }: MessageFormatters) =>
          `No output for ${number(seconds)} s`,
        processId: ({ pid }: { pid: number }, { number }: MessageFormatters) =>
          `PID ${number(pid, { useGrouping: false })}`,
        exited: ({ code }: { code: number }, { number }: MessageFormatters) =>
          `Process exited · code ${number(code)}`,
        awaitingResult: ({ code }: { code: number }, { number }: MessageFormatters) =>
          `Process exited · code ${number(code)} · waiting for tool result`,
        complete: "Command completed",
        failed: "Command did not complete",
        waiting: "Command is waiting for action",
        interactionPossible: "Command may be waiting for terminal input",
        interactionActive: "Terminal input is active",
        userInputRequested: "The command delegated terminal input to you",
        unavailable: "This command output is not available in the current conversation",
        waitingOutput: "Waiting for output…",
        noOutput: "No output",
      },
    },
  },
};
