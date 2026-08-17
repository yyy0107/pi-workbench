import { WorkbenchThread } from "@/workbench/chat/workbench-thread";

export default async function ThreadPage({ params }: PageProps<"/c/[threadId]">) {
  const { threadId } = await params;

  return <WorkbenchThread threadId={threadId} />;
}
