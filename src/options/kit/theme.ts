// Paints the settings page and the popup. The kit CSS follows the OS unless `data-theme` is set.
// The toolbar icon cannot follow: Chrome allows a single icon for the extension.

import type { Settings } from '../../shared/types';

/** Light or Dark pins the page. Auto removes the attribute so the kit CSS follows the OS. */
export function applyPageTheme(theme: Settings['theme']): void {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else root.removeAttribute('data-theme');
}
