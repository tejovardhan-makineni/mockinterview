const PROVIDER_NAMES: Record<string, string> = {
  gemini: "Gemini",
  openai: "OpenAI",
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  xai: "xAI",
  meta: "Meta",
};
export function providerName(provider: string) {
  return PROVIDER_NAMES[provider.toLowerCase()] ?? provider;
}
