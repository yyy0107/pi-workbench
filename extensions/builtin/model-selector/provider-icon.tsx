import { ApertureIcon, BoxesIcon, RouteIcon, WavesIcon, type LucideIcon } from "lucide-react";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.09-1.92 3.27-4.76 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.43.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.77.42 3.44 1.18 4.94l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1a11 11 0 0 0-9.82 6.06L5.84 9.9c.87-2.6 3.3-4.52 6.16-4.52Z"
      />
    </svg>
  );
}

function Lettermark({ children, className }: { children: string; className?: string }) {
  return (
    <span className={`text-sm leading-none font-semibold ${className ?? ""}`}>{children}</span>
  );
}

const lucideProviders: readonly [test: RegExp, icon: LucideIcon, className?: string][] = [
  [/openai|codex|gpt/, ApertureIcon],
  [/deepseek/, WavesIcon, "text-blue-600 dark:text-blue-400"],
  [/groq/, BoxesIcon, "text-orange-600 dark:text-orange-400"],
  [/openrouter/, RouteIcon, "text-violet-600 dark:text-violet-400"],
];

export function ProviderIcon({ provider, modelName }: { provider: string; modelName: string }) {
  const normalized = `${modelName} ${provider}`.toLowerCase();

  if (/google|gemini/.test(normalized)) return <GoogleIcon />;
  if (/anthropic|claude/.test(normalized)) return <Lettermark className="font-serif">A</Lettermark>;
  if (/xai|grok/.test(normalized)) return <Lettermark className="font-black">X</Lettermark>;
  if (/mistral/.test(normalized)) {
    return <Lettermark className="text-orange-600 dark:text-orange-400">M</Lettermark>;
  }
  if (/qwen/.test(normalized)) return <Lettermark className="text-violet-600">Q</Lettermark>;
  if (/kimi/.test(normalized)) return <Lettermark className="text-sky-600">K</Lettermark>;

  const matched = lucideProviders.find(([test]) => test.test(normalized));
  if (matched) {
    const Icon = matched[1];
    return <Icon className={matched[2]} strokeWidth={2.2} />;
  }

  return <Lettermark>{provider.slice(0, 1).toUpperCase()}</Lettermark>;
}
