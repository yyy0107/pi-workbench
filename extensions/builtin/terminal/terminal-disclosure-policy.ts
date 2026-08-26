import type { WorkbenchBashInput } from "@/runtime/terminal/bash-tool-input";

export function shouldExpandBashTerminalForUserInput(
  inputSource: WorkbenchBashInput["source"] | undefined,
  terminalReady: boolean,
  running: boolean,
  open: boolean,
): boolean {
  return running && terminalReady && !open && inputSource === "user";
}

export function shouldRevealBashTerminalForUserInput(
  inputSource: WorkbenchBashInput["source"] | undefined,
  terminalReady: boolean,
  running: boolean,
  alreadyRevealed: boolean,
): boolean {
  return running && terminalReady && !alreadyRevealed && inputSource === "user";
}
