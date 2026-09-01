import type { Metadata } from "next";
import "katex/dist/katex.min.css";

import { desktopRendererEnUS } from "./i18n/en-US";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Pi Workbench",
    template: "%s · Pi Workbench",
  },
  description: desktopRendererEnUS.metadata.description,
  icons: {
    icon: [
      { url: "/app-icon.svg", type: "image/svg+xml" },
      {
        url: "/pi-logo-on-light.svg",
        type: "image/svg+xml",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/pi-logo-on-dark.svg",
        type: "image/svg+xml",
        media: "(prefers-color-scheme: dark)",
      },
    ],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-US" suppressHydrationWarning>
      <body
        data-workbench-desktop-renderer="1"
        className="font-sans antialiased [&_button_svg.lucide]:size-4 [&_svg.lucide]:[stroke-width:1.5]"
      >
        {children}
      </body>
    </html>
  );
}
