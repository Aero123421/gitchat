// Line icons (24x24, stroke). Drawn by hand to avoid external icon fonts in the extension.

const P = {
  commit: '<circle cx="12" cy="12" r="3.6"/><path d="M3 12h5.4M15.6 12H21"/>',
  push: '<path d="M8 18.5H7a4.2 4.2 0 0 1-.4-8.38A5.6 5.6 0 0 1 17.4 10.5 4 4 0 0 1 17 18.5h-1"/><path d="M12 20.5v-8M9 15.3l3-3 3 3"/>',
  cloud: '<path d="M7 18.5h10a4 4 0 0 0 .5-7.97A5.6 5.6 0 0 0 6.6 10.1 4.2 4.2 0 0 0 7 18.5Z"/>',
  link: '<path d="M10 14a4.2 4.2 0 0 0 6 0l3-3a4.24 4.24 0 0 0-6-6l-1 1"/><path d="M14 10a4.2 4.2 0 0 0-6 0l-3 3a4.24 4.24 0 0 0 6 6l1-1"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
  alert: '<path d="M12 8.5v4.5M12 16.6v.01"/><path d="M10.3 3.9 2.6 17.6A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-2.9L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  init: '<circle cx="6.5" cy="6" r="2.2"/><circle cx="6.5" cy="18" r="2.2"/><path d="M6.5 8.2v7.6"/><path d="M14 12h7M17.5 8.5v7"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
};

const A = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

export const icon = Object.fromEntries(
  Object.entries(P).map(([k, d]) => [k, `<svg class="i" viewBox="0 0 24 24" stroke-width="2" ${A}>${d}</svg>`]),
);

// Icon placed inside another SVG.
export const nestedIcon = (name, size = 24, x = 0, y = 0, sw = 2) =>
  `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 24 24" stroke-width="${sw}" ${A}>${P[name]}</svg>`;
