import { AssistantChatTransport } from "@assistant-ui/react-ai-sdk";

import { WORKBENCH_CHAT_ENDPOINT } from "./model-config";

export function createWorkbenchTransport() {
  return new AssistantChatTransport({
    api: WORKBENCH_CHAT_ENDPOINT,
  });
}
