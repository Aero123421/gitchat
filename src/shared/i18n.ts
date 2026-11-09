/** Localized string from _locales (falls back to the key, e.g. in tests or the playground). */
export function t(key: string, substitutions?: string | string[]): string {
  try {
    const s = globalThis.chrome?.i18n?.getMessage(key, substitutions);
    if (s) return s;
  } catch {
    // not running inside the extension
  }
  return key;
}
