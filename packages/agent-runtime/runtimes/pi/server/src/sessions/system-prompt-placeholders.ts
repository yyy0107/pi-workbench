import {
  type AgentSession,
  getDocsPath,
  getExamplesPath,
  getReadmePath,
} from "@earendil-works/pi-coding-agent";

/** Expand only configured prompt files, before Pi appends project context and skills. */
export function installSystemPromptPlaceholders(
  session: AgentSession,
  {
    environment = process.env,
    platform = process.platform,
  }: {
    environment?: Readonly<NodeJS.ProcessEnv>;
    platform?: NodeJS.Platform;
  } = {},
): void {
  const loader = session.resourceLoader;
  const getSystemPrompt = loader.getSystemPrompt.bind(loader);
  const getAppendSystemPrompt = loader.getAppendSystemPrompt.bind(loader);

  const expand = (template: string): string => {
    if (!template.includes("{{pi.")) return template;
    const toolNames = session.getActiveToolNames();
    const tools = toolNames
      .map((name) => session.getToolDefinition(name))
      .filter((tool) => tool !== undefined);
    // This conditional guideline belongs to Pi's prompt builder rather than a tool definition.
    const explorationGuidelines =
      toolNames.includes("bash") && !["grep", "find", "ls"].some((name) => toolNames.includes(name))
        ? ["Use bash for file operations like ls, rg, find"]
        : [];
    const shell =
      session.settingsManager.getShellPath()?.trim() ||
      environment.PI_WORKBENCH_TERMINAL_SHELL?.trim() ||
      environment.WORKBENCH_TERMINAL_SHELL?.trim() ||
      environment.SHELL?.trim() ||
      (platform === "win32" ? "powershell.exe" : "/bin/bash");
    const usesWsl = platform === "win32" && /(?:^|[\\/])wsl(?:\.exe)?$/iu.test(shell);
    const platformName = usesWsl
      ? "WSL"
      : platform === "win32"
        ? "Windows native"
        : platform === "darwin"
          ? "macOS"
          : platform === "linux"
            ? "Linux"
            : platform;
    const values = {
      cwd: session.sessionManager.getCwd().replaceAll("\\", "/"),
      terminal_environment: `${platformName}; shell: ${usesWsl ? "bash" : shell}`,
      tools:
        tools
          .map((tool) => `- ${tool.name}: ${tool.promptSnippet || tool.description}`)
          .join("\n") || "(none)",
      tool_guidelines: [
        ...new Set(
          [...explorationGuidelines, ...tools.flatMap((tool) => tool.promptGuidelines ?? [])]
            .map((guideline) => guideline.trim())
            .filter(Boolean),
        ),
      ]
        .map((guideline) => `- ${guideline}`)
        .join("\n"),
      readme: getReadmePath(),
      docs: getDocsPath(),
      examples: getExamplesPath(),
    };
    // One pass: values containing placeholder-like text are never interpreted again.
    return template.replace(
      /\{\{pi\.(cwd|terminal_environment|tools|tool_guidelines|readme|docs|examples)\}\}/gu,
      (_match, name: keyof typeof values) => values[name],
    );
  };

  loader.getSystemPrompt = () => {
    const template = getSystemPrompt();
    return template === undefined ? undefined : expand(template);
  };
  loader.getAppendSystemPrompt = () => getAppendSystemPrompt().map(expand);
  // Pi also rebuilds through these getters on tool changes, extension binding, and reload.
  session.setActiveToolsByName(session.getActiveToolNames());
}
