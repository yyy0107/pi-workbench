const SUPPORTED_COMPONENTS = [
  "Button",
  "Caption",
  "Card",
  "Col",
  "Divider",
  "Header",
  "Icon",
  "Image",
  "ListView",
  "ListViewItem",
  "Row",
  "Spacer",
  "Text",
] as const;

export const GENERATIVE_UI_COMPONENT_NAMES: readonly string[] = SUPPORTED_COMPONENTS;

const supportedComponentNames = new Set<string>(SUPPORTED_COMPONENTS);
const fencedSpecPattern = /^```(?:json|aui|generative-ui)?\s*\n([\s\S]*?)\n```$/i;
const maximumSpecDepth = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeImageSource(value: unknown): boolean {
  if (typeof value !== "string") return false;

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function validAction(value: unknown): boolean {
  return value === undefined || (isRecord(value) && typeof value.type === "string");
}

function validNode(node: unknown, depth: number): boolean {
  if (depth > maximumSpecDepth) return false;
  if (typeof node === "string" || typeof node === "number") return true;
  if (node === null || typeof node === "boolean") return true;
  if (Array.isArray(node)) return node.every((child) => validNode(child, depth + 1));
  if (!isRecord(node)) return false;

  const component = node.$type;
  if (typeof component !== "string" || !supportedComponentNames.has(component)) return false;
  if (!validAction(node.$action)) return false;
  if (component === "Image" && !safeImageSource(node.src)) return false;

  return node.children === undefined || validNode(node.children, depth + 1);
}

function validRoot(node: unknown): boolean {
  if (Array.isArray(node)) {
    return node.length > 0 && node.every((child) => isRecord(child) && validNode(child, 0));
  }
  return isRecord(node) && validNode(node, 0);
}

function parseTextSpec(value: string): unknown {
  const trimmed = value.trim();
  const fenced = fencedSpecPattern.exec(trimmed);
  const source = fenced?.[1] ?? trimmed;
  if (source === "") return undefined;

  try {
    return JSON.parse(source);
  } catch {
    return undefined;
  }
}

/**
 * 只接受完整且位于 allowlist 中的生成式 UI 树。普通 JSON 或混合正文仍走消息原有的文本
 * renderer，避免根据局部内容进行猜测。
 */
export function readGenerativeUISpec(value: unknown): unknown | undefined {
  const candidate = typeof value === "string" ? parseTextSpec(value) : value;
  return validRoot(candidate) ? candidate : undefined;
}
