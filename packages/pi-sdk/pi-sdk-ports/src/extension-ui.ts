import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { QuestionItem } from "@workbench/pi-rpc-contracts/stream";
import type { QuestionAnswerItem } from "@workbench/pi-rpc-contracts/rpc";
type DialogOptions = Parameters<ExtensionUIContext["select"]>[2];
export interface WorkbenchExtensionUIContext {
  workbenchAskUser(
    questions: QuestionItem[],
    options?: DialogOptions,
  ): Promise<QuestionAnswerItem[] | undefined>;
}
