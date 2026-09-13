import type { MessageFormatters } from "@workbench/i18n/runtime";
export const messages = {
  extensions: {
    interactiveRequests: {
      questionTitle: "Question",
      questionDescription: "Answer this request to let the session continue.",
      approvalTitle: "Tool approval required",
      approvalDescription: "Review this tool request before allowing it to run.",
      session: ({ sessionId }: { sessionId: string }) => `Session ${sessionId}`,
      pending: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `${number(count)} pending ${count === 1 ? "request" : "requests"}`,
      answerLabel: ({ question }: { question: string }) => `Answer for ${question}`,
      answerPlaceholder: "Reply…",
      customAnswerLabel: "Other answer",
      customAnswerPlaceholder: "Or write your own response",
      required: "Required",
      yes: "Yes",
      no: "No",
      tool: "Tool",
      callId: "Call ID",
      reason: "Reason",
      submit: "Submit response",
      send: "Send",
      submitAndContinue: "Submit and continue",
      nextQuestion: "Next",
      skip: "Skip",
      timeoutCountdown: ({ seconds }: { seconds: number }, { number }: MessageFormatters) =>
        `Automatically skip this question in ${number(seconds)} seconds`,
      submitting: "Sending…",
      cancel: "Cancel request",
      close: "Close approval request",
      allowOnce: "Allow once",
      reject: "Reject",
      selectedCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
        count === 1 ? "1 selected" : `${number(count)} selected`,
      recommended: "Recommended",
      navigator: {
        title: "Questions",
        position: (
          { current, total }: { current: number; total: number },
          { number }: MessageFormatters,
        ) => `${number(current)} of ${number(total)}`,
        index: ({ index }: { index: number }, { number }: MessageFormatters) => number(index),
        open: (
          { current, total }: { current: number; total: number },
          { number }: MessageFormatters,
        ) => `Open question list, question ${number(current)} of ${number(total)}`,
        previous: "Previous question",
        next: "Next question",
        answered: "Answered",
        unanswered: "Not answered",
      },
      validation: {
        missingRequired: "Answer all required questions before submitting.",
      },
      askUserTool: {
        activityGenerating: "Generating questions",
        activityRunning: "Asking user",
        activityComplete: "Asked user",
        questionCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
          `${number(count)} ${count === 1 ? "question" : "questions"}`,
        history: "Question and answer record",
        waiting: "Waiting for the user's answer",
        unanswered: "No answer submitted",
        cancelledAnswer: "No answer submitted before cancellation",
        cancelled: "The request was cancelled before answers were submitted.",
        interrupted: "The request ended before answers were submitted.",
        disabled: "Ask User was disabled, so no answers were requested.",
      },
      errors: {
        badResponse: "The host rejected this response. Review the fields and try again.",
        notPending: "This request is no longer pending.",
        network: "Could not send the response. Check the connection and try again.",
      },
    },
  },
};
