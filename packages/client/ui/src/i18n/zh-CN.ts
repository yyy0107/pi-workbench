import type { MessageFormatters } from "@workbench/i18n/runtime";

export const uiZhCN = {
  capabilityUnavailable: "当前运行时不支持此功能。",
  colorPicker: {
    hex: "十六进制颜色",
    red: "红",
    green: "绿",
    blue: "蓝",
    hue: "色相",
    saturation: "饱和度与明度",
    saturationValue: (
      { saturation, brightness }: { saturation: number; brightness: number },
      { number }: MessageFormatters,
    ) =>
      `饱和度 ${number(saturation / 100, { style: "percent" })}，明度 ${number(brightness / 100, { style: "percent" })}`,
  },
  toast: {
    regionLabel: "通知提示",
    closeLabel: "关闭提示",
  },
} as const;
