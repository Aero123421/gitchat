/** Console logging with a common prefix; debug output only when `localStorage.gitchatDebug = '1'`. */
const PREFIX = '[gitchat]';

function debugEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem('gitchatDebug') === '1';
  } catch {
    return false;
  }
}

export const log = {
  debug: (...args: unknown[]) => {
    if (debugEnabled()) console.debug(PREFIX, ...args);
  },
  info: (...args: unknown[]) => console.info(PREFIX, ...args),
  warn: (...args: unknown[]) => console.warn(PREFIX, ...args),
  error: (...args: unknown[]) => console.error(PREFIX, ...args),
};
