"use client";

import {
  ChartColumnIcon,
  CheckIcon,
  Code2Icon,
  FileTextIcon,
  GlobeIcon,
  ImageIcon,
  SearchIcon,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { PanelComponentProps } from "@/platform/extensions";

interface SkillItem {
  id: string;
  title: string;
  category: string;
  description: string;
  icon: LucideIcon;
  iconClassName: string;
}

const SKILLS: readonly SkillItem[] = [
  {
    id: "research",
    title: "Research",
    category: "Knowledge",
    description: "Find, compare, and synthesize trusted sources.",
    icon: SearchIcon,
    iconClassName: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  {
    id: "code-review",
    title: "Code review",
    category: "Development",
    description: "Inspect changes for bugs and maintainability risks.",
    icon: Code2Icon,
    iconClassName: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  },
  {
    id: "documents",
    title: "Documents",
    category: "Productivity",
    description: "Draft and refine structured documents.",
    icon: FileTextIcon,
    iconClassName: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  {
    id: "visual-studio",
    title: "Visual studio",
    category: "Creative",
    description: "Plan and create polished visual assets.",
    icon: ImageIcon,
    iconClassName: "bg-pink-500/10 text-pink-600 dark:text-pink-400",
  },
  {
    id: "data-analysis",
    title: "Data analysis",
    category: "Analysis",
    description: "Explore datasets and surface useful patterns.",
    icon: ChartColumnIcon,
    iconClassName: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  {
    id: "browser",
    title: "Browser control",
    category: "Automation",
    description: "Navigate and inspect browser-based workflows.",
    icon: GlobeIcon,
    iconClassName: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  },
];

const DEFAULT_ENABLED_SKILLS = new Set(["research", "code-review", "documents", "data-analysis"]);

export function SkillsPanel({ panelId }: PanelComponentProps) {
  const [query, setQuery] = useState("");
  const [enabledSkills, setEnabledSkills] = useState(DEFAULT_ENABLED_SKILLS);

  const filteredSkills = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return SKILLS;

    return SKILLS.filter((skill) =>
      `${skill.title} ${skill.category} ${skill.description}`
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [query]);

  const toggleSkill = (skillId: string) => {
    setEnabledSkills((current) => {
      const next = new Set(current);
      if (next.has(skillId)) next.delete(skillId);
      else next.add(skillId);
      return next;
    });
  };

  return (
    <section data-panel-id={panelId} className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 border-b p-3">
        <p className="mb-2 text-[11px] leading-4 text-muted-foreground">
          Enable the local capabilities available to this workbench preview.
        </p>
        <label className="relative block">
          <span className="sr-only">Search skills</span>
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            placeholder="Search skills"
            className="h-8 w-full rounded-lg border border-border bg-muted/35 pr-3 pl-8 text-xs outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-ring focus:bg-background focus:ring-2 focus:ring-ring/20"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <div className="space-y-1">
          {filteredSkills.map((skill) => {
            const Icon = skill.icon;
            const isEnabled = enabledSkills.has(skill.id);

            return (
              <button
                key={skill.id}
                type="button"
                role="switch"
                aria-checked={isEnabled}
                className="group flex w-full items-start gap-2.5 rounded-xl p-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                onClick={() => toggleSkill(skill.id)}
              >
                <span
                  className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${skill.iconClassName}`}
                >
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-medium">{skill.title}</span>
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] leading-none text-muted-foreground">
                      {skill.category}
                    </span>
                  </span>
                  <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">
                    {skill.description}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className={`mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
                    isEnabled
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-background text-transparent"
                  }`}
                >
                  <CheckIcon className="size-2.5" />
                </span>
              </button>
            );
          })}

          {filteredSkills.length === 0 && (
            <div className="flex flex-col items-center px-6 py-12 text-center">
              <SearchIcon className="mb-2 size-5 text-muted-foreground/60" />
              <p className="text-xs font-medium">No matching skills</p>
              <p className="mt-1 text-[11px] text-muted-foreground">Try a broader search term.</p>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t px-3 py-2 text-[10px] text-muted-foreground">
        {enabledSkills.size} of {SKILLS.length} enabled locally
      </div>
    </section>
  );
}
