"use client";

import { ThreadListPrimitive } from "@assistant-ui/react";
import { CirclePlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function NewThreadButton({
  className,
  onNavigate,
}: {
  className?: string;
  onNavigate?: () => void;
}) {
  const router = useRouter();

  const openNewThreadRoute = () => {
    router.push("/");
    onNavigate?.();
  };

  return (
    <ThreadListPrimitive.New asChild onClick={openNewThreadRoute}>
      <button
        type="button"
        data-slot="button"
        className={cn(
          buttonVariants({ variant: "ghost" }),
          "border-border bg-background hover:bg-accent h-10 w-full justify-center gap-1.5 rounded-xl border px-3 text-sm font-medium shadow-xs",
          className,
        )}
      >
        <CirclePlusIcon className="size-4" />
        新建会话
      </button>
    </ThreadListPrimitive.New>
  );
}
