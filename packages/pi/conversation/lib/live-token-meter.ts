import type { PiAssistantMessage } from "@workbench/agent-runtime-pi-protocol/messages";

const ESTIMATED_UTF8_BYTES_PER_TOKEN = 4;
const UTF8_ENCODER = new TextEncoder();

function utf8Bytes(text: string): number {
  return UTF8_ENCODER.encode(text).byteLength;
}

function reportedGeneratedTokens(message: PiAssistantMessage): number | undefined {
  const tokens = message.usage?.output;
  return typeof tokens === "number" && Number.isFinite(tokens) && tokens > 0 ? tokens : undefined;
}

function generatedBytes(
  message: PiAssistantMessage,
  rawToolArgsText?: Readonly<Record<string, string>>,
): number {
  return message.content.reduce((bytes, part, contentIndex) => {
    switch (part.type) {
      case "text":
        return bytes + utf8Bytes(part.text);
      case "thinking":
        return bytes + (part.redacted ? 0 : utf8Bytes(part.thinking));
      case "toolCall": {
        const argumentsText =
          rawToolArgsText?.[String(contentIndex)] ?? JSON.stringify(part.arguments);
        return bytes + utf8Bytes(part.name) + utf8Bytes(argumentsText);
      }
      default:
        return bytes;
    }
  }, 0);
}

export function hasPiGeneratedContent(
  message: PiAssistantMessage,
  rawToolArgsText?: Readonly<Record<string, string>>,
): boolean {
  return (
    reportedGeneratedTokens(message) !== undefined || generatedBytes(message, rawToolArgsText) > 0
  );
}

/**
 * Maintains a monotonic token estimate for one active Pi assistant stream.
 *
 * Pi's cumulative message updates include reasoning, text, and partial tool calls, but most
 * providers report usage only on the terminal event. The meter estimates those cumulative
 * updates at four UTF-8 bytes per token so CJK output is not treated like single-byte Latin text,
 * then yields to positive provider usage as soon as it is available. A terminal provider value
 * may therefore correct the live estimate downward.
 */
export class PiLiveTokenMeter {
  private estimatedTokens = 0;

  observe(
    message: PiAssistantMessage,
    rawToolArgsText?: Readonly<Record<string, string>>,
  ): number | undefined {
    const reportedTokens = reportedGeneratedTokens(message);
    if (reportedTokens !== undefined) return reportedTokens;

    const bytes = generatedBytes(message, rawToolArgsText);
    if (bytes > 0) {
      this.estimatedTokens = Math.max(
        this.estimatedTokens,
        Math.max(1, Math.ceil(bytes / ESTIMATED_UTF8_BYTES_PER_TOKEN)),
      );
    }
    return this.estimatedTokens > 0 ? this.estimatedTokens : undefined;
  }
}
