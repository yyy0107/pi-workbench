import type { ConfigurableProviderView } from "@/runtime/pi/rpc-contracts";

const MODEL_PROVIDER_CREDENTIAL_WEBSITES = {
  "amazon-bedrock": "https://console.aws.amazon.com/bedrock/home",
  anthropic: "https://platform.claude.com/settings/keys",
  "azure-openai-responses": "https://portal.azure.com/",
  baseten: "https://app.baseten.co/settings/api_keys",
  cerebras: "https://cloud.cerebras.ai/platform/",
  "cloudflare-ai-gateway": "https://dash.cloudflare.com/profile/api-tokens",
  "cloudflare-workers-ai": "https://dash.cloudflare.com/profile/api-tokens",
  deepseek: "https://platform.deepseek.com/api_keys",
  fireworks: "https://app.fireworks.ai/settings/users/api-keys",
  "github-copilot": "https://github.com/settings/tokens",
  google: "https://aistudio.google.com/apikey",
  "google-vertex": "https://console.cloud.google.com/apis/credentials",
  groq: "https://console.groq.com/keys",
  huggingface: "https://huggingface.co/settings/tokens",
  "kimi-coding": "https://www.kimi.com/code/console",
  minimax: "https://platform.minimax.io/user-center/basic-information/interface-key",
  "minimax-cn": "https://platform.minimaxi.com/user-center/basic-information/interface-key",
  mistral: "https://console.mistral.ai/api-keys",
  moonshotai: "https://platform.moonshot.ai/console/api-keys",
  "moonshotai-cn": "https://platform.moonshot.cn/console/api-keys",
  nvidia: "https://build.nvidia.com/settings/api-keys",
  openai: "https://platform.openai.com/api-keys",
  openrouter: "https://openrouter.ai/settings/keys",
  "qwen-token-plan": "https://bailian.console.aliyun.com/?apiKey=1#/api-key",
  "qwen-token-plan-cn": "https://bailian.console.aliyun.com/?apiKey=1#/api-key",
  "qwen-token-plan-individual": "https://bailian.console.aliyun.com/?apiKey=1#/api-key",
  together: "https://api.together.ai/settings/api-keys",
  "vercel-ai-gateway": "https://vercel.com/ai-gateway",
  xai: "https://console.x.ai/",
  xiaomi: "https://platform.xiaomimimo.com/",
  "xiaomi-token-plan-ams": "https://platform.xiaomimimo.com/",
  "xiaomi-token-plan-cn": "https://platform.xiaomimimo.com/",
  "xiaomi-token-plan-sgp": "https://platform.xiaomimimo.com/",
  zai: "https://z.ai/manage-apikey/apikey-list",
  "zai-coding-cn": "https://bigmodel.cn/usercenter/proj-mgmt/apikeys",
} as const satisfies Readonly<Record<string, string>>;

export function modelProviderCredentialWebsite(
  provider: Pick<ConfigurableProviderView, "kind" | "provider"> | undefined,
): string | undefined {
  if (!provider || provider.kind !== "built-in") return undefined;
  return MODEL_PROVIDER_CREDENTIAL_WEBSITES[
    provider.provider as keyof typeof MODEL_PROVIDER_CREDENTIAL_WEBSITES
  ];
}
