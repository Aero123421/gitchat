import type { Adapter } from './types';
import { chatgpt } from './chatgpt';
import { claude } from './claude';
import { gemini } from './gemini';

const BY_HOST: Record<string, Adapter> = {
  'chatgpt.com': chatgpt,
  'chat.openai.com': chatgpt,
  'claude.ai': claude,
  'gemini.google.com': gemini,
};

/** The adapter for this page, or null on sites gitchat does not support. */
export function adapterFor(hostname: string): Adapter | null {
  return BY_HOST[hostname] ?? null;
}

export const ADAPTERS = { chatgpt, claude, gemini };
