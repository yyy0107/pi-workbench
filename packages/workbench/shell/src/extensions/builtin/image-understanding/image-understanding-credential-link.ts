import {
  getOcrAdapterPreset,
  type OcrAdapterPresetId,
} from "@workbench/attachment-understanding-contracts/ocr-adapter";

export interface OcrCredentialWebsite {
  readonly href: string;
  readonly provider: "GLM-OCR" | "PaddleOCR";
}

const CREDENTIAL_WEBSITES = {
  "glm-ocr": {
    href: "https://bigmodel.cn/usercenter/proj-mgmt/apikeys",
    provider: "GLM-OCR",
  },
  paddleocr: {
    href: "https://aistudio.baidu.com/paddleocr",
    provider: "PaddleOCR",
  },
} as const satisfies Record<"glm-ocr" | "paddleocr", OcrCredentialWebsite>;

export function ocrCredentialWebsiteForPreset(
  presetId: OcrAdapterPresetId,
): OcrCredentialWebsite | undefined {
  if (presetId === "custom") return undefined;
  return CREDENTIAL_WEBSITES[getOcrAdapterPreset(presetId).credentialSlot];
}
