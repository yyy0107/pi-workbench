import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "katex/dist/katex.min.css";
import { getRequestLocale, getServerI18n } from "@/i18n/server";
import { WorkbenchApplicationProviders } from "@/workbench/providers/application-providers";
import { createInstalledWebRuntimeConnection } from "@/workbench/providers/installed-web-runtime-connection";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerI18n();

  return {
    title: {
      default: "Pi Workbench",
      template: "%s · Pi Workbench",
    },
    description: t("app.metadata.description"),
    icons: {
      icon: [
        { url: "/icon.png", type: "image/png", sizes: "1024x1024" },
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
      apple: [{ url: "/icon.png", type: "image/png", sizes: "1024x1024" }],
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [locale, requestHeaders] = await Promise.all([getRequestLocale(), headers()]);
  const runtimeConnection = createInstalledWebRuntimeConnection(requestHeaders);

  return (
    <html lang={locale}>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <WorkbenchApplicationProviders
          initialLocale={locale}
          installationId="web-primary"
          runtimeConnection={runtimeConnection}
        >
          {children}
        </WorkbenchApplicationProviders>
      </body>
    </html>
  );
}
