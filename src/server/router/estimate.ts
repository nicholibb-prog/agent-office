// Token pre-estimate (funnel #15, #37): Groq takes only tasks under 6K tokens (its TPM); tasks
// over 100K go only to Laguna (OpenRouter) or Okkin.
export const GROQ_MAX_TOKENS = 6000;
export const HUGE_TOKENS = 100_000;

/** About 4 characters a token, rounded up; an explicit estimate wins when it is larger. */
export function estimateTokens(text: string, explicit?: number): number {
  const est = Math.ceil(text.length / 4);
  return typeof explicit === 'number' && Number.isFinite(explicit) && explicit > est ? Math.ceil(explicit) : est;
}

/** May a task of this size go to this provider/model? */
export function sizeAllows(provider: string, model: string, tokens: number): boolean {
  if (provider === 'groq' && tokens >= GROQ_MAX_TOKENS) return false;
  if (tokens > HUGE_TOKENS) return provider === 'okkin' || (provider === 'openrouter' && /laguna/i.test(model));
  return true;
}
