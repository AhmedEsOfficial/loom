/**
 * Approximate token count. Uses the ~4 chars per token heuristic.
 * This avoids a tiktoken dependency while being accurate enough
 * for context budget decisions.
 */
export function estimateTokens(text: string): number {
  // Average ~4 characters per token for English text
  // This is a rough estimate; for precise counting, use tiktoken
  return Math.ceil(text.length / 4);
}

/**
 * Truncate text to approximately maxTokens.
 */
export function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n...[truncated]";
}
