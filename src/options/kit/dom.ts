// Tiny DOM builder. Text is always set as text (never parsed as HTML); only our own static icon
// markup goes through the SVG parser.

import { icon as kitIcons } from '../../content/ui/core/icons.js';

type Listener = (ev: never) => void;
export type Attr = string | number | boolean | null | undefined | Listener;
export type Attrs = Record<string, Attr>;
export type Child = Node | string | number | null | undefined | false | Child[];

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k === 'class') {
        el.className = String(v);
      } else if (v === true) {
        el.setAttribute(k, '');
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  append(el, children);
  return el;
}

export function append(parent: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(parent, c);
    else if (c instanceof Node) parent.appendChild(c);
    else parent.appendChild(document.createTextNode(String(c)));
  }
}

/** Replace all children. */
export function mount(parent: Element, ...children: Child[]): void {
  parent.replaceChildren();
  append(parent, children);
}

const EXTRA: Record<string, string> = {
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5"/>',
  external: '<path d="M14 5h5v5M19 5l-8 8"/><path d="M17 13.5V18a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5 18V8.5A1.5 1.5 0 0 1 6.5 7H11"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  key: '<circle cx="8" cy="15" r="3.6"/><path d="M10.6 12.4 19 4M15.5 7.5l2.5 2.5M17.5 5.5l1.8 1.8"/>',
  repo: '<path d="M6 4.5h11.5v15H6.8A1.8 1.8 0 0 1 5 17.7V6.3A1.8 1.8 0 0 1 6.8 4.5"/><path d="M5 16.5a1.8 1.8 0 0 1 1.8-1.8h10.7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M19.5 11a7.5 7.5 0 1 0-2.2 5.5"/><path d="M19.5 5v6h-6"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
};

const A = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const markup: Record<string, string> = {
  ...(kitIcons as Record<string, string>),
  ...Object.fromEntries(Object.entries(EXTRA).map(([k, d]) => [k, `<svg class="i" viewBox="0 0 24 24" stroke-width="2" ${A}>${d}</svg>`])),
};

export type IconName = keyof typeof EXTRA | 'commit' | 'push' | 'cloud' | 'link' | 'close' | 'check' | 'alert' | 'init' | 'up';

/** A static icon as an element (our own markup only). */
export function icon(name: IconName): SVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup[name] ?? '';
  return (tpl.content.firstElementChild as SVGElement | null) ?? document.createElementNS('http://www.w3.org/2000/svg', 'svg');
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...children: (SVGElement | null | false)[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) if (c) el.appendChild(c);
  return el;
}

/** Small spinner (an arc that turns). */
export function spinner(): SVGElement {
  return s('svg', { class: 'spin', viewBox: '-10 -10 20 20', 'aria-hidden': 'true' }, s('circle', { r: 8, pathLength: 1 }));
}

/** Middle-truncate a repository path so the chat id at the end stays visible. */
export function midTrunc(p: string, max = 34): string {
  if (p.length <= max) return p;
  const slash = p.indexOf('/') + 1;
  const head = slash > 0 && slash < 14 ? p.slice(0, slash) : '';
  return `${head}…${p.slice(-(max - head.length - 1))}`;
}
