import { defineMessage } from "../../../i18n";
import { defineExtension } from "@workbench/extension-sdk";

import {
  canRenderGenerativeUIPart,
  GenerativeUIPreview,
  GenerativeUIRenderer,
} from "./generative-ui-renderer";

export const generativeUiExtension = defineExtension({
  id: "workbench.generative-ui",
  name: "Generative UI",
  version: "1.0.0",
  toolbox: {
    kind: "component-extension",
    distribution: "installable",
    name: defineMessage("extensions.generativeUi.name"),
    description: defineMessage("extensions.generativeUi.description"),
    entryFile: "extensions/installable/generative-ui/extension.ts",
    contributions: [
      {
        id: "workbench.generative-ui.message-part",
        kind: "message-part-renderer",
        surface: defineMessage("extensions.generativeUi.placement.surface"),
        target: "context.renderers.parts",
        host: "MessagePrimitive.Parts → MessagePartRendererHost",
        description: defineMessage("extensions.generativeUi.placement.description"),
        preview: GenerativeUIPreview,
        sourceFiles: [
          "extensions/installable/generative-ui/generative-ui-renderer.tsx",
          "extensions/installable/generative-ui/generative-ui.module.css",
          "extensions/installable/generative-ui/generative-ui-spec.ts",
        ],
      },
    ],
  },

  setup(context) {
    return context.renderers.parts.register({
      id: "workbench.generative-ui.message-part",
      canRender: canRenderGenerativeUIPart,
      component: GenerativeUIRenderer,
    });
  },
});
