"use strict";
(() => {
  // src/shared/protocol.ts
  var GitchatError = class extends Error {
    constructor(message, code = "error") {
      super(message);
      this.code = code;
      this.name = "GitchatError";
    }
    code;
  };
  async function request(type, payload) {
    const env = { gitchat: 1, type, payload };
    const reply = await chrome.runtime.sendMessage(env);
    if (!reply) throw new GitchatError("No reply from the background worker", "no-reply");
    if (!reply.ok) throw new GitchatError(reply.error, reply.code);
    return reply.data;
  }

  // src/shared/i18n.ts
  function t(key, substitutions) {
    try {
      const s2 = globalThis.chrome?.i18n?.getMessage(key, substitutions);
      if (s2) return s2;
    } catch {
    }
    return key;
  }

  // src/shared/types.ts
  var chatKey = (service, chatId) => `${service}:${chatId}`;

  // src/content/ui/core/icons.js
  var P = {
    commit: '<circle cx="12" cy="12" r="3.6"/><path d="M3 12h5.4M15.6 12H21"/>',
    push: '<path d="M8 18.5H7a4.2 4.2 0 0 1-.4-8.38A5.6 5.6 0 0 1 17.4 10.5 4 4 0 0 1 17 18.5h-1"/><path d="M12 20.5v-8M9 15.3l3-3 3 3"/>',
    cloud: '<path d="M7 18.5h10a4 4 0 0 0 .5-7.97A5.6 5.6 0 0 0 6.6 10.1 4.2 4.2 0 0 0 7 18.5Z"/>',
    link: '<path d="M10 14a4.2 4.2 0 0 0 6 0l3-3a4.24 4.24 0 0 0-6-6l-1 1"/><path d="M14 10a4.2 4.2 0 0 0-6 0l-3 3a4.24 4.24 0 0 0 6 6l1-1"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
    alert: '<path d="M12 8.5v4.5M12 16.6v.01"/><path d="M10.3 3.9 2.6 17.6A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-2.9L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
    init: '<circle cx="6.5" cy="6" r="2.2"/><circle cx="6.5" cy="18" r="2.2"/><path d="M6.5 8.2v7.6"/><path d="M14 12h7M17.5 8.5v7"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>'
  };
  var A = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  var icon = Object.fromEntries(
    Object.entries(P).map(([k, d]) => [k, `<svg class="i" viewBox="0 0 24 24" stroke-width="2" ${A}>${d}</svg>`])
  );

  // src/options/kit/dom.ts
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === void 0 || v === false) continue;
        if (typeof v === "function") {
          el.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === "class") {
          el.className = String(v);
        } else if (v === true) {
          el.setAttribute(k, "");
        } else {
          el.setAttribute(k, String(v));
        }
      }
    }
    append(el, children);
    return el;
  }
  function append(parent, children) {
    for (const c of children) {
      if (c === null || c === void 0 || c === false) continue;
      if (Array.isArray(c)) append(parent, c);
      else if (c instanceof Node) parent.appendChild(c);
      else parent.appendChild(document.createTextNode(String(c)));
    }
  }
  function mount(parent, ...children) {
    parent.replaceChildren();
    append(parent, children);
  }
  var EXTRA = {
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
    search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>'
  };
  var A2 = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  var markup = {
    ...icon,
    ...Object.fromEntries(Object.entries(EXTRA).map(([k, d]) => [k, `<svg class="i" viewBox="0 0 24 24" stroke-width="2" ${A2}>${d}</svg>`]))
  };
  function icon2(name) {
    const tpl = document.createElement("template");
    tpl.innerHTML = markup[name] ?? "";
    return tpl.content.firstElementChild ?? document.createElementNS("http://www.w3.org/2000/svg", "svg");
  }
  var SVG_NS = "http://www.w3.org/2000/svg";
  function s(tag, attrs = {}, ...children) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    for (const c of children) if (c) el.appendChild(c);
    return el;
  }
  function spinner() {
    return s("svg", { class: "spin", viewBox: "-10 -10 20 20", "aria-hidden": "true" }, s("circle", { r: 8, pathLength: 1 }));
  }
  function midTrunc(p, max = 34) {
    if (p.length <= max) return p;
    const slash = p.indexOf("/") + 1;
    const head = slash > 0 && slash < 14 ? p.slice(0, slash) : "";
    return `${head}\u2026${p.slice(-(max - head.length - 1))}`;
  }

  // src/shared/settings.ts
  var DEFAULT_SETTINGS = {
    widget: "creature",
    theme: "auto",
    autoCommit: false,
    autoPush: false,
    repo: null,
    services: { chatgpt: true, claude: true, gemini: true },
    saveVisualizations: true,
    githubClientId: ""
  };
  var KEY = "settings";
  function normalizeSettings(raw) {
    const s2 = raw && typeof raw === "object" ? raw : {};
    const out = {
      ...DEFAULT_SETTINGS,
      ...s2,
      services: { ...DEFAULT_SETTINGS.services, ...s2.services ?? {} },
      // Missing on settings saved before theme existed; anything else unknown is Auto too.
      theme: s2.theme === "light" || s2.theme === "dark" || s2.theme === "auto" ? s2.theme : "auto"
    };
    if (!["creature", "line", "dot"].includes(out.widget)) out.widget = DEFAULT_SETTINGS.widget;
    if (out.autoPush) out.autoCommit = true;
    return out;
  }
  function applySettingsPatch(current, patch) {
    const merged = { ...current, ...patch, services: { ...current.services, ...patch.services ?? {} } };
    if (patch.autoCommit === false) merged.autoPush = false;
    if (patch.autoPush === true) merged.autoCommit = true;
    return normalizeSettings(merged);
  }
  function onSettingsChanged(fn) {
    const listener = (changes, area) => {
      if (area === "sync" && changes[KEY]) fn(normalizeSettings(changes[KEY].newValue));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }

  // src/options/kit/dev-shim.ts
  function isExtension() {
    const g = globalThis;
    return !!g.chrome?.runtime?.id;
  }
  function format(entry, subs2) {
    if (!entry) return "";
    const arr = subs2 == null ? [] : Array.isArray(subs2) ? subs2.map(String) : [String(subs2)];
    let msg = entry.message;
    for (const [name, ph] of Object.entries(entry.placeholders ?? {})) {
      const val = ph.content.replace(/\$(\d)/g, (_m, d) => arr[Number(d) - 1] ?? "");
      msg = msg.replace(new RegExp(`\\$${name}\\$`, "gi"), val);
    }
    return msg.replace(/\$(\d)/g, (_m, d) => arr[Number(d) - 1] ?? "");
  }
  var ago = (m) => Date.now() - m * 6e4;
  function demoStatus(kind) {
    const commits = [
      { id: "c7", n: 4, t: ago(12), pushed: false },
      { id: "c6", n: 2, t: ago(41), pushed: false },
      { id: "c5", n: 6, t: ago(190), pushed: true },
      { id: "c4", n: 3, t: ago(600), pushed: true },
      { id: "c3", n: 8, t: ago(1500), pushed: true },
      { id: "c2", n: 12, t: ago(3e3), pushed: true }
    ];
    const tracked2 = kind !== "untracked";
    return {
      key: "claude:a1b2c3d4e5f6",
      service: "claude",
      chatId: "a1b2c3d4e5f6",
      tracked: tracked2,
      path: tracked2 ? "claude/2026-11-09-state-design--a1b2c3d4.md" : void 0,
      staged: tracked2 ? [
        { id: "s1", role: "user", kind: "text" },
        { id: "s2", role: "assistant", kind: "math" },
        { id: "s3", role: "assistant", kind: "viz" }
      ] : [],
      commits: tracked2 ? commits : [],
      aheadTotal: tracked2 ? 2 : 0,
      phase: kind === "pushing" ? "pushing" : "idle",
      webUrl: tracked2 ? "https://github.com/octocat/ai-chats/blob/main/claude/2026-11-09-state-design--a1b2c3d4.md" : void 0
    };
  }
  async function installDevShim() {
    if (isExtension()) return false;
    const params = new URLSearchParams(location.search);
    const lang = params.get("lang") ?? (navigator.language.toLowerCase().startsWith("ja") ? "ja" : "en");
    const theme = params.get("theme");
    if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
    const messages = await fetch(`_locales/${lang}/messages.json`).then((r) => r.ok ? r.json() : {}).catch(() => ({}));
    const scenario = params.get("demo") ?? "";
    const noClientId = params.get("nocid") === "1";
    let settings = { ...DEFAULT_SETTINGS };
    if (theme === "light" || theme === "dark") settings.theme = theme;
    let auth = null;
    if (["signedin", "settings", "chat", "untracked", "new", "other", "pushing", ""].includes(scenario) && scenario !== "onboarding") {
      auth = { token: "demo", method: "device", login: "octocat", scopes: ["repo"], savedAt: Date.now() };
    }
    if (["settings", "chat", "untracked", "new", "other", "pushing"].includes(scenario) || scenario === "" && location.pathname.endsWith("popup.html")) {
      settings = { ...settings, repo: { owner: "octocat", name: "ai-chats", branch: "main" } };
    }
    if (scenario === "setup") {
      auth = null;
      settings = { ...settings, repo: null };
    }
    let status = demoStatus(scenario || "chat");
    const repos = [
      { owner: "octocat", name: "ai-chats", private: true, defaultBranch: "main", empty: true, managed: false },
      { owner: "octocat", name: "chat-history", private: true, defaultBranch: "main", empty: false, managed: true },
      { owner: "octocat", name: "notes", private: true, defaultBranch: "main", empty: false, managed: false },
      { owner: "octocat", name: "website", private: false, defaultBranch: "main", empty: false, managed: false },
      { owner: "octocat", name: "dotfiles", private: false, defaultBranch: "master", empty: false, managed: false },
      { owner: "octo-org", name: "research-log", private: true, defaultBranch: "main", empty: true, managed: false }
    ];
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const fail = (error, code) => ({ ok: false, error, code });
    async function handle(env) {
      const p = env.payload;
      await sleep(120);
      switch (env.type) {
        case "settings/get":
          return { ok: true, data: settings };
        case "settings/set":
          settings = applySettingsPatch(settings, p.patch);
          return { ok: true, data: settings };
        case "auth/get":
          return { ok: true, data: auth && { login: auth.login, method: auth.method, scopes: auth.scopes } };
        case "auth/device/start":
          if (noClientId) return fail("No OAuth client ID is configured", "no-client-id");
          return { ok: true, data: { userCode: "WDJB-MJHT", verificationUri: "https://github.com/login/device", expiresIn: 900, interval: 5 } };
        case "auth/device/wait":
          await sleep(3500);
          auth = { token: "demo", method: "device", login: "octocat", scopes: ["repo"], savedAt: Date.now() };
          return { ok: true, data: { login: "octocat" } };
        case "auth/pat": {
          const token = String(p.token ?? "");
          if (token.length < 10) return fail("GitHub did not accept this token", "bad-token");
          auth = { token, method: "pat", login: "octocat", scopes: [], savedAt: Date.now() };
          return { ok: true, data: { login: "octocat" } };
        }
        case "auth/signout":
          auth = null;
          return { ok: true, data: null };
        case "repo/list":
          await sleep(600);
          return { ok: true, data: repos };
        case "repo/create": {
          await sleep(700);
          const name = String(p.name);
          if (name === "notes") return fail("A repository with this name already exists", "repo-exists");
          settings = { ...settings, repo: { owner: "octocat", name, branch: "main" } };
          return { ok: true, data: settings.repo };
        }
        case "repo/use":
          await sleep(500);
          settings = { ...settings, repo: { owner: String(p.owner), name: String(p.name), branch: String(p.branch ?? "main") } };
          return { ok: true, data: settings.repo };
        case "sync/status":
          return { ok: true, data: { repo: settings.repo, pending: status.aheadTotal, lastPushAt: ago(3) } };
        case "chat/status":
          return { ok: true, data: status };
        case "chat/commit":
          if (!status.staged.length) return fail("Nothing to commit", "nothing");
          status = { ...status, commits: [{ id: `c${Date.now()}`, n: status.staged.length, t: Date.now(), pushed: false }, ...status.commits], staged: [], aheadTotal: status.aheadTotal + 1 };
          return { ok: true, data: status };
        case "chat/push": {
          const staged = status.staged.length ? [{ id: `c${Date.now()}`, n: status.staged.length, t: Date.now(), pushed: false }] : [];
          status = { ...status, phase: "pushing", staged: [], commits: [...staged, ...status.commits] };
          setTimeout(() => {
            status = { ...status, phase: "idle", aheadTotal: 0, commits: status.commits.map((c) => ({ ...c, pushed: true })) };
          }, 1600);
          return { ok: true, data: status };
        }
        default:
          return fail(`Not available in the preview: ${env.type}`, "preview");
      }
    }
    const noop = () => void 0;
    const fake = {
      runtime: {
        sendMessage: (env) => handle(env),
        openOptionsPage: () => {
          location.href = "options.html";
        },
        getURL: (p) => p,
        onMessage: { addListener: noop, removeListener: noop }
      },
      i18n: {
        getMessage: (key, subs2) => format(messages[key], subs2),
        getUILanguage: () => lang
      },
      tabs: {
        query: async () => [{ id: 1, active: true }],
        sendMessage: async (_id, msg) => {
          await sleep(60);
          if (scenario === "other") throw new Error("Could not establish connection. Receiving end does not exist.");
          if (msg.type === "content/init") {
            status = { ...status, phase: "capturing", progress: 0.1 };
            return { ok: true };
          }
          if (scenario === "new") return { service: "chatgpt", chatId: null, title: "", status: null };
          return { service: status.service, chatId: status.chatId, title: "State design for a mid-size React app", status };
        },
        create: ({ url }) => window.open(url, "_blank", "noopener")
      },
      storage: {
        onChanged: { addListener: noop, removeListener: noop }
      }
    };
    globalThis.chrome = fake;
    console.info(`[gitchat] preview mode (no extension runtime): demo=${scenario || "default"} lang=${lang}`);
    return true;
  }

  // src/options/kit/errors.ts
  function errorText(e) {
    const code = typeof e === "object" && e && "code" in e ? String(e.code) : "";
    const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
    switch (code) {
      case "no-reply":
        return t("errNoReply");
      case "unauthorized":
      case "auth":
      case "bad-credentials":
      case "token-invalid":
      case "not-signed-in":
      case "no-auth":
        return t("errAuth");
      case "bad-token":
        return t("errBadToken");
      case "rate-limited":
      case "rate-limit":
        return t("errRateLimit");
      case "network":
      case "offline":
        return t("errNetwork");
      case "not-found":
        return t("errNotFound");
      case "forbidden":
      case "no-permission":
        return t("errNoPermission");
      case "expired":
      case "expired_token":
        return t("codeExpired");
      case "denied":
      case "access_denied":
        return t("errDenied");
      case "repo-exists":
      case "name-taken":
        return t("errRepoExists");
      case "no-repo":
        return t("errNoRepo");
      case "repo-not-empty":
        return t("errRepoNotEmpty");
      default:
        return msg || t("errGeneric");
    }
  }

  // src/content/ui/core/spring.js
  var Spring = class {
    constructor(value = 0, { stiffness = 170, damping = 20, mass = 1 } = {}) {
      this.value = value;
      this.target = value;
      this.velocity = 0;
      this.k = stiffness;
      this.c = damping;
      this.m = mass;
    }
    set(target) {
      this.target = target;
      return this;
    }
    snap(v = this.target) {
      this.value = this.target = v;
      this.velocity = 0;
      return this;
    }
    kick(v) {
      this.velocity += v;
      return this;
    }
    config(stiffness, damping) {
      this.k = stiffness;
      this.c = damping;
      return this;
    }
    step(dt) {
      const n = Math.max(1, Math.ceil(dt * 240));
      const h2 = dt / n;
      for (let i = 0; i < n; i++) {
        const a = (-this.k * (this.value - this.target) - this.c * this.velocity) / this.m;
        this.velocity += a * h2;
        this.value += this.velocity * h2;
      }
      return this.value;
    }
  };
  var FULL = 60;
  var subs = /* @__PURE__ */ new Set();
  var raf = 0;
  var timer = 0;
  var last = 0;
  var wakeUntil = 0;
  var reducedQuery = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  var motion = {
    get reduced() {
      return !!reducedQuery?.matches;
    }
  };
  function loop(now) {
    raf = 0;
    const dt = Math.min(0.12, Math.max(0, (now - last) / 1e3));
    last = now;
    const t2 = now / 1e3;
    let want = now < wakeUntil ? FULL : 0;
    for (const fn of [...subs]) {
      const r = fn(dt, t2);
      want = Math.max(want, r === true ? FULL : typeof r === "number" ? r : 0);
    }
    if (subs.size && want > 0) schedule(want);
  }
  function schedule(fps) {
    if (raf) return;
    if (fps >= 45) {
      clearTimeout(timer);
      timer = 0;
      raf = requestAnimationFrame(loop);
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = 0;
        if (!raf) raf = requestAnimationFrame(loop);
      }, 1e3 / fps);
    }
  }
  function wake(ms = 1200) {
    wakeUntil = Math.max(wakeUntil, performance.now() + ms);
    if (!subs.size) return;
    if (!raf && !timer) last = performance.now();
    schedule(FULL);
  }
  function moving(springs, eps = 4e-3) {
    for (const s2 of springs) if (Math.abs(s2.velocity) > eps || Math.abs(s2.value - s2.target) > eps) return true;
    return false;
  }
  function onFrame(fn) {
    subs.add(fn);
    wake(300);
    return () => subs.delete(fn);
  }
  function springEasing({ stiffness = 200, damping = 20, mass = 1 } = {}) {
    let x = 0;
    let v = 0;
    let t2 = 0;
    const dt = 1 / 600;
    const vals = [0];
    while (t2 < 4) {
      for (let i = 0; i < 10; i++) {
        const a = (-stiffness * (x - 1) - damping * v) / mass;
        v += a * dt;
        x += v * dt;
        t2 += dt;
      }
      vals.push(x);
      if (t2 > 0.1 && Math.abs(x - 1) < 2e-3 && Math.abs(v) < 0.02) break;
    }
    vals[vals.length - 1] = 1;
    const step = Math.max(1, Math.ceil(vals.length / 90));
    const pts = [];
    for (let i = 0; i < vals.length; i += step) pts.push(+vals[i].toFixed(4));
    if (pts[pts.length - 1] !== 1) pts.push(1);
    return { easing: `linear(${pts.join(",")})`, duration: Math.round(t2 * 1e3) };
  }
  var clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // src/content/ui/core/glass.js
  var SPRING = springEasing({ stiffness: 420, damping: 38 });
  var glassCSS = `
:host {
  all: initial;
  position: fixed; top: 0; left: 0; width: 0; height: 0;
  z-index: 2147483000;
  --ink: #111113; --ink-2: rgba(17,17,19,.56); --ink-3: rgba(17,17,19,.26); --ink-4: rgba(17,17,19,.12);
  --line: rgba(0,0,0,.07); --hover: rgba(0,0,0,.045);
  --tint: rgba(255,255,255,.2); --tint-strong: rgba(247,247,249,.72);
  --rim: rgba(255,255,255,.85); --hi: rgba(255,255,255,.95); --lo: rgba(255,255,255,.35); --edge: rgba(0,0,0,.11);
  --shadow: rgba(0,0,0,.14); --glare: rgba(255,255,255,.16);
  --accent: #0a84ff; --err: #e5484d;
  --dot: #bcbcc1; --track: rgba(120,120,128,.2); --thumb: #fff;
  --spring: ${SPRING.easing};
  --mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif;
}
:host([data-theme="dark"]) {
  --ink: #ececee; --ink-2: rgba(236,236,238,.58); --ink-3: rgba(236,236,238,.28); --ink-4: rgba(236,236,238,.13);
  --line: rgba(255,255,255,.08); --hover: rgba(255,255,255,.06);
  --tint: rgba(255,255,255,.04); --tint-strong: rgba(34,34,37,.72);
  --rim: rgba(255,255,255,.32); --hi: rgba(255,255,255,.45); --lo: rgba(255,255,255,.12); --edge: rgba(0,0,0,.5);
  --shadow: rgba(0,0,0,.5); --glare: rgba(255,255,255,.06);
  --dot: #5c5c62; --track: rgba(120,120,128,.36); --thumb: #f2f2f4;
}
* { box-sizing: border-box; }
button { font: inherit; }
.lg { position: relative; border-radius: var(--r, 999px); }
.lg > .lg-b {
  position: absolute; inset: 0; border-radius: inherit;
  background: var(--tint);
  -webkit-backdrop-filter: blur(12px) saturate(1.4);
  backdrop-filter: blur(12px) saturate(1.4);
}
.lg > .lg-h {
  position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  box-shadow:
    inset 0 0 0 .5px var(--edge),
    inset 1px 1px 0 -.25px var(--hi),
    inset -1px -1px 0 -.5px var(--lo),
    0 8px 24px -10px var(--shadow),
    0 1px 2px var(--shadow);
  background: radial-gradient(80% 50% at var(--lx, 30%) var(--ly, 0%), var(--glare), transparent 70%);
}
.lg > .lg-h::after {
  content: ''; position: absolute; inset: 0; border-radius: inherit; padding: 1px;
  background: conic-gradient(from var(--la, 315deg),
    var(--rim), transparent 14%, transparent 36%,
    color-mix(in srgb, var(--rim) 35%, transparent) 50%,
    transparent 64%, transparent 86%, var(--rim));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
}
`;
  var NS = "http://www.w3.org/2000/svg";
  var maps = /* @__PURE__ */ new Map();
  function sdRoundRect(px, py, hw, hh, r) {
    const qx = Math.abs(px) - (hw - r);
    const qy = Math.abs(py) - (hh - r);
    return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
  }
  function lensMap(w, h2, r, bezel) {
    const key = `${w}x${h2}r${r}b${bezel}`;
    if (maps.has(key)) return maps.get(key);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h2;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(w, h2);
    const d = img.data;
    const hw = w / 2;
    const hh = h2 / 2;
    r = Math.min(r, hw, hh);
    for (let y = 0; y < h2; y++) {
      for (let x = 0; x < w; x++) {
        const px = x + 0.5 - hw;
        const py = y + 0.5 - hh;
        const sd = sdRoundRect(px, py, hw, hh, r);
        let dx = 0;
        let dy = 0;
        if (sd < 0 && -sd < bezel) {
          const t2 = 1 + sd / bezel;
          const s2 = t2 * t2;
          const gx = sdRoundRect(px + 0.5, py, hw, hh, r) - sdRoundRect(px - 0.5, py, hw, hh, r);
          const gy = sdRoundRect(px, py + 0.5, hw, hh, r) - sdRoundRect(px, py - 0.5, hw, hh, r);
          const gl = Math.hypot(gx, gy) || 1;
          dx = -(gx / gl) * s2;
          dy = -(gy / gl) * s2;
        }
        const i = (y * w + x) * 4;
        d[i] = Math.round(128 + dx * 127);
        d[i + 1] = Math.round(128 + dy * 127);
        d[i + 2] = 128;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const url = c.toDataURL();
    maps.set(key, url);
    return url;
  }
  var fid = 0;
  function applyLens(root, target, { w, h: h2, r, bezel = 16, scale = 34, blur = 0.8, sat = 1.8, bright = 1.04 }) {
    w = Math.max(2, Math.round(w));
    h2 = Math.max(2, Math.round(h2));
    let defs = root.querySelector("svg.lg-defs");
    if (!defs) {
      defs = document.createElementNS(NS, "svg");
      defs.setAttribute("class", "lg-defs");
      defs.setAttribute("aria-hidden", "true");
      defs.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
      root.appendChild(defs);
    }
    if (!target.dataset.lens) target.dataset.lens = `lens-${++fid}`;
    const id = target.dataset.lens;
    let f = defs.querySelector(`#${id}`);
    if (!f) {
      f = document.createElementNS(NS, "filter");
      f.id = id;
      f.setAttribute("x", "0");
      f.setAttribute("y", "0");
      f.setAttribute("width", "100%");
      f.setAttribute("height", "100%");
      f.setAttribute("color-interpolation-filters", "sRGB");
      const im2 = document.createElementNS(NS, "feImage");
      im2.setAttribute("result", "map");
      im2.setAttribute("x", "0");
      im2.setAttribute("y", "0");
      im2.setAttribute("preserveAspectRatio", "none");
      const dm = document.createElementNS(NS, "feDisplacementMap");
      dm.setAttribute("in", "SourceGraphic");
      dm.setAttribute("in2", "map");
      dm.setAttribute("xChannelSelector", "R");
      dm.setAttribute("yChannelSelector", "G");
      f.append(im2, dm);
      defs.appendChild(f);
    }
    const im = f.querySelector("feImage");
    im.setAttribute("href", lensMap(w, h2, r, bezel));
    im.setAttribute("width", w);
    im.setAttribute("height", h2);
    f.querySelector("feDisplacementMap").setAttribute("scale", scale);
    const v = `url(#${id}) blur(${blur}px) saturate(${sat}) brightness(${bright})`;
    target.style.backdropFilter = v;
    target.style.webkitBackdropFilter = v;
  }
  function setLight(el, lx, ly) {
    const len = Math.hypot(lx, ly) || 1;
    const ux = lx / len;
    const uy = ly / len;
    el.style.setProperty("--lx", `${(50 + ux * 36).toFixed(1)}%`);
    el.style.setProperty("--ly", `${(50 + uy * 40).toFixed(1)}%`);
    el.style.setProperty("--la", `${(Math.atan2(uy, ux) * 180 / Math.PI + 90).toFixed(1)}deg`);
  }

  // src/options/kit/glass.ts
  var tracked = /* @__PURE__ */ new Set();
  var lastX = -1e4;
  var lastY = -1e4;
  var raf2 = 0;
  function updateLights() {
    raf2 = 0;
    for (const el of tracked) {
      if (!el.isConnected) {
        tracked.delete(el);
        continue;
      }
      const r = el.getBoundingClientRect();
      if (lastX < -1e3) setLight(el, -0.6, -0.8);
      else setLight(el, lastX - (r.left + r.width / 2), lastY - (r.top + r.height / 2));
    }
  }
  addEventListener(
    "pointermove",
    (e) => {
      lastX = e.clientX;
      lastY = e.clientY;
      if (!raf2) raf2 = requestAnimationFrame(updateLights);
    },
    { passive: true }
  );
  function glass(el, opts) {
    el.classList.add("lg");
    el.style.borderRadius = `${opts.radius}px`;
    const b = document.createElement("div");
    b.className = "lg-b";
    const hl = document.createElement("div");
    hl.className = "lg-h";
    el.prepend(b, hl);
    tracked.add(el);
    let key = "";
    const refresh = () => {
      const w = Math.round(el.offsetWidth);
      const h2 = Math.round(el.offsetHeight);
      if (w < 8 || h2 < 8) return;
      const k = `${Math.round(w / 6)}x${Math.round(h2 / 6)}`;
      if (k === key) return;
      key = k;
      applyLens(document.body, b, {
        w,
        h: h2,
        r: Math.min(opts.radius, w / 2, h2 / 2),
        bezel: opts.bezel ?? 14,
        scale: opts.scale ?? 22,
        blur: opts.blur ?? 10,
        sat: 1.35,
        bright: 1.03
      });
    };
    const ro = new ResizeObserver(() => refresh());
    ro.observe(el);
    requestAnimationFrame(() => {
      refresh();
      updateLights();
    });
    return el;
  }

  // src/content/ui/core/format.js
  function fmtAgo(t2, now = Date.now()) {
    const m = Math.round((now - t2) / 6e4);
    if (m < 1) return "now";
    if (m < 60) return `${m}m`;
    const h2 = Math.round(m / 60);
    if (h2 < 24) return `${h2}h`;
    return `${Math.round(h2 / 24)}d`;
  }

  // src/options/kit/graph.ts
  var ROW = 22;
  var X = 9;
  var MAX = 5;
  function renderGraph(status, width) {
    const newestFirst = status.commits.slice(0, MAX);
    const visible = [...newestFirst].reverse();
    const hasTail = status.commits.length > MAX;
    const rows = visible.map((c) => ({ kind: "commit", n: c.n, t: c.t, pushed: c.pushed }));
    if (status.tracked) rows.push({ kind: "work", n: status.staged.length });
    const top = hasTail ? 18 : 9;
    const y = (i) => top + i * ROW;
    const height = rows.length ? y(rows.length - 1) + 10 : 20;
    const svg = s("svg", {
      class: `graph${status.phase === "pushing" ? " sending" : ""}${status.phase === "error" ? " err" : ""}`,
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
      role: "img"
    });
    const commitIdx = rows.map((r, i) => r.kind === "commit" ? i : -1).filter((i) => i >= 0);
    const first = commitIdx[0];
    const last2 = commitIdx[commitIdx.length - 1];
    const firstAhead = rows.findIndex((r) => r.kind === "commit" && !r.pushed);
    const anyPushed = status.commits.some((c) => c.pushed);
    const originRow = firstAhead === -1 ? rows.length - (status.tracked ? 1 : 0) : firstAhead;
    const oy = y(originRow - 0.5);
    if (first !== void 0 && last2 !== void 0) {
      const fy = y(first);
      const ly = y(last2);
      if (hasTail) svg.append(s("path", { class: "ln tail", d: `M${X} ${fy - 15}V${fy - 6}` }));
      const pEnd = anyPushed ? Math.min(oy, ly) : fy;
      if (pEnd > fy) svg.append(s("path", { class: "ln pushed", d: `M${X} ${fy}V${pEnd}` }));
      const aStart = anyPushed ? Math.max(oy, fy) : fy;
      if (ly > aStart) svg.append(s("path", { class: "ln ahead", d: `M${X} ${aStart}V${ly}` }));
      if (status.tracked) svg.append(s("path", { class: "ln work", d: `M${X} ${ly + 3.5}V${y(rows.length - 1) - 5}` }));
    }
    if (anyPushed && rows.length) svg.append(s("line", { class: "origin", x1: 0, x2: width, y1: oy, y2: oy }));
    rows.forEach((r, i) => {
      const g = s("g", { class: `row ${r.kind}${r.kind === "commit" && !r.pushed ? " ahead" : ""}`, transform: `translate(0 ${y(i)})` });
      g.style.animationDelay = `${i * 35}ms`;
      if (r.kind === "work") {
        g.append(s("circle", { class: `wk${r.n ? "" : " empty"}`, cx: X, r: 4.2 }));
        if (r.n) g.append(text(`+${r.n}`, X + 14, "lab"));
      } else {
        g.append(s("circle", { class: "dot", cx: X, r: 3.1 }));
        g.append(text(`+${r.n}`, X + 14, "lab"));
        const ago2 = text(fmtAgo(r.t), width - 2, "ago");
        g.append(ago2);
      }
      svg.append(g);
    });
    return svg;
  }
  function text(str, x, cls) {
    const el = s("text", { class: cls, x, y: 4 });
    el.textContent = str;
    return el;
  }
  var graphCSS = `
.graph { display: block; overflow: visible; }
.graph .ln { fill: none; stroke-width: 1; }
.graph .ln.pushed { stroke: var(--ink-4); }
.graph .ln.ahead { stroke: var(--accent); }
.graph .ln.work, .graph .ln.tail { stroke: var(--ink-3); stroke-dasharray: 1.5 2.5; }
.graph .origin { stroke: var(--ink-3); stroke-width: 1; stroke-dasharray: 1 2.5; }
.graph.sending .origin { stroke: var(--accent); }
.graph.err .origin { stroke: var(--err); }
.graph .row { animation: kit-fade .3s ease-out both; }
.graph .dot { fill: var(--dot); }
.graph .row.ahead .dot { fill: var(--accent); }
.graph .wk { fill: none; stroke: var(--ink); stroke-width: 1.2; }
.graph .wk.empty { stroke: var(--ink-3); }
.graph text { font: 500 11px/1 var(--mono); font-variant-numeric: tabular-nums; }
.graph .lab { fill: var(--ink); }
.graph .row:not(.ahead):not(.work) .lab { fill: var(--ink-2); }
.graph .ago { fill: var(--ink-3); text-anchor: end; }
`;

  // src/shared/creature-art.js
  var CREATURE_COLORS = {
    light: { body: "#f3f3f6", edge: "rgba(0,0,0,.17)", rim: "rgba(255,255,255,.9)", shadow: "rgba(0,0,0,.13)", ink: "#111113", accent: "#0a84ff", hi: "#ffffff", lo: "#e2e2e7" },
    dark: { body: "#3d3d43", edge: "rgba(0,0,0,.55)", rim: "rgba(255,255,255,.28)", shadow: "rgba(0,0,0,.5)", ink: "#ececee", accent: "#0a84ff", hi: "#55555c", lo: "#303035" }
  };
  var CREATURE_VARS = (
    /** @type {CreatureColors} */
    Object.fromEntries(Object.entries(CREATURE_COLORS.light).map(([k, v]) => [k, `var(--cr-${k}, ${v})`]))
  );
  var uid = 0;
  function creatureSVG(opts = {}) {
    const c = opts.colors ?? CREATURE_COLORS.light;
    const detail = opts.detail ?? "full";
    const size = opts.size ?? 64;
    const id = `cr${++uid}`;
    const cls = opts.className ? ` class="${opts.className}"` : "";
    const face = (w, h2, dx) => `<g class="cr-face" transform="translate(32 27)"><rect class="cr-eye" x="${-dx - w / 2}" y="${-h2 / 2}" width="${w}" height="${h2}" rx="${w / 2}" style="fill:${c.ink}"/><rect class="cr-eye" x="${dx - w / 2}" y="${-h2 / 2}" width="${w}" height="${h2}" rx="${w / 2}" style="fill:${c.ink}"/></g>`;
    const dot = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" style="fill:${c.accent}"/>`;
    if (detail === "small") {
      return `<svg xmlns="http://www.w3.org/2000/svg"${cls} viewBox="7 7 50 50" width="${size}" height="${size}" aria-hidden="true"><defs><radialGradient id="${id}" cx=".34" cy=".26" r=".85"><stop offset="0" style="stop-color:${c.hi ?? c.body}"/><stop offset=".6" style="stop-color:${c.body}"/><stop offset="1" style="stop-color:${c.lo ?? c.body}"/></radialGradient></defs><circle cx="32" cy="32" r="23.6" style="fill:url(#${id});stroke:${c.ink};stroke-opacity:.42;stroke-width:2.4"/>` + face(5.6, 12.5, 8.6) + dot(43, 44, 3.9) + `</svg>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg"${cls} viewBox="3 4 58 58" width="${size}" height="${size}" aria-hidden="true"><defs><filter id="${id}" x="-28" y="-28" width="120" height="120" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="4.2" result="b"/><feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -8.5" result="g"/><feGaussianBlur in="g" stdDeviation="3" result="sh0"/><feOffset in="sh0" dy="3" result="sh1"/><feFlood style="flood-color:${c.shadow}"/><feComposite in2="sh1" operator="in" result="shadow"/><feComponentTransfer in="g" result="bodyA"><feFuncA type="linear" slope=".76"/></feComponentTransfer><feMorphology in="g" operator="dilate" radius=".7" result="dil"/><feComposite in="dil" in2="g" operator="out" result="edge"/><feFlood style="flood-color:${c.edge}"/><feComposite in2="edge" operator="in" result="edgeC"/><feMorphology in="g" operator="erode" radius="1.1" result="er"/><feComposite in="g" in2="er" operator="out" result="rim"/><feFlood style="flood-color:${c.rim}"/><feComposite in2="rim" operator="in" result="rimC"/><feGaussianBlur in="g" stdDeviation="2.4" result="gb"/><feSpecularLighting in="gb" surfaceScale="3.5" specularConstant=".85" specularExponent="32" lighting-color="#ffffff" result="sp"><fePointLight x="2" y="-46" z="140"/></feSpecularLighting><feComposite in="sp" in2="g" operator="in" result="spIn"/><feMerge><feMergeNode in="shadow"/><feMergeNode in="bodyA"/><feMergeNode in="edgeC"/><feMergeNode in="rimC"/><feMergeNode in="spIn"/></feMerge></filter></defs><g filter="url(#${id})"><ellipse cx="32" cy="32" rx="22.7" ry="23.3" style="fill:${c.body}"/></g>` + dot(38.6, 47.2, 1.85) + dot(42.6, 44.4, 1.85) + face(3.2, 7.6, 7.5) + `</svg>`;
  }

  // src/options/kit/mark.ts
  function createMark(size = 56, live = true) {
    const markup2 = creatureSVG({ colors: CREATURE_VARS, detail: size <= 32 ? "small" : "full", size, className: "mark" });
    const svg = new DOMParser().parseFromString(markup2, "image/svg+xml").documentElement;
    if (!live) return svg;
    const face = svg.querySelector(".cr-face");
    const eyes = Array.from(svg.querySelectorAll(".cr-eye"));
    if (!face || !eyes.length) return svg;
    const eyeH = Number(eyes[0].getAttribute("height"));
    const [fx, fy] = (face.getAttribute("transform")?.match(/-?[\d.]+/g) ?? ["32", "27"]).map(Number);
    if (motion.reduced) return svg;
    const lx = new Spring(0, { stiffness: 260, damping: 26 });
    const ly = new Spring(0, { stiffness: 260, damping: 26 });
    const lid = new Spring(1, { stiffness: 1100, damping: 48 });
    let px = 0;
    let py = 0;
    let has = false;
    let blinkTimer = 0;
    const onMove = (e) => {
      px = e.clientX;
      py = e.clientY;
      has = true;
      wake(500);
    };
    const cleanup = () => {
      clearTimeout(blinkTimer);
      removeEventListener("pointermove", onMove);
      stop();
    };
    const blink = () => {
      if (!svg.isConnected) return cleanup();
      lid.set(0.08);
      wake(400);
      setTimeout(() => lid.set(1), 95);
      blinkTimer = window.setTimeout(blink, 2600 + Math.random() * 3800);
    };
    blinkTimer = window.setTimeout(blink, 2200);
    addEventListener("pointermove", onMove, { passive: true });
    const stop = onFrame((dt) => {
      if (!svg.isConnected) {
        cleanup();
        return 0;
      }
      if (has) {
        const r = svg.getBoundingClientRect();
        const dx = px - (r.left + r.width / 2);
        const dy = py - (r.top + r.height / 2);
        const d = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, d / 160);
        lx.set(dx / d * k * 2.4);
        ly.set(dy / d * k * 2);
      }
      lx.step(dt);
      ly.step(dt);
      lid.step(dt);
      const hgt = eyeH * clamp(lid.value, 0.06, 1);
      for (const e of eyes) {
        e.setAttribute("height", hgt.toFixed(2));
        e.setAttribute("y", (-hgt / 2).toFixed(2));
      }
      face.setAttribute("transform", `translate(${(fx + lx.value).toFixed(2)} ${(fy + ly.value).toFixed(2)})`);
      return moving([lx, ly, lid]) ? FULL : 0;
    });
    return svg;
  }

  // src/options/kit/styles.ts
  var SPRING2 = springEasing({ stiffness: 420, damping: 38 });
  var LIGHT = `
  --ink: #111113; --ink-2: rgba(17,17,19,.58); --ink-3: rgba(17,17,19,.32); --ink-4: rgba(17,17,19,.12);
  --line: rgba(0,0,0,.08); --hover: rgba(0,0,0,.045); --press: rgba(0,0,0,.085);
  --bg: #f3f3f5; --grid: rgba(17,17,19,.075);
  --tint: rgba(255,255,255,.5); --tint-strong: rgba(250,250,252,.82);
  --rim: rgba(255,255,255,.92); --hi: rgba(255,255,255,.96); --lo: rgba(255,255,255,.42); --edge: rgba(0,0,0,.09);
  --shadow: rgba(16,16,20,.12); --glare: rgba(255,255,255,.3);
  --accent: #0a84ff; --accent-soft: rgba(10,132,255,.12); --err: #e5484d; --err-soft: rgba(229,72,77,.1);
  --dot: #bcbcc1; --track: rgba(120,120,128,.22); --thumb: #fff; --field: rgba(255,255,255,.62);
  --solid: #111113; --on-solid: #fff;
  --cr-body: #f3f3f6; --cr-edge: rgba(0,0,0,.17); --cr-rim: rgba(255,255,255,.9); --cr-shadow: rgba(0,0,0,.13);
  --cr-ink: #111113; --cr-accent: #0a84ff; --cr-hi: #ffffff; --cr-lo: #e2e2e7;
`;
  var DARK = `
  --ink: #ececee; --ink-2: rgba(236,236,238,.6); --ink-3: rgba(236,236,238,.32); --ink-4: rgba(236,236,238,.13);
  --line: rgba(255,255,255,.09); --hover: rgba(255,255,255,.06); --press: rgba(255,255,255,.1);
  --bg: #0f0f11; --grid: rgba(236,236,238,.065);
  --tint: rgba(255,255,255,.045); --tint-strong: rgba(30,30,33,.8);
  --rim: rgba(255,255,255,.3); --hi: rgba(255,255,255,.42); --lo: rgba(255,255,255,.1); --edge: rgba(0,0,0,.55);
  --shadow: rgba(0,0,0,.5); --glare: rgba(255,255,255,.06);
  --accent: #0a84ff; --accent-soft: rgba(10,132,255,.2); --err: #ff6369; --err-soft: rgba(229,72,77,.16);
  --dot: #5c5c62; --track: rgba(120,120,128,.38); --thumb: #f2f2f4; --field: rgba(255,255,255,.045);
  --solid: #ececee; --on-solid: #111113;
  --cr-body: #3d3d43; --cr-edge: rgba(0,0,0,.55); --cr-rim: rgba(255,255,255,.28); --cr-shadow: rgba(0,0,0,.5);
  --cr-ink: #ececee; --cr-accent: #0a84ff; --cr-hi: #55555c; --cr-lo: #303035;
`;
  var kitCSS = `
:root {
  color-scheme: light dark;
  ${LIGHT}
  --spring: ${SPRING2.easing};
  --mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace;
  --sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${DARK} } }
:root[data-theme="dark"] { ${DARK} }
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"] { color-scheme: dark; }

* { box-sizing: border-box; }
[hidden] { display: none !important; }
html { background: var(--bg); }
body {
  margin: 0; color: var(--ink); font: 13px/1.5 var(--sans); -webkit-font-smoothing: antialiased;
  background-color: var(--bg);
  background-image: radial-gradient(circle at 1px 1px, var(--grid) 1px, transparent 1.4px);
  background-size: 18px 18px;
}
a { color: inherit; }
button, input, select, textarea { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
h1, h2, h3, p { margin: 0; }
.mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }
.muted { color: var(--ink-2); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
svg.i { width: 16px; height: 16px; flex: none; }

/* liquid glass (same layers as the widgets) */
.lg { position: relative; }
.lg > .lg-b {
  position: absolute; inset: 0; border-radius: inherit; z-index: 0; pointer-events: none;
  background: var(--tint);
  -webkit-backdrop-filter: blur(14px) saturate(1.35);
  backdrop-filter: blur(14px) saturate(1.35);
}
.lg > .lg-h {
  position: absolute; inset: 0; border-radius: inherit; z-index: 0; pointer-events: none;
  box-shadow:
    inset 0 0 0 .5px var(--edge),
    inset 1px 1px 0 -.25px var(--hi),
    inset -1px -1px 0 -.5px var(--lo),
    0 10px 30px -14px var(--shadow),
    0 1px 2px var(--shadow);
  background: radial-gradient(80% 50% at var(--lx, 30%) var(--ly, 0%), var(--glare), transparent 70%);
}
.lg > .lg-h::after {
  content: ''; position: absolute; inset: 0; border-radius: inherit; padding: 1px;
  background: conic-gradient(from var(--la, 315deg),
    var(--rim), transparent 14%, transparent 36%,
    color-mix(in srgb, var(--rim) 35%, transparent) 50%,
    transparent 64%, transparent 86%, var(--rim));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
}
.lg > :not(.lg-b):not(.lg-h) { position: relative; z-index: 1; }

/* buttons */
.btn {
  position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  height: 34px; padding: 0 14px; border: 0; border-radius: 10px; cursor: pointer; white-space: nowrap;
  background: var(--hover); color: var(--ink); font-weight: 500; text-decoration: none;
  transition: background .15s, opacity .2s, transform .3s var(--spring);
}
.btn:hover { background: var(--press); }
.btn:active { transform: scale(.97); }
.btn.solid { background: var(--solid); color: var(--on-solid); }
.btn.solid:hover { opacity: .88; }
.btn.ghost { background: transparent; }
.btn.ghost:hover { background: var(--hover); }
.btn.small { height: 28px; padding: 0 10px; font-size: 12px; border-radius: 8px; }
.btn.danger { color: var(--err); }
.btn.confirm { background: var(--err-soft); color: var(--err); }
.btn[disabled], .btn[aria-disabled="true"] { opacity: .4; cursor: default; transform: none; }
.btn svg.i { width: 15px; height: 15px; stroke-width: 1.8; }
.ib {
  position: relative; display: inline-grid; place-items: center; width: 30px; height: 30px; padding: 0;
  border: 0; border-radius: 8px; background: transparent; color: var(--ink); cursor: pointer;
  transition: background .15s, opacity .2s, color .2s;
}
.ib:hover { background: var(--hover); }
.ib.dim { opacity: .32; }
.ib.done { color: var(--accent); }
.ib svg.i { width: 16px; height: 16px; stroke-width: 1.6; }
.spin { width: 16px; height: 16px; overflow: visible; }
.spin circle { fill: none; stroke: var(--accent); stroke-width: 1.6; stroke-linecap: round; stroke-dasharray: .25 .75;
  transform-box: fill-box; transform-origin: center; animation: kit-spin .8s linear infinite; }
@keyframes kit-spin { to { transform: rotate(360deg); } }

/* fields */
.field {
  width: 100%; height: 36px; padding: 0 12px; border: 0; border-radius: 10px; outline: none;
  background: var(--field); box-shadow: inset 0 0 0 .5px var(--edge), inset 0 1px 2px var(--line);
  transition: box-shadow .15s;
}
.field:focus { box-shadow: inset 0 0 0 1px var(--accent), 0 0 0 3px var(--accent-soft); }
.field.mono { font-family: var(--mono); font-size: 12px; }
.field::placeholder { color: var(--ink-3); }
label.lbl { display: block; font-size: 12px; color: var(--ink-2); margin: 0 0 6px; }

/* switch */
.sw { all: unset; display: inline-flex; align-items: center; gap: 8px; cursor: pointer; flex: none; }
.sw .tr { position: relative; width: 34px; height: 20px; border-radius: 10px; background: var(--track); transition: background .2s, box-shadow .3s; }
.sw .kn {
  position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 8px; background: var(--thumb);
  box-shadow: 0 1px 2px rgba(0,0,0,.28), 0 0 0 .5px rgba(0,0,0,.04); transition: transform .36s var(--spring), width .2s var(--spring);
}
.sw[aria-checked="true"] .tr { background: var(--accent); }
.sw[aria-checked="true"] .kn { transform: translateX(14px); }
.sw:active .kn { width: 20px; }
.sw[aria-checked="true"]:active .kn { transform: translateX(10px); }
.sw:focus-visible { outline: none; }
.sw:focus-visible .tr { outline: 2px solid var(--accent); outline-offset: 2px; }
.sw.flash .tr { box-shadow: 0 0 0 4px var(--accent-soft); }
.sw[aria-disabled="true"] { opacity: .45; cursor: default; }

/* chips, tags, notes */
.chip {
  display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 9px; border-radius: 7px;
  background: var(--hover); font: 500 11px/1 var(--mono); color: var(--ink-2); white-space: nowrap; text-decoration: none;
}
.chip .d { width: 6px; height: 6px; border-radius: 3px; background: var(--dot); flex: none; }
.chip.accent .d { background: var(--accent); }
.chip.ok .d { background: var(--ink); }
.chip.err { color: var(--err); }
.chip.err .d { background: var(--err); }
.tag { display: inline-block; font: 500 10px/1 var(--mono); padding: 3px 5px; border-radius: 4px; background: var(--hover); color: var(--ink-2); }
.tag.accent { color: var(--accent); background: var(--accent-soft); }
.tag.warn { color: var(--err); background: var(--err-soft); }
.note { display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border-radius: 10px; background: var(--hover); font-size: 12px; line-height: 1.45; }
.note svg.i { width: 15px; height: 15px; margin-top: 1px; stroke-width: 1.8; }
.note.err { background: var(--err-soft); color: var(--err); }
.note.ok svg.i { color: var(--accent); }
.note:empty { display: none; }

/* motion */
.enter { animation: kit-enter .5s var(--spring) both; }
@keyframes kit-enter { from { opacity: 0; transform: translateY(8px); } }
.fade { animation: kit-fade .25s ease-out both; }
@keyframes kit-fade { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
}
`;
  var injected = false;
  function injectKitStyles() {
    if (injected) return;
    injected = true;
    const style = document.createElement("style");
    style.id = "gitchat-kit";
    style.textContent = kitCSS;
    document.head.prepend(style);
  }

  // src/options/kit/theme.ts
  function applyPageTheme(theme) {
    const root = document.documentElement;
    if (theme === "light" || theme === "dark") root.dataset.theme = theme;
    else root.removeAttribute("data-theme");
  }

  // src/options/kit/util.ts
  var SERVICE_LINKS = [
    { name: "ChatGPT", url: "https://chatgpt.com/" },
    { name: "Claude", url: "https://claude.ai/" },
    { name: "Gemini", url: "https://gemini.google.com/" }
  ];
  async function copy(text2) {
    try {
      await navigator.clipboard.writeText(text2);
    } catch {
      const ta = h("textarea", { "aria-hidden": "true", style: "position:fixed;opacity:0" });
      ta.value = text2;
      document.body.append(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
  }

  // src/popup/refresh.ts
  var REFRESH_TIMEOUT_MS = 8e3;
  async function refreshPage(tabId, timeoutMs = REFRESH_TIMEOUT_MS) {
    const msg = { gitchat: 1, type: "content/refresh" };
    let timer2;
    const reply = await Promise.race([
      Promise.resolve().then(() => chrome.tabs.sendMessage(tabId, msg)).catch(() => null),
      new Promise((r2) => {
        timer2 = setTimeout(() => r2(null), timeoutMs);
      })
    ]);
    clearTimeout(timer2);
    if (!reply || typeof reply !== "object" || typeof reply.ok !== "boolean") return { ok: false };
    const r = reply;
    if (r.ok) return { ok: true };
    return typeof r.error === "string" && r.error ? { ok: false, error: r.error } : { ok: false };
  }

  // src/shared/actions.js
  function availableActions(state, settings) {
    if (state.phase === "capturing") return ["cancel"];
    if (!state.tracked) return ["start"];
    const out = [];
    if (!settings.autoCommit) out.push("commit");
    if (!settings.autoPush || state.phase === "error") out.push("push");
    return out;
  }

  // src/popup/popup.ts
  var GRAPH_W = 284;
  var SERVICE_NAME = { chatgpt: "ChatGPT", claude: "Claude", gemini: "Gemini" };
  async function activeTabId() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab?.id ?? null;
    } catch {
      return null;
    }
  }
  async function contentCurrent(tabId) {
    try {
      const msg = { gitchat: 1, type: "content/current" };
      const res = await chrome.tabs.sendMessage(tabId, msg);
      return res && typeof res === "object" && "service" in res ? res : null;
    } catch {
      return null;
    }
  }
  function card(...children) {
    return glass(h("section", { class: "p-card" }, h("div", { class: "p-inner" }, ...children)), { radius: 16, scale: 16, bezel: 12, blur: 12 });
  }
  function footer(settings, sync) {
    const r = settings.repo;
    const pending = sync?.pending ?? 0;
    return h(
      "footer",
      { class: "p-foot" },
      r ? h(
        "a",
        {
          class: `chip${sync?.lastError ? " err" : pending ? " accent" : " ok"}`,
          href: `https://github.com/${r.owner}/${r.name}`,
          target: "_blank",
          rel: "noopener noreferrer",
          title: sync?.lastError ? t("syncError", sync.lastError) : pending ? t("pendingCommits", String(pending)) : t("allPushed")
        },
        h("span", { class: "d" }),
        h("span", { class: "nm" }, `${r.owner}/${r.name}`),
        pending ? h("span", { class: "n" }, `\u2191${pending}`) : null
      ) : h("span"),
      h("span", { class: "sp" }),
      h(
        "button",
        {
          class: "ib",
          type: "button",
          title: t("openSettings"),
          "aria-label": t("openSettings"),
          onClick: () => {
            void chrome.runtime.openOptionsPage();
            window.close();
          }
        },
        icon2("gear")
      )
    );
  }
  function setupView(signedIn) {
    return card(
      h(
        "div",
        { class: "setup" },
        createMark(56),
        h("h1", null, "gitchat"),
        h("p", { class: "muted" }, t("popSetupLead")),
        h(
          "button",
          {
            class: "btn solid",
            type: "button",
            onClick: () => {
              void chrome.runtime.openOptionsPage();
              window.close();
            }
          },
          h("span", null, signedIn ? t("popFinishSetup") : t("setUp")),
          icon2("arrow")
        )
      )
    );
  }
  function linksView(service) {
    return card(
      h("p", { class: "p-lead" }, service ? t("popNewChat") : t("popOpenChat")),
      h(
        "div",
        { class: "p-links" },
        SERVICE_LINKS.map(
          (sv) => h(
            "a",
            { class: "p-link", href: sv.url, target: "_blank", rel: "noopener noreferrer" },
            h("span", null, sv.name),
            icon2("external")
          )
        )
      )
    );
  }
  function chatView(tabId, cur, settings, initial) {
    const key = chatKey(cur.service, cur.chatId);
    let status = initial;
    let busy = null;
    let error = "";
    let pageError = cur.status?.phase === "error" ? cur.status.error ?? "" : "";
    const graphBox = h("div", { class: "p-graph" });
    const line = h("div", { class: "p-line" });
    const actions = h("div", { class: "p-actions" });
    const note = h("div", { class: "p-note" });
    const run = async (kind, fn) => {
      busy = kind;
      error = "";
      pageError = "";
      render();
      try {
        const read = await refreshPage(tabId);
        if (!read.ok) {
          error = read.error || t("errRefresh");
          return;
        }
        const next = await fn();
        if (next) status = next;
      } catch (e) {
        error = errorText(e);
      } finally {
        busy = null;
        render();
      }
    };
    const tabAction = async (type) => {
      busy = "track";
      error = "";
      pageError = "";
      render();
      try {
        const msg = { gitchat: 1, type };
        await chrome.tabs.sendMessage(tabId, msg);
      } catch (e) {
        error = errorText(e);
      } finally {
        busy = null;
        render();
      }
      await refresh();
    };
    function render() {
      const s2 = status;
      const offered = availableActions(s2, settings);
      if (s2.tracked && (s2.commits.length || s2.staged.length)) mount(graphBox, renderGraph(s2, GRAPH_W));
      else mount(graphBox);
      if (s2.phase === "capturing") {
        const p = Math.round((s2.progress ?? 0) * 100);
        mount(
          line,
          h("div", { class: "bar", role: "progressbar", "aria-valuenow": p, "aria-valuemin": 0, "aria-valuemax": 100 }, h("span", { style: `width:${Math.max(4, p)}%` })),
          h("span", { class: "mono muted" }, `${p}%`)
        );
      } else if (s2.phase === "pushing") {
        mount(line, spinner(), h("span", { class: "muted" }, t("popPushing")));
      } else if (s2.tracked && s2.path) {
        mount(line, h("span", { class: "mono path", title: s2.path }, midTrunc(s2.path, 40)));
      } else if (!s2.tracked) {
        mount(line, h("span", { class: "muted" }, t("popUntracked")));
      } else mount(line);
      const items = [];
      if (!s2.tracked) {
        items.push(
          h(
            "button",
            {
              class: "btn solid small",
              type: "button",
              disabled: s2.phase === "capturing" || busy === "track",
              onClick: () => void tabAction("content/init")
            },
            s2.phase === "capturing" || busy === "track" ? spinner() : icon2("init"),
            h("span", null, t("track"))
          )
        );
      } else {
        const staged = s2.staged.length;
        const ahead = s2.aheadTotal;
        if (offered.includes("commit"))
          items.push(
            h(
              "button",
              {
                class: `ib count${staged ? "" : " dim"}`,
                type: "button",
                title: t("commit"),
                "aria-label": `${t("commit")}${staged ? ` (${staged})` : ""}`,
                disabled: busy !== null || s2.phase === "capturing" || s2.phase === "pushing",
                onClick: () => void run("commit", () => request("chat/commit", { key }))
              },
              busy === "commit" ? spinner() : icon2("commit"),
              staged ? h("span", { class: "n" }, String(staged)) : null
            )
          );
        if (offered.includes("push")) {
          const sending = s2.phase === "pushing" || busy === "push";
          items.push(
            h(
              "button",
              {
                class: `ib count${ahead || staged || s2.phase === "error" ? "" : " dim"}${s2.phase === "error" ? " err" : ""}`,
                type: "button",
                title: t("push"),
                "aria-label": `${t("push")}${ahead ? ` (${ahead})` : ""}`,
                disabled: busy !== null || sending,
                onClick: () => void run("push", () => request("chat/push", { key }))
              },
              sending ? spinner() : icon2("push"),
              ahead ? h("span", { class: "n accent" }, String(ahead)) : null
            )
          );
        }
        if (settings.autoCommit || settings.autoPush)
          items.push(h("span", { class: "auto" }, [settings.autoCommit ? t("autoCommit") : "", settings.autoPush ? t("autoPush") : ""].filter(Boolean).join(" \xB7 ")));
      }
      items.push(h("span", { class: "sp" }));
      if (s2.tracked && s2.phase !== "capturing")
        items.push(
          h(
            "button",
            {
              class: "ib",
              type: "button",
              title: t("rescan"),
              "aria-label": t("rescan"),
              disabled: busy !== null || s2.phase === "pushing",
              onClick: () => void tabAction("content/rescan")
            },
            icon2("refresh")
          )
        );
      if (s2.webUrl) {
        const linkBtn = h(
          "button",
          {
            class: "ib",
            type: "button",
            title: t("copyLink"),
            "aria-label": t("copyLink"),
            onClick: async () => {
              await copy(s2.webUrl ?? "");
              linkBtn.classList.add("done");
              linkBtn.replaceChildren(icon2("check"));
              setTimeout(() => {
                linkBtn.classList.remove("done");
                linkBtn.replaceChildren(icon2("link"));
              }, 1300);
            }
          },
          icon2("link")
        );
        items.push(linkBtn, h("a", { class: "ib", href: s2.webUrl, target: "_blank", rel: "noopener noreferrer", title: t("openOnGitHub"), "aria-label": t("openOnGitHub") }, icon2("external")));
      }
      mount(actions, items);
      const err = error || (s2.phase === "error" ? s2.error ?? t("errGeneric") : "") || pageError;
      mount(note, err ? h("div", { class: "note err", role: "alert" }, icon2("alert"), h("span", null, err)) : null);
    }
    async function refresh() {
      try {
        const next = await request("chat/status", { key });
        if (JSON.stringify(next) !== JSON.stringify(status)) {
          status = next;
          render();
        }
      } catch {
      }
    }
    const el = card(
      h(
        "header",
        { class: "p-head" },
        h("span", { class: "p-svc mono" }, SERVICE_NAME[cur.service]),
        h("h1", { class: "p-title", title: cur.title }, cur.title || t("untitledChat"))
      ),
      line,
      graphBox,
      actions,
      note
    );
    render();
    const timer2 = window.setInterval(() => void refresh(), 1e3);
    return { el, stop: () => clearInterval(timer2) };
  }
  async function main() {
    await installDevShim();
    injectKitStyles();
    const style = document.createElement("style");
    style.textContent = graphCSS;
    document.head.append(style);
    document.documentElement.lang = chrome.i18n?.getUILanguage?.() ?? "en";
    const root = document.getElementById("app");
    mount(root, h("div", { class: "p-loading" }, spinner()));
    let settings;
    let auth;
    try {
      [settings, auth] = await Promise.all([request("settings/get", {}), request("auth/get", {})]);
    } catch (e) {
      mount(root, card(h("div", { class: "note err", role: "alert" }, icon2("alert"), h("span", null, errorText(e)))));
      return;
    }
    applyPageTheme(settings.theme);
    try {
      const stopTheme = onSettingsChanged((next) => applyPageTheme(next.theme));
      addEventListener("unload", stopTheme);
    } catch {
    }
    if (!auth || !settings.repo) {
      mount(root, setupView(!!auth));
      return;
    }
    const tabId = await activeTabId();
    const [cur, sync] = await Promise.all([tabId !== null ? contentCurrent(tabId) : Promise.resolve(null), request("sync/status", {}).catch(() => null)]);
    if (tabId !== null && cur?.chatId) {
      const withId = cur;
      let status = cur.status;
      if (!status) status = await request("chat/status", { key: chatKey(cur.service, cur.chatId) }).catch(() => null);
      if (status) {
        const view = chatView(tabId, withId, settings, status);
        mount(root, view.el, footer(settings, sync));
        addEventListener("unload", view.stop);
        return;
      }
    }
    mount(root, linksView(cur?.service ?? null), footer(settings, sync));
  }
  void main();
})();
