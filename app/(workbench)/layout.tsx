import { WorkbenchClient } from "@/workbench/workbench-client";

export default function WorkbenchLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <WorkbenchClient>{children}</WorkbenchClient>;
}
