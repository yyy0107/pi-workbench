import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { projectPiComposerContext } from "../../../src/composer-context/index";
export * from "../../../src/composer-context/index";
export const composerContextExtension: ExtensionFactory = (pi) => {
  pi.on("context", (event, context) => ({
    messages: projectPiComposerContext(event.messages, context.sessionManager.getBranch()),
  }));
};

export default composerContextExtension;
