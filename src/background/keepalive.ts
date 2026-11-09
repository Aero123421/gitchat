/** Keeps the MV3 service worker alive during long work (any extension API call resets its idle timer). */
export async function keepAlive<T>(fn: () => Promise<T>): Promise<T> {
  const timer = setInterval(() => void chrome.runtime.getPlatformInfo(), 20_000);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}
