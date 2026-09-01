"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { MainViewHost as ExtensionMainViewHost } from "@workbench/extension-host/hosts/main-view-host";

export function MainViewHost({ children }: Readonly<{ children: ReactNode }>) {
  return <ExtensionMainViewHost navigationKey={usePathname()}>{children}</ExtensionMainViewHost>;
}
