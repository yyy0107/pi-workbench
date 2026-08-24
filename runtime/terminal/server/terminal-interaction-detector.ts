import type { TerminalInteractionState } from "../contracts";
import { TerminalAnsiTextDecoder } from "./terminal-transcript-projector";

const DEFAULT_QUIET_PERIOD_MS = 1_000;
const DEFAULT_SIGNAL_WINDOW_MS = 5_000;
const DEFAULT_ACTIVE_SETTLE_MS = 500;
const MAX_PROMPT_TAIL_CHARS = 512;

const ESCAPE = "\u001b";
const TUI_SIGNALS = [
  ["cursor-visibility", new RegExp(`${ESCAPE}\\[\\?25[lh]`)],
  ["cursor-position", new RegExp(`${ESCAPE}\\[[0-9;]*[Hf]`)],
  ["cursor-movement", new RegExp(`${ESCAPE}\\[[0-9;]*[ABCDG]`)],
  ["erase", new RegExp(`${ESCAPE}\\[[0-9;]*[JK]`)],
  ["alternate-screen", new RegExp(`${ESCAPE}\\[\\?(?:47|1047|1049)[hl]`)],
] as const;

const TEXT_PROMPT_PATTERNS = [
  /(?:\[(?:y\s*\/\s*n|yes\s*\/\s*no)\]|\((?:y\s*\/\s*n|yes\s*\/\s*no)\))\s*[:?]?\s*$/iu,
  /(?:password|passphrase|verification\s+code|one[- ]time\s+(?:code|password)|otp|密码|口令|验证码)(?:\s+for\s+[^:\r\n]{1,80})?\s*[:：]\s*$/iu,
  /(?:press|hit)\s+(?:enter|return)(?:\s+to\s+[^\r\n]{1,80})?[.… ]*$/iu,
  /(?:continue|proceed|confirm|are\s+you\s+sure|do\s+you\s+want\s+to\s+continue)\s*\?\s*$/iu,
  /(?:enter|input|type)\s+[\p{L}\p{N} _./'"-]{1,48}\s*[:：]\s*$/iu,
  /(?:username|user\s*name|name|email|token|api\s*key|code|path|directory|choice)\s*[:：]\s*$/iu,
  /(?:是否|确认|继续|请输入|请选择)[^\r\n]{0,80}[：:?？]\s*$/u,
] as const;

export interface TerminalInteractionDetectorScheduler {
  now(): number;
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export interface TerminalInteractionDetectorOptions {
  quietPeriodMs?: number;
  signalWindowMs?: number;
  activeSettleMs?: number;
  scheduler?: TerminalInteractionDetectorScheduler;
  onStateChange?: (state: TerminalInteractionState) => void;
}

const defaultScheduler: TerminalInteractionDetectorScheduler = {
  now: () => Date.now(),
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function hasSubstantiveText(data: string): boolean {
  return data.replaceAll("\r", "").trim().length > 0;
}

function isHighConfidenceTextPrompt(value: string): boolean {
  return value.length > 0 && TEXT_PROMPT_PATTERNS.some((pattern) => pattern.test(value));
}

export class TerminalInteractionDetector {
  readonly #quietPeriodMs: number;
  readonly #signalWindowMs: number;
  readonly #activeSettleMs: number;
  readonly #scheduler: TerminalInteractionDetectorScheduler;
  readonly #onStateChange?: (state: TerminalInteractionState) => void;
  readonly #plainTextDecoder = new TerminalAnsiTextDecoder();
  readonly #signals = new Set<string>();
  #state: TerminalInteractionState = "none";
  #lastSignalAt?: number;
  #timer?: unknown;
  #activeTimer?: unknown;
  #promptTail = "";

  constructor(options: TerminalInteractionDetectorOptions = {}) {
    this.#quietPeriodMs = options.quietPeriodMs ?? DEFAULT_QUIET_PERIOD_MS;
    this.#signalWindowMs = options.signalWindowMs ?? DEFAULT_SIGNAL_WINDOW_MS;
    this.#activeSettleMs = options.activeSettleMs ?? DEFAULT_ACTIVE_SETTLE_MS;
    this.#scheduler = options.scheduler ?? defaultScheduler;
    this.#onStateChange = options.onStateChange;
  }

  get state(): TerminalInteractionState {
    return this.#state;
  }

  feed(data: string): void {
    if (!data) return;
    const now = this.#scheduler.now();
    if (this.#lastSignalAt !== undefined && now - this.#lastSignalAt > this.#signalWindowMs) {
      this.#resetCandidate();
    }

    const plainText = this.#plainTextDecoder.feed(data);
    this.#appendPromptTail(plainText);
    const foundTextPrompt = isHighConfidenceTextPrompt(this.#promptTail);
    let foundSignal = false;
    for (const [name, pattern] of TUI_SIGNALS) {
      if (!pattern.test(data)) continue;
      foundSignal = true;
      this.#signals.add(name);
    }
    if ((data.match(/\r(?!\n)/g)?.length ?? 0) >= 2) {
      foundSignal = true;
      this.#signals.add("redraw");
    }
    if (foundTextPrompt) {
      foundSignal = true;
      this.#signals.add("text-prompt");
    }

    if (foundSignal) this.#lastSignalAt = now;
    const substantiveText = hasSubstantiveText(plainText);
    if (this.#state === "possible" && !foundSignal && substantiveText) {
      this.#resetCandidate();
      this.#setState("none");
    }
    if (this.#state === "active" && substantiveText) this.#scheduleActiveReset();
    if (foundTextPrompt || this.#signals.size >= 2) this.#scheduleEvaluation();
  }

  recordInput(): void {
    this.#resetCandidate();
    this.#promptTail = "";
    this.#cancelActiveTimer();
    this.#setState("active");
  }

  finish(): void {
    this.#resetCandidate();
    this.#cancelActiveTimer();
    this.#plainTextDecoder.reset();
    this.#promptTail = "";
    this.#setState("none");
  }

  dispose(): void {
    this.finish();
  }

  #scheduleEvaluation(): void {
    if (this.#timer !== undefined) this.#scheduler.cancel(this.#timer);
    this.#timer = this.#scheduler.schedule(() => {
      this.#timer = undefined;
      const lastSignalAt = this.#lastSignalAt;
      if (
        lastSignalAt === undefined ||
        this.#scheduler.now() - lastSignalAt > this.#signalWindowMs
      ) {
        this.#resetCandidate();
        return;
      }
      this.#setState("possible");
    }, this.#quietPeriodMs);
  }

  #scheduleActiveReset(): void {
    this.#cancelActiveTimer();
    this.#activeTimer = this.#scheduler.schedule(() => {
      this.#activeTimer = undefined;
      if (this.#state === "active") this.#setState("none");
    }, this.#activeSettleMs);
  }

  #cancelActiveTimer(): void {
    if (this.#activeTimer === undefined) return;
    this.#scheduler.cancel(this.#activeTimer);
    this.#activeTimer = undefined;
  }

  #appendPromptTail(text: string): void {
    for (const character of text) {
      if (character === "\r" || character === "\n") {
        this.#promptTail = "";
      } else if (character === "\b" || character === "\u007f") {
        this.#promptTail = Array.from(this.#promptTail).slice(0, -1).join("");
      } else {
        const codePoint = character.codePointAt(0) ?? 0;
        if (codePoint >= 0x20 || character === "\t") this.#promptTail += character;
      }
    }
    if (this.#promptTail.length > MAX_PROMPT_TAIL_CHARS) {
      this.#promptTail = this.#promptTail.slice(-MAX_PROMPT_TAIL_CHARS);
    }
  }

  #resetCandidate(): void {
    if (this.#timer !== undefined) this.#scheduler.cancel(this.#timer);
    this.#timer = undefined;
    this.#signals.clear();
    this.#lastSignalAt = undefined;
  }

  #setState(state: TerminalInteractionState): void {
    if (this.#state === state) return;
    this.#state = state;
    this.#onStateChange?.(state);
  }
}
