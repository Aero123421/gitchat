import { GitchatError } from '../shared/protocol';

export function toGitchatError(e: unknown): GitchatError {
  if (e instanceof GitchatError) return e;
  return new GitchatError(e instanceof Error ? e.message : String(e), 'error');
}
