import { $isLinkNode, AutoLinkNode, LinkNode } from "@lexical/link";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNodeByKey } from "lexical";
import { useEffect } from "react";
import { loadWebsiteIcon, websiteIconUrl } from "./website-icon";

/** Decorate links without inserting editable content or changing Markdown serialization. */
export function ComposerLinkIconsPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    let active = true;
    const unregister = [LinkNode, AutoLinkNode].map((nodeClass) =>
      editor.registerMutationListener(
        nodeClass,
        (mutations) => {
          editor.getEditorState().read(() => {
            for (const [key, mutation] of mutations) {
              if (mutation === "destroyed") continue;
              const node = $getNodeByKey(key);
              const element = editor.getElementByKey(key);
              if (!$isLinkNode(node) || !element) continue;
              const href = node.getURL();
              const url = websiteIconUrl(href);
              if (element.dataset.websiteIconUrl === (url ?? "")) continue;
              element.dataset.websiteIconUrl = url ?? "";
              element.classList.toggle("aui-composer-web-link", Boolean(url));
              element.classList.remove("aui-composer-web-link-loaded");
              element.style.removeProperty("--website-icon");
              if (!url) continue;
              void loadWebsiteIcon(href).then((src) => {
                if (
                  !active ||
                  !src ||
                  editor.getElementByKey(key) !== element ||
                  element.dataset.websiteIconUrl !== url
                )
                  return;
                element.style.setProperty("--website-icon", `url(${JSON.stringify(src)})`);
                element.classList.add("aui-composer-web-link-loaded");
              });
            }
          });
        },
        { skipInitialization: false },
      ),
    );
    return () => {
      active = false;
      unregister.forEach((dispose) => dispose());
    };
  }, [editor]);
  return null;
}
