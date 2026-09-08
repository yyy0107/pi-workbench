import type { MessageFormatters } from "../../i18n/types";

export const uiZhCN = {
  fileLink: {
    openFailed: "无法打开文件，请确认文件在当前连接的主机上存在且可访问。",
  },
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
