import type { Adapter } from './types';
import { chatgpt } from './chatgpt';
import { claude } from './claude';
import { gemini } from './gemini';

const BY_HOST: Record<string, Adapter> = {
  'chatgpt.com': chatgpt,
  'claude.ai': claude,
  'gemini.google.com': gemini,
};

/** Hosts a chat page can be. Each one needs a manifest match, a sender origin and a frame parent. */
export const ADAPTER_HOSTS = Object.keys(BY_HOST);

/** The adapter for this page, or null on sites gitchat does not support. */
export function adapterFor(hostname: string): Adapter | null {
  return BY_HOST[hostname] ?? null;
}

export const ADAPTERS = { chatgpt, claude, gemini };
