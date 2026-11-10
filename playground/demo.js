import { createStore } from '../src/content/ui/demo-store.js';
import { advance } from '../src/content/ui/core/spring.js';
import { mountDot } from '../src/content/ui/variants/dot.js';
import { mountLine } from '../src/content/ui/variants/line.js';
import { mountCreature } from '../src/content/ui/variants/creature.js';

const variants = { dot: mountDot, line: mountLine, creature: mountCreature };
const store = createStore();
let current = null;
let host = null;

const read = (k, d) => {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
};
const write = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};

let theme = read('gc-theme', 'light');
// init motion of the creature while one is picked ('' = the current one)
let captureMotion = read('gc-capm', '');
document.documentElement.dataset.theme = theme;
if (read('gc-vivid', '0') === '1') document.body.classList.add('vivid');

function mount(name) {
  if (!variants[name]) name = 'creature';
  current?.destroy();
  host?.remove();
  host = document.createElement('gitchat-ui');
  host.dataset.theme = theme;
  document.body.appendChild(host);
  current = variants[name](host, store, captureMotion ? { captureMotion } : {});
  document.querySelectorAll('[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === name));
  document.querySelectorAll('[data-cm]').forEach((b) => b.classList.toggle('on', b.dataset.cm === captureMotion));
  document.querySelector('.acts').hidden = !current.act;
  history.replaceState(null, '', `#${name}`);
  write('gc-variant', name);
}

document.querySelector('.demo').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.v) return mount(b.dataset.v);
  if (b.dataset.cm !== undefined) {
    captureMotion = b.dataset.cm;
    write('gc-capm', captureMotion);
    return mount(read('gc-variant', 'creature'));
  }
  const act = b.dataset.act;
  if (act === 'reply') store.aiTurn();
  else if (act === 'fail') store.failNextPush();
  else if (act === 'untrack') store.untrack();
  else if (act === 'init') {
    store.untrack();
    store.init();
  }
  else if (act === 'sample') store.resetSample();
  else if (act === 'theme') {
    theme = theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    if (host) host.dataset.theme = theme;
    write('gc-theme', theme);
  } else if (act === 'vivid') {
    write('gc-vivid', document.body.classList.toggle('vivid') ? '1' : '0');
  }
});

// play a behavior from the menu
document.querySelector('.acts').addEventListener('change', (e) => {
  const v = e.target.value;
  if (v === 'ai-long') store.aiTurn({ thinkMs: 7000, streamMs: 3600 });
  else current?.act?.(v);
  e.target.value = '';
});

// the fake chat box: Enter "sends", and the AI "replies" a moment later
const cin = document.querySelector('.cin');
cin.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing || !cin.value.trim()) return;
  cin.value = '';
  store.aiTurn();
});

addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea')) return;
  if (e.key === '1') mount('creature');
  if (e.key === '2') mount('line');
  if (e.key === '3') mount('dot');
  if (e.key === 'r') store.aiTurn();
  if (e.key === 'i') {
    store.untrack();
    store.init();
  }
});

mount(location.hash.slice(1) || read('gc-variant', 'creature'));

// for debugging in the console
window.gitchat = {
  store,
  mount,
  advance,
  get current() {
    return current;
  },
};
