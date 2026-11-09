"use strict";
(() => {
  // src/shared/i18n.ts
  function t(key, substitutions) {
    try {
      const s2 = globalThis.chrome?.i18n?.getMessage(key, substitutions);
      if (s2) return s2;
    } catch {
    }
    return key;
  }

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
  var nestedIcon = (name, size = 24, x = 0, y = 0, sw = 2) => `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 24 24" stroke-width="${sw}" ${A}>${P[name]}</svg>`;

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
  function format(entry, subs3) {
    if (!entry) return "";
    const arr = subs3 == null ? [] : Array.isArray(subs3) ? subs3.map(String) : [String(subs3)];
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
        getMessage: (key, subs3) => format(messages[key], subs3),
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
  function errorCode(e) {
    return typeof e === "object" && e && "code" in e ? String(e.code) : "";
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
  var lerp = (a, b, t2) => a + (b - a) * t2;
  var smooth = (e0, e1, x) => {
    const t2 = clamp((x - e0) / (e1 - e0), 0, 1);
    return t2 * t2 * (3 - 2 * t2);
  };

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
  var SPRING = springEasing({ stiffness: 420, damping: 38 });
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
  --spring: ${SPRING.easing};
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

  // src/options/kit/util.ts
  var SERVICE_LINKS = [
    { name: "ChatGPT", url: "https://chatgpt.com/" },
    { name: "Claude", url: "https://claude.ai/" },
    { name: "Gemini", url: "https://gemini.google.com/" }
  ];
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = h("textarea", { "aria-hidden": "true", style: "position:fixed;opacity:0" });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
  }

  // src/options/connect.ts
  var PAT_URL = "https://github.com/settings/personal-access-tokens/new?name=gitchat&description=gitchat%20chat%20history&contents=write&metadata=read";
  var NEW_REPO_URL = "https://github.com/new?name=ai-chats&visibility=private&description=AI%20chat%20archive%20managed%20by%20gitchat";
  function createConnect(onDone) {
    const root = h("div", { class: "connect" });
    let view = "choose";
    let deviceUnavailable = false;
    let code = null;
    let deadline = 0;
    let gen = 0;
    let busy = false;
    let error = "";
    let countdown = 0;
    const note = () => error ? h("div", { class: "note err", role: "alert" }, icon2("alert"), h("span", null, error)) : null;
    function render() {
      clearInterval(countdown);
      if (view === "code" && code) mount(root, renderCode(code));
      else if (view === "token" || deviceUnavailable) mount(root, renderToken());
      else mount(root, renderChoose());
    }
    function renderChoose() {
      return h(
        "div",
        { class: "stack enter" },
        h(
          "button",
          { class: "btn solid wide", type: "button", disabled: busy, onClick: startDevice },
          busy ? spinner() : icon2("key"),
          h("span", null, t("signInWithGitHub"))
        ),
        h("button", { class: "btn ghost wide", type: "button", onClick: () => go("token") }, t("useTokenInstead")),
        note()
      );
    }
    function renderCode(dc) {
      const timeEl = h("span", { class: "mono" }, fmtTime(deadline - Date.now()));
      countdown = window.setInterval(() => {
        const left = deadline - Date.now();
        timeEl.textContent = fmtTime(left);
        if (left <= 0) clearInterval(countdown);
      }, 1e3);
      const copyBtn = h(
        "button",
        {
          class: "btn small",
          type: "button",
          onClick: async () => {
            await copy(dc.userCode);
            copyBtn.replaceChildren(icon2("check"), h("span", null, t("copied")));
            setTimeout(() => copyBtn.replaceChildren(icon2("copy"), h("span", null, t("copy"))), 1300);
          }
        },
        icon2("copy"),
        h("span", null, t("copy"))
      );
      const cells = [...dc.userCode].map((ch) => ch === "-" ? h("span", { class: "sep", "aria-hidden": "true" }, "\u2013") : h("span", { class: "c" }, ch));
      return h(
        "div",
        { class: "stack enter" },
        h("p", { class: "muted center" }, t("deviceCodeLead")),
        h("div", { class: "code", role: "group", "aria-label": dc.userCode }, cells),
        h(
          "div",
          { class: "row-actions center" },
          copyBtn,
          h(
            "a",
            { class: "btn small solid", href: dc.verificationUri, target: "_blank", rel: "noopener noreferrer" },
            h("span", null, t("openGitHub")),
            icon2("external")
          )
        ),
        h(
          "div",
          { class: "waiting", role: "status", "aria-live": "polite" },
          spinner(),
          h("span", null, t("waitingForApproval")),
          h("span", { class: "muted" }, " \xB7 ", t("codeExpires")),
          timeEl
        ),
        h("button", { class: "btn ghost small mid", type: "button", onClick: () => cancel() }, t("cancel")),
        note()
      );
    }
    function renderToken() {
      const input = h("input", {
        class: "field mono",
        type: "password",
        id: "gc-token",
        autocomplete: "off",
        spellcheck: "false",
        placeholder: "github_pat_\u2026",
        "aria-describedby": "gc-token-help"
      });
      const submit = async () => {
        const token = input.value.trim();
        if (!token) {
          input.focus();
          return;
        }
        busy = true;
        error = "";
        connectBtn.setAttribute("disabled", "");
        connectBtn.replaceChildren(spinner(), h("span", null, t("connect")));
        try {
          const r = await request("auth/pat", { token });
          onDone(r.login);
        } catch (e) {
          if (errorCode(e) === "cancelled") {
            busy = false;
            render();
            return;
          }
          error = errorText(e);
          busy = false;
          render();
        }
      };
      const connectBtn = h("button", { class: "btn solid", type: "button", onClick: submit }, h("span", null, t("connect")));
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void submit();
      });
      queueMicrotask(() => input.focus());
      const link = (href, label) => h("a", { class: "btn small", href, target: "_blank", rel: "noopener noreferrer" }, h("span", null, label), icon2("external"));
      const shot = (file, caption) => h(
        "figure",
        { class: "shot" },
        h("a", { href: `img/${file}`, target: "_blank", rel: "noopener", title: t("openFullSize") }, h("img", { src: `img/${file}`, alt: caption, loading: "lazy", decoding: "async" })),
        h("figcaption", null, caption)
      );
      return h(
        "div",
        { class: "stack enter" },
        h("div", { class: "token-head" }, icon2("key"), h("strong", null, t("tokenTitle"))),
        h(
          "ol",
          { class: "howto" },
          h("li", null, h("p", null, t("tokenStepRepo")), link(NEW_REPO_URL, t("createRepoOnGitHub")), shot("github-new-repo.png", t("shotRepo"))),
          h(
            "li",
            null,
            h("p", null, t("tokenStepToken")),
            link(PAT_URL, t("createToken")),
            shot("github-token-access.png", t("shotAccess")),
            shot("github-token-permissions.png", t("shotPermissions"))
          ),
          h(
            "li",
            null,
            h("p", { class: "muted", id: "gc-token-help" }, t("tokenStepPaste")),
            h("div", null, h("label", { class: "lbl", for: "gc-token" }, t("pasteToken")), h("div", { class: "inline" }, input, connectBtn))
          )
        ),
        deviceUnavailable ? null : h("button", { class: "btn ghost small", type: "button", onClick: () => go("choose") }, t("signInWithGitHub")),
        note()
      );
    }
    function go(v) {
      gen++;
      view = v;
      error = "";
      busy = false;
      render();
    }
    function cancel() {
      void request("auth/device/cancel", {}).catch(() => void 0);
      go("choose");
    }
    async function startDevice() {
      const my = ++gen;
      busy = true;
      error = "";
      render();
      try {
        const dc = await request("auth/device/start", {});
        if (my !== gen) return;
        code = dc;
        deadline = Date.now() + dc.expiresIn * 1e3;
        busy = false;
        view = "code";
        render();
        void waitForApproval(my);
      } catch (e) {
        if (my !== gen) return;
        busy = false;
        if (errorCode(e) === "no-client-id" || errorCode(e) === "device-flow-disabled") {
          deviceUnavailable = true;
          view = "token";
        } else {
          error = errorText(e);
        }
        render();
      }
    }
    async function waitForApproval(my) {
      while (my === gen && Date.now() < deadline) {
        try {
          const r = await request("auth/device/wait", {});
          if (my !== gen) return;
          onDone(r.login);
          return;
        } catch (e) {
          if (my !== gen) return;
          if (errorCode(e) === "no-reply") {
            await new Promise((r) => setTimeout(r, 1e3));
            continue;
          }
          error = errorText(e);
          view = "choose";
          render();
          return;
        }
      }
      if (my === gen) {
        error = t("codeExpired");
        view = "choose";
        render();
      }
    }
    render();
    return root;
  }
  function fmtTime(ms) {
    const s2 = Math.max(0, Math.round(ms / 1e3));
    return `${Math.floor(s2 / 60)}:${String(s2 % 60).padStart(2, "0")}`;
  }

  // src/content/ui/core/glass.js
  var SPRING2 = springEasing({ stiffness: 420, damping: 38 });
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
  --spring: ${SPRING2.easing};
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

  // src/options/kit/switch.ts
  function createSwitch(o) {
    let on2 = o.checked;
    let disabled = false;
    let timer2 = 0;
    const el = h(
      "button",
      {
        class: "sw",
        type: "button",
        role: "switch",
        "aria-checked": String(on2),
        "aria-label": o.label,
        title: o.label,
        "aria-describedby": o.describedBy,
        onClick: () => {
          if (!disabled) o.onChange(!on2);
        }
      },
      o.iconName ? icon2(o.iconName) : null,
      h("span", { class: "tr" }, h("span", { class: "kn" }))
    );
    const apply = (v, flash) => {
      on2 = v;
      el.setAttribute("aria-checked", String(v));
      if (flash) {
        el.classList.add("flash");
        setTimeout(() => el.classList.remove("flash"), 520);
      }
    };
    return {
      el,
      get: () => on2,
      set(v, opts = {}) {
        clearTimeout(timer2);
        if (opts.delay) timer2 = window.setTimeout(() => apply(v, !!opts.flash), opts.delay);
        else apply(v, !!opts.flash);
      },
      setDisabled(d) {
        disabled = d;
        el.setAttribute("aria-disabled", String(d));
      }
    };
  }

  // src/options/state.ts
  var app = {
    settings: { ...DEFAULT_SETTINGS },
    auth: null,
    sync: null
  };
  var subs2 = /* @__PURE__ */ new Map();
  function on(topic, fn) {
    let set = subs2.get(topic);
    if (!set) subs2.set(topic, set = /* @__PURE__ */ new Set());
    set.add(fn);
    return () => set?.delete(fn);
  }
  function emit(topic) {
    for (const fn of [...subs2.get(topic) ?? []]) fn();
  }
  async function loadAll() {
    const [s2, a, y] = await Promise.allSettled([request("settings/get", {}), request("auth/get", {}), request("sync/status", {})]);
    const errors = [];
    if (s2.status === "fulfilled") setConfirmed(s2.value);
    else errors.push(s2.reason);
    if (a.status === "fulfilled") app.auth = a.value;
    else errors.push(a.reason);
    if (y.status === "fulfilled") app.sync = y.value;
    try {
      onSettingsChanged((next) => {
        setConfirmed(next);
        emit("settings");
      });
    } catch {
    }
    return errors;
  }
  async function refreshAuth() {
    app.auth = await request("auth/get", {});
    emit("auth");
  }
  async function refreshSettings() {
    setConfirmed(await request("settings/get", {}));
    emit("settings");
  }
  async function refreshSync() {
    try {
      app.sync = await request("sync/status", {});
      emit("sync");
    } catch {
    }
  }
  var confirmed = app.settings;
  var pending = [];
  function setConfirmed(next) {
    confirmed = next;
    app.settings = pending.reduce(applySettingsPatch, confirmed);
  }
  async function patchSettings(patch) {
    pending.push(patch);
    setConfirmed(confirmed);
    emit("settings");
    try {
      const saved = await request("settings/set", { patch });
      pending.splice(pending.indexOf(patch), 1);
      setConfirmed(saved);
      return saved;
    } catch (e) {
      pending.splice(pending.indexOf(patch), 1);
      setConfirmed(confirmed);
      throw e;
    } finally {
      emit("settings");
    }
  }

  // src/options/prefs.ts
  var STYLES = ["creature", "line", "dot"];
  var LABEL = { creature: "styleCreature", line: "styleLine", dot: "styleDot" };
  var THEMES = ["auto", "light", "dark"];
  var THEME_LABEL = { auto: "themeAuto", light: "themeLight", dark: "themeDark" };
  function createThemePicker(onError) {
    const group = h("div", { class: "seg", role: "radiogroup", "aria-label": t("theme") });
    const buttons = THEMES.map(
      (theme) => h(
        "button",
        {
          type: "button",
          role: "radio",
          "aria-checked": String(app.settings.theme === theme),
          tabindex: app.settings.theme === theme ? 0 : -1,
          "data-theme": theme,
          onClick: () => void choose(theme)
        },
        t(THEME_LABEL[theme])
      )
    );
    group.append(...buttons);
    const sync = () => {
      for (const b of buttons) {
        const selected = b.dataset.theme === app.settings.theme;
        b.setAttribute("aria-checked", String(selected));
        b.tabIndex = selected ? 0 : -1;
      }
    };
    async function choose(theme) {
      if (app.settings.theme === theme) return;
      try {
        await patchSettings({ theme });
      } catch (e) {
        onError(errorText(e));
      }
    }
    group.addEventListener("keydown", (e) => {
      const i = THEMES.indexOf(app.settings.theme);
      let next = -1;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % THEMES.length;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i + THEMES.length - 1) % THEMES.length;
      if (next < 0) return;
      e.preventDefault();
      const theme = THEMES[next];
      void choose(theme);
      buttons[next]?.focus();
    });
    on("settings", sync);
    return group;
  }
  function glyph(style) {
    const svg = s("svg", { class: "g", viewBox: "0 0 64 44", "aria-hidden": "true" });
    if (style === "creature") {
      svg.append(
        s("circle", { class: "g-sat", cx: 17, cy: 13, r: 3.6 }),
        s("circle", { class: "g-body", cx: 34, cy: 23, r: 13 }),
        s("rect", { class: "g-eye", x: 28.6, y: 17.5, width: 2.2, height: 5.6, rx: 1.1 }),
        s("rect", { class: "g-eye", x: 35.2, y: 17.5, width: 2.2, height: 5.6, rx: 1.1 }),
        s("circle", { class: "g-acc", cx: 41.5, cy: 29, r: 1.4 }),
        s("circle", { class: "g-acc", cx: 43.2, cy: 25.6, r: 1.4 })
      );
    } else if (style === "line") {
      svg.append(
        s("rect", { class: "g-cap", x: 40, y: 3, width: 9, height: 38, rx: 4.5 }),
        s("circle", { class: "g-dot", cx: 44.5, cy: 10, r: 1.6 }),
        s("circle", { class: "g-dot", cx: 44.5, cy: 16, r: 1.6 }),
        s("line", { class: "g-origin", x1: 41.5, x2: 47.5, y1: 19.5, y2: 19.5 }),
        s("circle", { class: "g-acc", cx: 44.5, cy: 23, r: 1.6 }),
        s("circle", { class: "g-acc", cx: 44.5, cy: 29, r: 1.6 }),
        s("circle", { class: "g-ring", cx: 44.5, cy: 35, r: 1.9 })
      );
    } else {
      const ticks = [-90, -66, -42].map((a) => {
        const r = a * Math.PI / 180;
        return s("circle", { class: "g-acc", cx: 32 + Math.cos(r) * 11, cy: 22 + Math.sin(r) * 11, r: 1.5 });
      });
      svg.append(s("circle", { class: "g-cap", cx: 32, cy: 22, r: 16 }), s("circle", { class: "g-trk", cx: 32, cy: 22, r: 11 }), ...ticks);
      const num = s("text", { class: "g-num", x: 32, y: 25.5 });
      num.textContent = "3";
      svg.append(num);
    }
    return svg;
  }
  function createStylePicker(preview, onError) {
    const group = h("div", { class: "choices", role: "radiogroup", "aria-label": t("widgetStyle") });
    const tiles = STYLES.map(
      (style) => h(
        "button",
        {
          class: "choice",
          type: "button",
          role: "radio",
          "aria-checked": String(app.settings.widget === style),
          tabindex: app.settings.widget === style ? 0 : -1,
          "data-style": style,
          onClick: () => choose(style)
        },
        glyph(style),
        h("span", { class: "lb" }, t(LABEL[style])),
        style === "creature" ? h("span", { class: "tag" }, t("defaultTag")) : null
      )
    );
    group.append(...tiles);
    const sync = () => {
      for (const b of tiles) {
        const on2 = b.dataset.style === app.settings.widget;
        b.setAttribute("aria-checked", String(on2));
        b.tabIndex = on2 ? 0 : -1;
      }
    };
    async function choose(style) {
      preview?.show(style);
      if (app.settings.widget === style) return;
      try {
        await patchSettings({ widget: style });
      } catch (e) {
        onError(errorText(e));
      }
    }
    group.addEventListener("keydown", (e) => {
      const i = STYLES.indexOf(app.settings.widget);
      let next = -1;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % STYLES.length;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i + STYLES.length - 1) % STYLES.length;
      if (next < 0) return;
      e.preventDefault();
      const style = STYLES[next];
      void choose(style);
      tiles[next]?.focus();
    });
    on("settings", sync);
    return group;
  }
  function createAutoSwitches(preview, onError) {
    const handles = {};
    const change = async (key, value) => {
      const before = app.settings;
      const next = applySettingsPatch(before, { [key]: value });
      const mine = key === "autoCommit" ? handles.commit : handles.push;
      const other = key === "autoCommit" ? handles.push : handles.commit;
      const otherKey = key === "autoCommit" ? "autoPush" : "autoCommit";
      mine.set(value);
      if (next[otherKey] !== before[otherKey]) other.set(next[otherKey], { delay: 160, flash: true });
      preview?.syncAuto(next.autoCommit, next.autoPush);
      try {
        await patchSettings({ [key]: value });
      } catch (e) {
        onError(errorText(e));
      }
    };
    handles.commit = createSwitch({
      label: t("autoCommit"),
      checked: app.settings.autoCommit,
      onChange: (v) => void change("autoCommit", v),
      describedBy: "gc-hint-autocommit"
    });
    handles.push = createSwitch({
      label: t("autoPush"),
      checked: app.settings.autoPush,
      onChange: (v) => void change("autoPush", v),
      describedBy: "gc-hint-autopush"
    });
    on("settings", () => {
      if (handles.commit.get() !== app.settings.autoCommit) handles.commit.set(app.settings.autoCommit);
      if (handles.push.get() !== app.settings.autoPush) handles.push.set(app.settings.autoPush);
    });
    return handles;
  }
  function row(title, hint, control, hintId, iconEl) {
    return h(
      "div",
      { class: "row" },
      h("div", { class: "text" }, h("div", { class: "title" }, iconEl ?? null, title), hint ? h("div", { class: "hint", id: hintId }, hint) : null),
      control
    );
  }

  // src/options/repo.ts
  var NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;
  var FULL_NAME_RE = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/;
  function createRepoChooser(onDone) {
    const root = h("div", { class: "repo-chooser" });
    const limitedToken = app.auth?.method === "pat";
    let mode = limitedToken ? "existing" : "create";
    let name = "ai-chats";
    let priv = true;
    let busy = false;
    let error = "";
    let repos = null;
    let loading = false;
    let listError = "";
    let filter = "";
    let selected = null;
    const body = h("div", { class: "stack" });
    const seg = h(
      "div",
      { class: "seg", role: "tablist", "aria-label": t("obRepoTitle") },
      segBtn("create", t("createPrivateRepo")),
      segBtn("existing", t("useExistingRepo"))
    );
    function segBtn(m, label) {
      return h(
        "button",
        {
          type: "button",
          role: "tab",
          "aria-selected": String(mode === m),
          "data-mode": m,
          onClick: () => {
            mode = m;
            error = "";
            for (const b of seg.querySelectorAll("button")) b.setAttribute("aria-selected", String(b.dataset.mode === mode));
            render();
            if (m === "existing" && !repos && !loading) void loadRepos();
          }
        },
        label
      );
    }
    const note = (msg) => msg ? h("div", { class: "note err", role: "alert" }, icon2("alert"), h("span", null, msg)) : null;
    const githubLink = () => h("a", { class: "btn small", href: NEW_REPO_URL, target: "_blank", rel: "noopener noreferrer" }, h("span", null, t("createRepoOnGitHub")), icon2("external"));
    function render() {
      mount(body, mode === "create" ? renderCreate() : renderExisting());
    }
    function renderCreate() {
      const input = h("input", {
        class: "field mono",
        id: "gc-repo-name",
        value: name,
        spellcheck: "false",
        autocomplete: "off",
        maxlength: 100
      });
      const valid = () => NAME_RE.test(name) && name !== "." && name !== "..";
      const createBtn = h(
        "button",
        { class: "btn solid", type: "button", disabled: busy || !valid() },
        busy ? spinner() : icon2("plus"),
        h("span", null, t("create"))
      );
      input.addEventListener("input", () => {
        name = input.value.trim();
        if (valid()) createBtn.removeAttribute("disabled");
        else createBtn.setAttribute("disabled", "");
      });
      const submit = async () => {
        if (!valid() || busy) return;
        busy = true;
        error = "";
        render();
        try {
          const repo = await request("repo/create", { name, private: priv });
          onDone(repo);
        } catch (e) {
          error = errorText(e);
          busy = false;
          render();
        }
      };
      createBtn.addEventListener("click", submit);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void submit();
      });
      const privSwitch = createSwitch({
        label: t("repoPrivateLabel"),
        checked: priv,
        onChange: (v) => {
          priv = v;
          privSwitch.set(v);
          render();
        }
      });
      return h(
        "div",
        { class: "stack fade" },
        limitedToken ? h("div", { class: "note" }, icon2("alert"), h("span", null, t("repoPatNote"))) : null,
        limitedToken ? githubLink() : null,
        h("div", null, h("label", { class: "lbl", for: "gc-repo-name" }, t("repoName")), h("div", { class: "inline" }, input, createBtn)),
        h("div", { class: "row tight" }, h("div", { class: "text" }, h("div", { class: "title" }, icon2("lock"), t("repoPrivateLabel"))), privSwitch.el),
        priv ? null : h("div", { class: "note err" }, icon2("alert"), h("span", null, t("repoPublicWarn"))),
        note(error)
      );
    }
    function renderExisting() {
      if (loading) return h("div", { class: "loading", role: "status" }, spinner(), h("span", null, t("loadingRepos")));
      if (listError || !repos)
        return h(
          "div",
          { class: "stack" },
          note(listError || t("errGeneric")),
          h("button", { class: "btn small", type: "button", onClick: () => void loadRepos() }, icon2("refresh"), h("span", null, t("retry")))
        );
      const search = h("input", {
        class: "field",
        type: "search",
        placeholder: t("filterRepos"),
        "aria-label": t("filterRepos"),
        value: filter
      });
      const list = h("div", { class: "repos", role: "listbox", "aria-label": t("useExistingRepo"), tabindex: 0 });
      const detail = h("div", { class: "stack" });
      const shown = () => repos.filter((r) => `${r.owner}/${r.name}`.toLowerCase().includes(filter.toLowerCase()));
      const typed = h("div", { class: "stack" });
      const fillTyped = () => {
        const m = FULL_NAME_RE.exec(filter.trim());
        const listed = m && repos.some((r) => `${r.owner}/${r.name}`.toLowerCase() === filter.trim().toLowerCase());
        if (!m || listed) {
          mount(typed);
          return;
        }
        const [, owner, name2] = m;
        const btn = h(
          "button",
          {
            class: "btn small",
            type: "button",
            disabled: busy,
            onClick: async () => {
              busy = true;
              error = "";
              btn.setAttribute("disabled", "");
              btn.replaceChildren(spinner(), h("span", null, t("lookUpTyped", `${owner}/${name2}`)));
              try {
                const info = await request("repo/info", { owner, name: name2 });
                busy = false;
                const id = `${info.owner}/${info.name}`.toLowerCase();
                const known = repos.find((r) => `${r.owner}/${r.name}`.toLowerCase() === id);
                if (!known) repos.unshift(info);
                filter = `${info.owner}/${info.name}`;
                search.value = filter;
                select(known ?? info);
              } catch (e) {
                error = errorText(e);
                busy = false;
                fillTyped();
              }
            }
          },
          h("span", null, t("lookUpTyped", `${owner}/${name2}`))
        );
        mount(typed, h("div", null, btn), selected ? null : note(error));
      };
      const fill = () => {
        fillTyped();
        const items = shown();
        if (!items.length) {
          mount(list, h("div", { class: "empty muted" }, t("noRepos")));
          return;
        }
        mount(
          list,
          items.map(
            (r) => h(
              "div",
              {
                class: "repo",
                role: "option",
                "aria-selected": String(selected === r),
                onClick: () => select(r)
              },
              h("span", { class: "nm" }, `${r.owner}/${r.name}`),
              r.managed ? h("span", { class: "tag accent" }, "gitchat") : null,
              r.empty ? h("span", { class: "tag" }, t("repoEmpty")) : null,
              r.private ? h("span", { class: "tag", title: t("repoPrivate") }, icon2("lock")) : h("span", { class: "tag warn" }, t("repoPublic"))
            )
          )
        );
      };
      const select = (r) => {
        selected = r;
        fill();
        renderDetail();
      };
      const renderDetail = () => {
        if (!selected) {
          mount(detail);
          return;
        }
        const r = selected;
        const warn = [];
        if (!r.private) warn.push(t("repoPublicWarn"));
        if (!r.empty && !r.managed) warn.push(t("repoNotEmptyWarn"));
        const useBtn = h(
          "button",
          {
            class: "btn solid",
            type: "button",
            disabled: busy,
            onClick: async () => {
              busy = true;
              error = "";
              useBtn.setAttribute("disabled", "");
              useBtn.replaceChildren(spinner(), h("span", null, t("use")));
              try {
                const repo = await request("repo/use", { owner: r.owner, name: r.name, branch: r.defaultBranch });
                onDone(repo);
              } catch (e) {
                error = errorText(e);
                busy = false;
                renderDetail();
              }
            }
          },
          h("span", null, t("use")),
          h("span", { class: "mono" }, `${r.owner}/${r.name}`)
        );
        mount(
          detail,
          warn.map((w) => h("div", { class: "note" }, icon2("alert"), h("span", null, w))),
          h("div", null, useBtn),
          note(error)
        );
      };
      search.addEventListener("input", () => {
        filter = search.value;
        fill();
      });
      list.addEventListener("keydown", (e) => {
        const items = shown();
        if (!items.length) return;
        const i = selected ? items.indexOf(selected) : -1;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const next = items[Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
          if (next) select(next);
          list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
        }
      });
      fill();
      renderDetail();
      return h(
        "div",
        { class: "stack fade" },
        search,
        typed,
        list,
        detail,
        h("p", { class: "muted hint" }, t("repoMissingHint")),
        limitedToken ? githubLink() : null
      );
    }
    async function loadRepos() {
      loading = true;
      listError = "";
      render();
      try {
        repos = await request("repo/list", {});
        repos.sort((a, b) => Number(b.managed) - Number(a.managed) || Number(b.empty) - Number(a.empty) || a.name.localeCompare(b.name));
      } catch (e) {
        listError = errorText(e);
      } finally {
        loading = false;
        if (mode === "existing") render();
      }
    }
    root.append(seg, body);
    render();
    if (mode === "existing") void loadRepos();
    return root;
  }

  // src/options/onboarding.ts
  var STEPS = ["welcome", "connect", "repo", "prefs", "done"];
  var STEP_LABEL = { welcome: "stepWelcome", connect: "stepConnect", repo: "stepRepo", prefs: "stepPrefs", done: "stepDone" };
  function createOnboarding(opts) {
    const root = h("div", { class: "wizard" });
    const steps = h("ol", { class: "steps", "aria-label": t("setupProgress") });
    const card = glass(h("section", { class: "step-card" }), { radius: 22, scale: 26, bezel: 18 });
    const content = h("div", { class: "step-content", "aria-live": "polite" });
    card.append(content);
    root.append(steps, card);
    let step = app.auth ? app.settings.repo ? "prefs" : "repo" : "welcome";
    let error = "";
    function go(next2) {
      step = next2;
      error = "";
      render();
      content.querySelector("h1")?.focus({ preventScroll: true });
    }
    function renderSteps() {
      const cur = STEPS.indexOf(step);
      mount(
        steps,
        STEPS.map(
          (s2, i) => h(
            "li",
            { class: i < cur ? "done" : i === cur ? "current" : "", "aria-current": i === cur ? "step" : null },
            h("span", { class: "node", "aria-hidden": "true" }),
            h("span", { class: "lb" }, t(STEP_LABEL[s2]))
          )
        )
      );
    }
    const title = (key) => h("h1", { tabindex: -1 }, t(key));
    const lead = (key) => h("p", { class: "lead" }, t(key));
    const errNote = () => error ? h("div", { class: "note err", role: "alert" }, icon2("alert"), h("span", null, error)) : null;
    const nav = (back, primary) => h(
      "div",
      { class: "nav" },
      back ? h("button", { class: "btn ghost", type: "button", onClick: () => go(back) }, icon2("back"), h("span", null, t("back"))) : h("span"),
      primary
    );
    const next = (label, to) => h(
      "button",
      { class: "btn solid", type: "button", onClick: () => typeof to === "function" ? to() : go(to) },
      h("span", null, label),
      icon2("arrow")
    );
    function render() {
      renderSteps();
      if (step === "prefs" || step === "done") opts.preview.show(app.settings.widget);
      else opts.preview.hide();
      const body = h("div", { class: "step-body enter" });
      switch (step) {
        case "welcome":
          body.append(
            h("div", { class: "hero" }, createMark(96)),
            title("obWelcomeTitle"),
            lead("obWelcomeBody"),
            h("ul", { class: "points" }, ...["obPoint1", "obPoint2", "obPoint3"].map((k) => h("li", null, icon2("check"), h("span", null, t(k))))),
            nav(null, next(t("obStart"), app.auth ? "repo" : "connect"))
          );
          break;
        case "connect":
          body.append(title("obConnectTitle"), lead("obConnectBody"));
          if (app.auth) {
            body.append(
              h("div", { class: "note ok" }, icon2("check"), h("span", null, t("signedInAs", app.auth.login))),
              nav("welcome", next(t("continue"), "repo"))
            );
          } else {
            body.append(
              createConnect(async () => {
                await refreshAuth().catch(() => void 0);
                go(app.settings.repo ? "prefs" : "repo");
              }),
              nav("welcome", null)
            );
          }
          break;
        case "repo":
          body.append(title("obRepoTitle"), lead("obRepoBody"));
          if (app.settings.repo) {
            const r = app.settings.repo;
            body.append(
              h("div", { class: "note ok" }, icon2("check"), h("span", { class: "mono" }, `${r.owner}/${r.name}`)),
              nav("connect", next(t("continue"), "prefs"))
            );
          } else {
            body.append(
              createRepoChooser(async (repo) => {
                await refreshSettings().catch(() => void 0);
                if (!app.settings.repo) await patchSettings({ repo }).catch(() => void 0);
                void refreshSync();
                go("prefs");
              }),
              nav("connect", null)
            );
          }
          break;
        case "prefs": {
          const autos = createAutoSwitches(opts.preview, (m) => showError(m));
          opts.preview.syncAuto(app.settings.autoCommit, app.settings.autoPush);
          body.append(
            title("obPrefsTitle"),
            lead("obPrefsBody"),
            h("div", { class: "lbl" }, t("widgetStyle")),
            createStylePicker(opts.preview, (m) => showError(m)),
            h(
              "div",
              { class: "rows" },
              row(t("autoCommit"), t("autoCommitHint"), autos.commit.el, "gc-hint-autocommit", icon2("commit")),
              row(t("autoPush"), t("autoPushHint"), autos.push.el, "gc-hint-autopush", icon2("push"))
            ),
            ...error ? [errNote()] : [],
            nav("repo", next(t("continue"), "done"))
          );
          break;
        }
        case "done":
          body.append(
            h("div", { class: "hero" }, createMark(80)),
            title("obDoneTitle"),
            lead("obDoneBody"),
            h(
              "div",
              { class: "links" },
              SERVICE_LINKS.map(
                (sv) => h("a", { class: "link", href: sv.url, target: "_blank", rel: "noopener noreferrer" }, h("span", null, t("openService", sv.name)), icon2("external"))
              )
            ),
            nav("prefs", next(t("goToSettings"), () => opts.onFinish()))
          );
          break;
      }
      mount(content, body);
    }
    function showError(msg) {
      error = msg;
      const n = content.querySelector(".note.err");
      const el = h("div", { class: "note err", role: "alert" }, icon2("alert"), h("span", null, msg));
      if (n) n.replaceWith(el);
      else content.querySelector(".nav")?.before(el);
    }
    render();
    return root;
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

  // src/content/ui/demo-store.js
  var seq = 0;
  var uid2 = (p = "c") => `${p}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  var KINDS = ["text", "math", "viz", "code", "text"];
  function sample() {
    const ago2 = (m) => Date.now() - m * 6e4;
    return {
      tracked: true,
      service: "claude",
      path: "claude/2026-11-09-state-design--a1b2c3.md",
      webUrl: "https://github.com/you/ai-chats/blob/main/claude/2026-11-09-state-design--a1b2c3.md",
      captureStage: "loading",
      // loading (older messages) | reading
      captureCount: 0,
      staged: [
        { id: uid2("s"), role: "user", kind: "text" },
        { id: uid2("s"), role: "ai", kind: "math" },
        { id: uid2("s"), role: "ai", kind: "viz" }
      ],
      commits: [
        { id: uid2(), n: 4, t: ago2(12), pushed: false },
        { id: uid2(), n: 2, t: ago2(41), pushed: false },
        { id: uid2(), n: 6, t: ago2(190), pushed: true },
        { id: uid2(), n: 3, t: ago2(600), pushed: true },
        { id: uid2(), n: 8, t: ago2(1500), pushed: true },
        { id: uid2(), n: 12, t: ago2(3e3), pushed: true },
        { id: uid2(), n: 5, t: ago2(4300), pushed: true }
      ],
      settings: { autoCommit: false, autoPush: false },
      phase: "idle",
      // idle | capturing | pushing | error
      ai: "idle",
      // idle | thinking | streaming (what the chat's AI is doing)
      progress: 0,
      failNext: false
    };
  }
  function createStore() {
    const state = sample();
    const subs3 = /* @__PURE__ */ new Set();
    const timers = { commit: 0, push: 0, cap: 0, push2: 0, ai1: 0, ai2: 0 };
    const emit2 = (type, detail = {}) => {
      for (const fn of [...subs3]) fn(type, detail, state);
    };
    const aheadList = () => state.commits.filter((c) => !c.pushed);
    const clearAll = () => Object.values(timers).forEach((id) => clearTimeout(id));
    const scheduleCommit = (ms = 1500) => {
      clearTimeout(timers.commit);
      timers.commit = setTimeout(() => api.commit(), ms);
    };
    const schedulePush = (ms = 900) => {
      clearTimeout(timers.push);
      timers.push = setTimeout(() => api.push(), ms);
    };
    const newItems = (count, start = 0) => Array.from({ length: count }, (_, i) => {
      const ai = (start + i) % 2 === 1;
      return { id: uid2("s"), role: ai ? "ai" : "user", kind: ai ? KINDS[Math.floor(Math.random() * KINDS.length)] : "text" };
    });
    const api = {
      state,
      get ahead() {
        return aheadList().length;
      },
      subscribe(fn) {
        subs3.add(fn);
        return () => subs3.delete(fn);
      },
      // A new exchange appeared in the chat. Tracked chats stage it automatically.
      reply(count = 2) {
        if (!state.tracked || state.phase === "capturing") return;
        const items = newItems(count);
        state.staged.push(...items);
        emit2("staged", { items });
        if (state.settings.autoCommit) scheduleCommit();
      },
      // One full turn as the extension would see it on the page:
      // user message sent → AI thinking → AI streaming its answer → answer done.
      // The user message is staged right away; auto-commit waits for the answer to finish.
      aiTurn({ withUser = true, thinkMs = 1700, streamMs = 2800 } = {}) {
        if (state.phase === "capturing") return;
        clearTimeout(timers.ai1);
        clearTimeout(timers.ai2);
        clearTimeout(timers.commit);
        const tracked2 = state.tracked;
        if (withUser && tracked2) {
          const items = [{ id: uid2("s"), role: "user", kind: "text" }];
          state.staged.push(...items);
          emit2("staged", { items, from: "input" });
        }
        state.ai = "thinking";
        emit2("ai", { phase: "thinking" });
        timers.ai1 = setTimeout(() => {
          state.ai = "streaming";
          emit2("ai", { phase: "streaming", ms: streamMs });
        }, thinkMs);
        timers.ai2 = setTimeout(() => {
          if (state.tracked) {
            const items = [{ id: uid2("s"), role: "ai", kind: KINDS[Math.floor(Math.random() * KINDS.length)] }];
            state.staged.push(...items);
            emit2("staged", { items, from: "stream" });
          }
          state.ai = "idle";
          emit2("ai", { phase: "idle" });
          if (state.tracked && state.settings.autoCommit) scheduleCommit();
        }, thinkMs + streamMs);
      },
      commit() {
        clearTimeout(timers.commit);
        if (!state.tracked || state.phase === "capturing") return;
        if (!state.staged.length) return emit2("nope", { action: "commit" });
        const commit = { id: uid2(), n: state.staged.length, t: Date.now(), pushed: false };
        state.staged = [];
        state.commits.unshift(commit);
        emit2("committed", { commit });
        if (state.settings.autoPush) schedulePush();
      },
      // Push sends everything: anything still staged is committed first.
      push() {
        clearTimeout(timers.push);
        if (state.phase === "pushing" || state.phase === "capturing") return;
        if (state.tracked && state.staged.length) {
          api.commit();
          if (!state.settings.autoPush) schedulePush(650);
          return;
        }
        const list = aheadList();
        if (!list.length) return emit2("nope", { action: "push" });
        state.phase = "pushing";
        emit2("pushStart", { commits: list });
        timers.push2 = setTimeout(() => {
          if (state.phase !== "pushing") return;
          if (state.failNext) {
            state.failNext = false;
            state.phase = "error";
            return emit2("error", { action: "push" });
          }
          list.forEach((c) => c.pushed = true);
          state.phase = "idle";
          emit2("pushed", { commits: list });
        }, 1500);
      },
      // Start tracking: scroll to the top loading older messages (count grows), then read every
      // message top to bottom (0–100%). Long chats take a while, so both stages report progress.
      init() {
        if (state.tracked || state.phase === "capturing") return;
        state.phase = "capturing";
        state.progress = 0;
        state.captureStage = "loading";
        state.captureCount = 0;
        emit2("captureStart");
        const total = 180;
        const t0 = performance.now();
        const loadMs = 3200;
        const readMs = 2400;
        const tick = () => {
          const el = performance.now() - t0;
          if (el < loadMs) {
            state.captureStage = "loading";
            state.captureCount = Math.round(total * (1 - Math.exp(-3 * el / loadMs)));
            state.progress = 0.25 * (el / loadMs);
          } else {
            state.captureStage = "reading";
            state.captureCount = total;
            state.progress = 0.25 + 0.75 * Math.min(1, (el - loadMs) / readMs);
          }
          emit2("progress", { p: state.progress, stage: state.captureStage, count: state.captureCount });
          if (el < loadMs + readMs) {
            timers.cap = setTimeout(tick, 50);
            return;
          }
          state.tracked = true;
          state.phase = "idle";
          state.staged = newItems(14);
          emit2("captured", { items: state.staged });
          if (state.settings.autoCommit) scheduleCommit(1200);
        };
        tick();
      },
      cancelInit() {
        if (state.phase !== "capturing") return;
        clearTimeout(timers.cap);
        state.phase = "idle";
        state.progress = 0;
        emit2("captureCancel");
      },
      untrack() {
        clearAll();
        Object.assign(state, { tracked: false, staged: [], commits: [], phase: "idle", ai: "idle", progress: 0, failNext: false });
        emit2("reset");
      },
      resetSample() {
        clearAll();
        const s2 = sample();
        s2.settings = state.settings;
        Object.assign(state, s2);
        emit2("reset");
      },
      failNextPush() {
        state.failNext = true;
        emit2("armed");
      },
      setAuto(key, value) {
        const s2 = state.settings;
        let linked = null;
        if (key === "autoPush") {
          if (value && !s2.autoCommit) {
            s2.autoCommit = true;
            linked = "autoCommit";
          }
          s2.autoPush = value;
        } else {
          if (!value && s2.autoPush) {
            s2.autoPush = false;
            linked = "autoPush";
          }
          s2.autoCommit = value;
        }
        emit2("settings", { key, value, linked });
        if (s2.autoCommit && state.staged.length) scheduleCommit(1100);
        else if (s2.autoPush && aheadList().length) schedulePush(800);
      }
    };
    return api;
  }

  // src/content/ui/core/pointer.js
  var pointer = { x: -1e4, y: -1e4, active: false };
  var NEAR = 640;
  var wasNear = false;
  addEventListener(
    "pointermove",
    (e) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;
      const near = e.clientX > innerWidth - NEAR;
      if (near || wasNear) wake(700);
      wasNear = near;
    },
    { capture: true, passive: true }
  );
  addEventListener("resize", () => wake(400), { passive: true });
  document.documentElement.addEventListener("pointerleave", () => {
    pointer.active = false;
    pointer.x = pointer.y = -1e4;
    wake(700);
  });

  // src/content/ui/core/html.js
  var policy = null;
  function setHTML(el, html) {
    try {
      el.innerHTML = html;
      return;
    } catch (e) {
      if (!(e instanceof TypeError) || !globalThis.trustedTypes?.createPolicy) throw e;
    }
    policy ??= globalThis.trustedTypes.createPolicy("gitchat", { createHTML: (s2) => s2 });
    el.innerHTML = policy.createHTML(html);
  }

  // src/content/ui/core/panel.js
  var OPEN = springEasing({ stiffness: 380, damping: 38 });
  var CLOSE = springEasing({ stiffness: 600, damping: 50 });
  var NS2 = "http://www.w3.org/2000/svg";
  function mk(tag, attrs = {}, parent) {
    const e = document.createElementNS(NS2, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function rollText(el, text) {
    if (el.textContent === text) return;
    el.textContent = text;
    if (!el.isConnected) return;
    const now = performance.now();
    const last2 = el._rollAt ?? 0;
    el._rollAt = now;
    if (now - last2 < 400) return;
    el.animate(
      [
        { transform: "translateY(5px)", opacity: 0 },
        { transform: "translateY(0)", opacity: 1 }
      ],
      { duration: 220, easing: "cubic-bezier(.2,.7,.2,1)" }
    );
  }
  var panelCSS = `
.panel {
  position: fixed; top: 0; right: 0; width: 236px; --r: 16px; border-radius: 16px;
  display: none; transform-origin: 50% 50%; z-index: 5; color: var(--ink);
  font-size: 12px; line-height: 1; -webkit-font-smoothing: antialiased;
}
.panel.open { display: block; }
.panel > .lg-b { background: var(--tint-strong); }
.panel .content { position: relative; padding: 8px 8px 6px; }
.panel .graph { display: block; overflow: visible; }
.panel.untracked .graph, .panel.untracked .ib.commit, .panel.untracked .ib.push, .panel.untracked .ib.link { display: none; }
/* automatic actions need no button */
.panel.auto-commit .ib.commit, .panel.auto-push:not(.error) .ib.push { display: none; }

.panel .bar { display: flex; align-items: center; gap: 2px; margin-top: 4px; padding-top: 6px; border-top: .5px solid var(--line); }
.panel .ib { all: unset; position: relative; width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center;
  color: var(--ink); cursor: pointer; transition: background .15s, opacity .2s, color .2s; }
.panel .ib:hover { background: var(--hover); }
.panel .ib.dim { opacity: .3; }
.panel .ib svg.i { width: 16px; height: 16px; stroke-width: 1.6; }
.panel .ib.done { color: var(--accent); }
.panel .ib .spin { position: absolute; inset: 6px; width: 18px; height: 18px; display: none; overflow: visible; }
.panel .ib .spin circle { fill: none; stroke: var(--accent); stroke-width: 1.5; stroke-linecap: round; stroke-dasharray: .25 .75;
  transform-box: fill-box; transform-origin: center; animation: spin .8s linear infinite; }
.pushing .ib.push svg.i { opacity: 0; }
.pushing .ib.push .spin { display: block; }
.error .ib.push { color: var(--err); opacity: 1; }
.panel .sp { flex: 1; }
.panel .msg { display: none; margin: 4px 2px 0; font-size: 11px; line-height: 1.4; color: var(--err); }
.panel.error .msg { display: block; }
.panel.stalled:not(.error) .msg { display: block; color: var(--ink-3); }
.sw { all: unset; display: flex; align-items: center; gap: 4px; height: 30px; padding: 0 4px; border-radius: 8px; cursor: pointer; color: var(--ink-3); transition: color .2s; }
.sw:hover { background: var(--hover); }
.sw svg.i { width: 12px; height: 12px; stroke-width: 1.7; }
.sw .tr { position: relative; width: 22px; height: 13px; border-radius: 7px; background: var(--track); transition: background .2s; }
.sw .kn { position: absolute; top: 2px; left: 2px; width: 9px; height: 9px; border-radius: 5px; background: var(--thumb);
  box-shadow: 0 .5px 1.5px rgba(0,0,0,.3); transition: transform .32s var(--spring); }
.sw[aria-checked="true"] { color: var(--ink); }
.sw[aria-checked="true"] .tr { background: var(--accent); }
.sw[aria-checked="true"] .kn { transform: translateX(9px); }
.sw + .sw { margin-left: -2px; }

.graph .ln { fill: none; stroke-width: 1; }
.graph .ln.pushed { stroke: var(--ink-4); }
.graph .ln.ahead { stroke: var(--accent); }
.graph .ln.work { stroke: var(--ink-3); stroke-dasharray: 1.5 2.5; }
.graph .ln.tail { stroke: var(--ink-4); stroke-dasharray: 1.5 2.5; }
.graph .hl { fill: var(--hover); opacity: 0; transition: opacity .15s; }
.graph .row:hover .hl { opacity: 1; }
.graph .wk { fill: none; stroke: var(--ink); stroke-width: 1.2; }
.graph .row.empty .wk { stroke: var(--ink-3); }
.graph .ping { fill: none; stroke: var(--ink); stroke-width: 1; opacity: 0; transform-box: fill-box; transform-origin: center; }
.graph .dot { fill: var(--dot); transition: fill .2s; }
.graph .row.ahead .dot { fill: var(--accent); }
.graph text { font: 500 11px/1 var(--mono); font-variant-numeric: tabular-nums; }
.graph .lab { fill: var(--ink); }
.graph .row.pv .lab { fill: var(--ink-2); }
.graph .ago { fill: var(--ink-3); text-anchor: end; }
.graph .origin line { stroke: var(--ink-3); stroke-width: 1; stroke-dasharray: 1 2.5; }
.graph .origin .cl { color: var(--ink-3); }
.graph.sending .origin line { stroke: var(--accent); }
.graph.sending .origin .cl { color: var(--accent); }
.graph.err .origin line { stroke: var(--err); }
.graph.err .origin .cl { color: var(--err); }
@keyframes spin { to { transform: rotate(360deg); } }
`;
  var W = 220;
  var X = 10;
  var TOP = 11;
  var ROW = 24;
  var MAX = 6;
  function createGraph(svg, store, isOpen) {
    setHTML(svg, `
    <g class="lines"><path class="ln pushed"/><path class="ln ahead"/><path class="ln work"/><path class="ln tail"/></g>
    <g class="rows"></g>
    <g class="origin"><line x1="${X - 6}" x2="${W}" y1="0" y2="0"/></g>`);
    const q = (s2) => svg.querySelector(s2);
    const ln = { pushed: q(".ln.pushed"), ahead: q(".ln.ahead"), work: q(".ln.work"), tail: q(".ln.tail") };
    const rowsG = q(".rows");
    const originG = q(".origin");
    const rows = /* @__PURE__ */ new Map();
    const height = new Spring(40, { stiffness: 420, damping: 40 });
    const originY = new Spring(0, { stiffness: 260, damping: 32 });
    const originO = new Spring(0, { stiffness: 400, damping: 40 });
    let hasTail = false;
    let top0 = TOP;
    const list = () => {
      const st = store.state;
      if (!st.tracked) return [];
      const cs = st.commits.slice(0, MAX).reverse().map((c) => ({ id: c.id, type: "commit", c }));
      return [...cs, { id: "work", type: "work" }];
    };
    function make(r, y0, snap) {
      const g = mk("g", { class: `row ${r.type}` }, rowsG);
      mk("rect", { class: "hl", x: -6, y: -ROW / 2 + 1, width: W + 4, height: ROW - 2, rx: 6 }, g);
      const n = {
        id: r.id,
        r,
        g,
        y: new Spring(y0, { stiffness: 380, damping: 38 }),
        o: new Spring(snap ? 1 : 0, { stiffness: 400, damping: 40 }),
        dead: false
      };
      if (r.type === "work") {
        n.ping = mk("circle", { class: "ping", cx: X, r: 4.5 }, g);
        mk("circle", { class: "wk", cx: X, r: 4.5 }, g);
      } else {
        n.dot = mk("circle", { class: "dot", cx: X, r: 3.2 }, g);
        n.ago = mk("text", { class: "ago", x: W, y: 4 }, g);
        n.pv = r.c.pushed && snap;
        g.classList.toggle("ahead", !n.pv);
        g.classList.toggle("pv", n.pv);
      }
      n.lab = mk("text", { class: "lab", x: X + 14, y: 4 }, g);
      o(n);
      n.o.set(1);
      return n;
    }
    const o = (n) => n.g.setAttribute("opacity", clamp(n.o.value, 0, 1).toFixed(3));
    function labels(n) {
      const st = store.state;
      if (n.r.type === "work") {
        const k = st.staged.length;
        rollText(n.lab, k ? `+${k}` : "");
        n.g.classList.toggle("empty", !k);
      } else {
        n.lab.textContent = `+${n.r.c.n}`;
        n.ago.textContent = fmtAgo(n.r.c.t);
      }
    }
    function sync(spawnY = null, snap = false) {
      const rs = list();
      const keep = /* @__PURE__ */ new Set();
      hasTail = store.state.commits.length > MAX;
      top0 = TOP + (hasTail ? 14 : 0);
      rs.forEach((r, i) => {
        const y = top0 + i * ROW;
        let n = rows.get(r.id);
        if (!n) {
          n = make(r, spawnY ?? y, snap);
          rows.set(r.id, n);
        }
        n.r = r;
        n.dead = false;
        n.y.set(y);
        if (snap) {
          n.y.snap(y);
          n.o.snap(1);
        }
        keep.add(r.id);
        labels(n);
      });
      for (const n of rows.values()) {
        if (!keep.has(n.id) && !n.dead) {
          n.dead = true;
          n.o.set(0);
        }
      }
      const st = store.state;
      const firstAhead = rs.findIndex((r) => r.type === "commit" && !r.c.pushed);
      const oy = top0 + ((firstAhead === -1 ? rs.length - 1 : firstAhead) - 0.5) * ROW;
      originY.set(oy);
      originO.set(st.tracked && st.commits.some((c) => c.pushed) ? 1 : 0);
      const h2 = rs.length ? top0 + (rs.length - 1) * ROW + 12 : 30;
      height.set(h2);
      if (snap) {
        originY.snap(oy);
        originO.snap(originO.target);
        height.snap(h2);
      }
    }
    function frame(dt) {
      if (!isOpen()) return;
      height.step(dt);
      svg.setAttribute("height", height.value.toFixed(1));
      svg.setAttribute("viewBox", `-6 0 ${W + 8} ${height.value.toFixed(1)}`);
      originY.step(dt);
      originO.step(dt);
      const oY = originY.value;
      originG.setAttribute("transform", `translate(0 ${oY.toFixed(2)})`);
      originG.setAttribute("opacity", clamp(originO.value, 0, 1).toFixed(3));
      const commits = [];
      for (const [id, n] of rows) {
        n.y.step(dt);
        n.o.step(dt);
        if (n.dead && n.o.value < 0.02) {
          n.g.remove();
          rows.delete(id);
          continue;
        }
        n.g.setAttribute("transform", `translate(0 ${n.y.value.toFixed(2)})`);
        o(n);
        if (n.r.type === "commit" && !n.dead) {
          const pv = n.r.c.pushed && oY > n.y.value;
          if (pv !== n.pv) {
            n.pv = pv;
            n.g.classList.toggle("ahead", !pv);
            n.g.classList.toggle("pv", pv);
          }
          commits.push(n);
        }
      }
      commits.sort((a, b) => a.y.value - b.y.value);
      const work = rows.get("work");
      if (commits.length) {
        const fy = commits[0].y.value;
        const ly = commits[commits.length - 1].y.value;
        ln.work.setAttribute("d", work && !work.dead ? `M${X} ${(ly + 3.5).toFixed(1)}V${(work.y.value - 5).toFixed(1)}` : "");
        const pEnd = Math.min(oY, ly);
        ln.pushed.setAttribute("d", pEnd > fy ? `M${X} ${fy.toFixed(1)}V${pEnd.toFixed(1)}` : "");
        const aStart = Math.max(oY, fy);
        ln.ahead.setAttribute("d", ly > aStart ? `M${X} ${aStart.toFixed(1)}V${ly.toFixed(1)}` : "");
        ln.tail.setAttribute("d", hasTail ? `M${X} ${(fy - 18).toFixed(1)}V${(fy - 6).toFixed(1)}` : "");
      } else {
        for (const k in ln) ln[k].setAttribute("d", "");
      }
    }
    const shownState = () => {
      const st = store.state;
      return `${st.staged.length}|${st.commits.map((c) => `${c.id}:${c.pushed ? 1 : 0}`).join(",")}`;
    };
    let lastShown = "";
    function onEvent(type, d) {
      if (!isOpen()) return;
      const shown = shownState();
      const changed = shown !== lastShown;
      lastShown = shown;
      if (type === "status") {
        if (changed) sync();
      } else if (type === "staged") {
        const w = rows.get("work");
        if (w) {
          labels(w);
          w.ping.animate(
            [
              { transform: "scale(1)", opacity: 0.5 },
              { transform: "scale(2.6)", opacity: 0 }
            ],
            { duration: 500, easing: "cubic-bezier(.2,.7,.2,1)" }
          );
        }
      } else if (type === "committed") {
        const w = rows.get("work");
        sync(w ? w.y.value : TOP);
      } else if (type === "pushStart") {
        svg.classList.add("sending");
        svg.classList.remove("err");
      } else if (type === "pushed") {
        svg.classList.remove("sending");
        sync();
      } else if (type === "pushEnd") {
        svg.classList.remove("sending");
        if (d?.ok) sync();
      } else if (type === "error") {
        svg.classList.remove("sending");
        svg.classList.add("err");
      } else if (type === "captured" || type === "reset") {
        svg.classList.remove("sending", "err");
        sync(null, true);
      }
    }
    return {
      frame,
      onEvent,
      refresh() {
        svg.classList.toggle("sending", store.state.phase === "pushing");
        svg.classList.toggle("err", store.state.phase === "error");
        lastShown = shownState();
        sync(null, true);
      }
    };
  }
  function createPanel(root, store, { onRequestClose, openSettings, label = (k) => k } = {}) {
    const el = document.createElement("div");
    el.className = "panel lg";
    setHTML(el, `
    <div class="lg-b"></div><div class="lg-h"></div>
    <div class="content">
      <svg class="graph" width="${W}" height="40"></svg>
      <div class="msg" role="status"></div>
      <div class="bar">
        <button class="ib commit" aria-label="Commit" title="Commit">${icon.commit}</button>
        <button class="ib push" aria-label="Push" title="Push">${icon.push}<svg class="spin" viewBox="-10 -10 20 20"><circle r="8" pathLength="1"/></svg></button>
        <button class="ib link" aria-label="Copy link" title="Copy link">${icon.link}</button>
        <button class="ib gear" aria-label="Settings" title="Settings">${icon.gear}</button>
        <span class="sp"></span>
        <button class="sw" data-k="autoCommit" role="switch" aria-checked="false" aria-label="Auto commit" title="Auto commit">${icon.commit}<span class="tr"><span class="kn"></span></span></button>
        <button class="sw" data-k="autoPush" role="switch" aria-checked="false" aria-label="Auto push" title="Auto push">${icon.push}<span class="tr"><span class="kn"></span></span></button>
      </div>
    </div>`);
    root.appendChild(el);
    const $ = (s2) => el.querySelector(s2);
    const content = $(".content");
    const glassB = el.querySelector(":scope > .lg-b");
    const btnCommit = $(".ib.commit");
    const btnPush = $(".ib.push");
    const switches = [...el.querySelectorAll(".sw")];
    let open = false;
    let lensKey = "";
    let placement = null;
    const graph = createGraph($(".graph"), store, () => open);
    function ui() {
      const st = store.state;
      el.classList.toggle("untracked", !st.tracked);
      el.classList.toggle("capturing", st.phase === "capturing");
      el.classList.toggle("pushing", st.phase === "pushing");
      el.classList.toggle("error", st.phase === "error");
      el.classList.toggle("stalled", !!st.stalled && st.phase !== "error");
      el.classList.toggle("auto-commit", !!st.settings.autoCommit);
      el.classList.toggle("auto-push", !!st.settings.autoPush);
      $(".msg").textContent = st.phase === "error" ? st.error || "" : st.stalled ? label("aiStalled") : "";
      btnCommit.classList.toggle("dim", !st.staged.length);
      btnPush.classList.toggle("dim", !st.staged.length && !store.ahead && st.phase !== "error");
    }
    function setSwitch(k, delay = 0) {
      const sw = switches.find((s2) => s2.dataset.k === k);
      const go = () => sw.setAttribute("aria-checked", String(store.state.settings[k]));
      if (delay) setTimeout(go, delay);
      else go();
    }
    function nudge(btn) {
      btn.animate(
        [{ transform: "translateX(0)" }, { transform: "translateX(-3px)" }, { transform: "translateX(3px)" }, { transform: "translateX(0)" }],
        { duration: 240, easing: "ease-out" }
      );
    }
    btnCommit.addEventListener("click", () => store.commit());
    btnPush.addEventListener("click", () => store.push());
    switches.forEach((sw) => sw.addEventListener("click", () => store.setAuto(sw.dataset.k, !store.state.settings[sw.dataset.k])));
    $(".gear").addEventListener("click", () => {
      onRequestClose?.();
      openSettings?.();
    });
    if (!openSettings) $(".gear").hidden = true;
    for (const [sel, key] of [[".ib.commit", "commit"], [".ib.push", "push"], [".link", "copyLink"], [".gear", "openSettings"], [".sw[data-k=autoCommit]", "autoCommit"], [".sw[data-k=autoPush]", "autoPush"]]) {
      const b = $(sel);
      const text = label(key);
      if (b && text !== key) {
        b.setAttribute("aria-label", text);
        b.title = text;
      }
    }
    $(".link").addEventListener("click", async () => {
      const b = $(".link");
      try {
        await navigator.clipboard.writeText(store.state.webUrl || store.state.path || "");
      } catch {
      }
      setHTML(b, icon.check);
      b.classList.add("done");
      setTimeout(() => {
        setHTML(b, icon.link);
        b.classList.remove("done");
      }, 1200);
    });
    const unsub = store.subscribe((type, d) => {
      ui();
      graph.onEvent(type, d);
      if (type === "settings") {
        setSwitch(d.key);
        if (d.linked) setSwitch(d.linked, 160);
      } else if (type === "nope") {
        nudge(d.action === "commit" ? btnCommit : btnPush);
      } else if (type === "captureStart") {
        onRequestClose?.();
      } else if (type === "captured") {
        content.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
      }
    });
    const stopFrame = onFrame((dt) => {
      if (!open) return;
      graph.frame(dt);
      const r = el.getBoundingClientRect();
      if (pointer.active) setLight(el, pointer.x - (r.left + r.width / 2), pointer.y - (r.top + r.height / 2));
      if (placement) {
        const top = parseFloat(el.style.top) || 0;
        const maxTop = innerHeight - r.height - 12;
        if (top > maxTop) el.style.top = `${Math.max(12, maxTop)}px`;
      }
      refreshLens(r.width, r.height);
    });
    function refreshLens(w, h2) {
      const key = `${Math.round(w)}x${Math.round(h2 / 8)}`;
      if (key === lensKey || w < 50) return;
      lensKey = key;
      applyLens(root, glassB, { w: el.offsetWidth, h: el.offsetHeight, r: 16, bezel: 14, scale: 26, blur: 16, sat: 1.3, bright: 1.04 });
    }
    function place(p) {
      placement = p;
      el.style.right = `${p.right}px`;
      const h2 = el.offsetHeight;
      el.style.top = `${clamp(p.centerY - h2 / 2, 12, Math.max(12, innerHeight - h2 - 12))}px`;
    }
    const onKey = (e) => {
      if (open && e.key === "Escape") onRequestClose?.();
    };
    const onDown = (e) => {
      if (open && !e.composedPath().includes(root.host)) onRequestClose?.();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    ui();
    switches.forEach((sw) => setSwitch(sw.dataset.k));
    return {
      el,
      get isOpen() {
        return open;
      },
      /** @param {{focus?: boolean}} [opts] focus: opened from the keyboard, move focus into the panel */
      open(origin, p, opts = {}) {
        if (open) return;
        open = true;
        el.getAnimations().forEach((a) => a.cancel());
        el.classList.add("open");
        ui();
        switches.forEach((sw) => setSwitch(sw.dataset.k));
        graph.refresh();
        graph.frame(0);
        place(p);
        lensKey = "";
        refreshLens(el.offsetWidth, el.offsetHeight);
        const r = el.getBoundingClientRect();
        const sx = origin.width / r.width;
        const sy = origin.height / r.height;
        const dx = origin.left + origin.width / 2 - (r.left + r.width / 2);
        const dy = origin.top + origin.height / 2 - (r.top + r.height / 2);
        el.animate(
          [
            { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, borderRadius: "50%" },
            { transform: "none", borderRadius: "16px" }
          ],
          { duration: OPEN.duration, easing: OPEN.easing }
        );
        content.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, delay: 80, easing: "linear", fill: "backwards" });
        if (opts.focus) requestAnimationFrame(() => [...el.querySelectorAll("button")].find((b) => !b.hidden && b.offsetParent)?.focus());
      },
      close(target) {
        if (!open) return Promise.resolve();
        const r = el.getBoundingClientRect();
        const sx = target.width / r.width;
        const sy = target.height / r.height;
        const dx = target.left + target.width / 2 - (r.left + r.width / 2);
        const dy = target.top + target.height / 2 - (r.top + r.height / 2);
        content.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, fill: "forwards" });
        const a = el.animate(
          [
            { transform: "none", borderRadius: "16px" },
            { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, borderRadius: "50%" }
          ],
          { duration: Math.min(CLOSE.duration, 320), easing: CLOSE.easing, fill: "forwards" }
        );
        const done = () => {
          open = false;
          el.classList.remove("open");
          el.getAnimations().forEach((x) => x.cancel());
          content.getAnimations().forEach((x) => x.cancel());
        };
        return a.finished.then(done, done);
      },
      destroy() {
        unsub();
        stopFrame();
        document.removeEventListener("keydown", onKey);
        document.removeEventListener("pointerdown", onDown, true);
        el.remove();
      }
    };
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

  // src/content/ui/core/actions.js
  var BTN = 26;
  var BTN_GAP = 6;
  var actionsCSS = `
.ab { all: unset; position: absolute; left: 0; top: 0; width: ${BTN}px; height: ${BTN}px; --r: 50%; border-radius: 50%;
  display: grid; place-items: center; color: var(--ink); cursor: pointer; opacity: 0; pointer-events: none; }
.ab > svg.i { position: relative; width: 13px; height: 13px; stroke-width: 1.7; transition: opacity .2s; }
.ab.dim > svg.i { opacity: .3; }
.ab:hover > .lg-b { background: var(--tint-strong); }
.ab:focus-visible { outline: 1.5px solid var(--accent); outline-offset: 2px; }
.ab .spin { position: absolute; inset: 5px; width: 16px; height: 16px; display: none; overflow: visible; }
.ab .spin circle { fill: none; stroke: var(--accent); stroke-width: 1.5; stroke-linecap: round; stroke-dasharray: .25 .75;
  transform-box: fill-box; transform-origin: center; animation: ab-spin .8s linear infinite; }
.ab.push.sending > svg.i { opacity: 0; }
.ab.push.sending .spin { display: block; }
.ab.push.err { color: var(--err); }
.ab.cancel { color: var(--ink-2); }
@keyframes ab-spin { to { transform: rotate(360deg); } }
`;
  var LABELS = { track: "Start saving this chat", cancel: "Cancel", commit: "Commit", push: "Push" };
  function createActions(root, parent, store, label = (k) => LABELS[k] ?? k) {
    const make = (kind, glyph2, extra = "") => {
      const b = document.createElement("button");
      b.className = `ab lg ${kind}`;
      const text = label(kind === "start" ? "track" : kind);
      b.setAttribute("aria-label", text);
      b.title = text;
      b.tabIndex = -1;
      setHTML(b, `<div class="lg-b"></div><div class="lg-h"></div>${glyph2}${extra}`);
      parent.appendChild(b);
      applyLens(root, b.querySelector(".lg-b"), { w: BTN, h: BTN, r: BTN / 2, bezel: 8, scale: 12, blur: 0.8, sat: 1.3 });
      return b;
    };
    const buttons = {
      start: make("start", icon.init),
      cancel: make("cancel", icon.close),
      commit: make("commit", icon.commit),
      push: make("push", icon.push, '<svg class="spin" viewBox="-10 -10 20 20"><circle r="8" pathLength="1"/></svg>')
    };
    const show = Object.fromEntries(Object.keys(buttons).map((k) => [k, new Spring(0, { stiffness: 420, damping: 38 })]));
    let order = [];
    let rect = null;
    let focused = false;
    const syncFocus = () => {
      const now = parent.contains(root.activeElement);
      if (now === focused) return;
      focused = now;
      syncTabs();
      wake();
    };
    const syncTabs = () => {
      for (const [kind, b] of Object.entries(buttons)) b.tabIndex = focused && order.includes(kind) ? 0 : -1;
    };
    parent.addEventListener("focusin", syncFocus);
    parent.addEventListener("focusout", () => queueMicrotask(syncFocus));
    buttons.start.addEventListener("click", () => store.init());
    buttons.cancel.addEventListener("click", () => store.cancelInit?.());
    buttons.commit.addEventListener("click", () => store.commit());
    buttons.push.addEventListener("click", () => store.push());
    function visible() {
      const st = store.state;
      return availableActions(st, st.settings);
    }
    function update() {
      const st = store.state;
      order = visible();
      syncTabs();
      const ahead = store.ahead ?? 0;
      buttons.commit.classList.toggle("dim", !st.staged.length);
      buttons.push.classList.toggle("dim", !st.staged.length && !ahead && st.phase !== "error");
      buttons.push.classList.toggle("sending", st.phase === "pushing");
      buttons.push.classList.toggle("err", st.phase === "error");
    }
    function frame(dt, at) {
      const n = order.length;
      const width = n * BTN + Math.max(0, n - 1) * BTN_GAP;
      let i = 0;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const [kind, b] of Object.entries(buttons)) {
        const idx = order.indexOf(kind);
        const on2 = idx >= 0;
        const s2 = show[kind];
        s2.set(on2 ? 1 : 0);
        s2.step(dt);
        const k = clamp((at.reveal - (on2 ? idx : i) * 0.15) / 0.85, 0, 1) * clamp(s2.value, 0, 1);
        if (!on2 && s2.value < 0.01) {
          b.style.opacity = "0";
          b.style.pointerEvents = "none";
          continue;
        }
        const slot = on2 ? idx : 0;
        let x;
        let y;
        if (at.dir === "row") {
          x = at.x - width / 2 + slot * (BTN + BTN_GAP);
          y = at.y;
        } else {
          x = at.x - BTN / 2;
          y = at.y + slot * (BTN + BTN_GAP);
        }
        b.style.transform = `translate(${x.toFixed(2)}px, ${(y - (1 - k) * 6).toFixed(2)}px) scale(${(0.6 + 0.4 * k).toFixed(3)})`;
        b.style.opacity = k.toFixed(3);
        b.style.pointerEvents = k > 0.6 ? "auto" : "none";
        if (on2) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x + BTN);
          y1 = Math.max(y1, y + BTN);
        }
        i++;
      }
      rect = n ? { x0, y0, x1, y1 } : null;
      return moving(Object.values(show));
    }
    function covers(px, py, margin = 8) {
      return !!rect && px > rect.x0 - margin && px < rect.x1 + margin && py > rect.y0 - margin && py < rect.y1 + margin;
    }
    function nudge(kind) {
      buttons[kind]?.animate([{ translate: "0 0" }, { translate: "-3px 0" }, { translate: "3px 0" }, { translate: "0 0" }], {
        duration: 240,
        easing: "ease-out"
      });
    }
    const unsub = store.subscribe((type, d) => {
      update();
      if (type === "nope") nudge(d.action);
      wake(1500);
    });
    update();
    return {
      frame,
      covers,
      update,
      /** True while keyboard focus is inside the widget: keep the buttons out. */
      get focused() {
        return focused;
      },
      /** Focus the first visible button (keyboard users after activating an untracked widget). */
      focusFirst() {
        const b = buttons[order[0]];
        if (b) {
          b.tabIndex = 0;
          b.focus();
        }
      },
      get count() {
        return order.length;
      },
      destroy() {
        unsub();
        Object.values(buttons).forEach((b) => b.remove());
      }
    };
  }

  // src/content/ui/variants/creature.js
  var BOX = 240;
  var HX = BOX - 50;
  var HY = 112;
  var R0 = 23;
  var MAX_SATS = 6;
  var MAX_PEARLS = 6;
  var NS3 = "http://www.w3.org/2000/svg";
  var mk2 = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS3, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  var css = `
.box { position: fixed; right: 0; top: 0; width: ${BOX}px; height: ${BOX}px; pointer-events: none;
  --body: #f3f3f6; --body-sleep: #dedee3; --edge-c: rgba(0,0,0,.17); --rim-c: rgba(255,255,255,.9); --shadow-c: rgba(0,0,0,.13); }
:host([data-theme="dark"]) .box { --body: #3d3d43; --body-sleep: #2d2d32; --edge-c: rgba(0,0,0,.55); --rim-c: rgba(255,255,255,.28); --shadow-c: rgba(0,0,0,.5); }
.frost { position: absolute; left: 0; top: 0; border-radius: 50%; pointer-events: none;
  -webkit-backdrop-filter: blur(8px) saturate(1.3); backdrop-filter: blur(8px) saturate(1.3); }
.sl { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.body, .reach, .sat, .dropc { fill: var(--body); transition: fill .6s; }
.sleep .body, .sleep .reach { fill: var(--body-sleep); }
.shf { flood-color: var(--shadow-c); }
.edf { flood-color: var(--edge-c); transition: flood-color .3s; }
.rmf { flood-color: var(--rim-c); }
.err .edf { flood-color: var(--err); }
.hit { fill: transparent; pointer-events: all; cursor: pointer; }
.box.drag .hit { cursor: grabbing; }
.eye { fill: var(--ink); }
.lid { fill: none; stroke: var(--ink); stroke-width: 1.5; stroke-linecap: round; }
.pearl, .rise { fill: var(--accent); }
.flyd { fill: var(--body); stroke: var(--edge-c); stroke-width: .7; }
.prog-t { fill: none; stroke: var(--ink-4); stroke-width: 1; }
.prog { fill: none; stroke: var(--accent); stroke-width: 1.4; stroke-linecap: round; }
.kb { all: unset; position: absolute; left: ${HX - R0 - 4}px; top: ${HY - R0 - 4}px; width: ${(R0 + 4) * 2}px; height: ${(R0 + 4) * 2}px;
  border-radius: 50%; pointer-events: none; }
.kb:focus-visible { outline: 1.5px solid var(--accent); outline-offset: 2px; }
.count { position: absolute; left: 0; top: 0; font: 500 10.5px/1 var(--mono); color: var(--ink-2); font-variant-numeric: tabular-nums;
  white-space: nowrap; pointer-events: none; opacity: 0; transform: translateX(-50%); }
`;
  function mountCreature(host, store, options = {}) {
    const noPanel = () => !store.state.tracked && store.state.phase !== "error" || store.state.phase === "capturing";
    const root = host.attachShadow({ mode: "open" });
    setHTML(root, `<style>${glassCSS}${panelCSS}${actionsCSS}${css}</style>
  <div class="box">
    <button class="kb" type="button"></button>
    <div class="frost"></div>
    <svg class="sl" viewBox="0 0 ${BOX} ${BOX}">
      <defs>
        <filter id="c-goo" x="0" y="0" width="${BOX}" height="${BOX}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="4.2" result="b"/>
          <feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -8.5" result="g"/>
          <feGaussianBlur in="g" stdDeviation="3" result="sh0"/>
          <feOffset in="sh0" dy="3" result="sh1"/>
          <feFlood class="shf"/>
          <feComposite in2="sh1" operator="in" result="shadow"/>
          <feComponentTransfer in="g" result="bodyA"><feFuncA type="linear" slope="0.76"/></feComponentTransfer>
          <feMorphology in="g" operator="dilate" radius="0.7" result="dil"/>
          <feComposite in="dil" in2="g" operator="out" result="edge"/>
          <feFlood class="edf"/>
          <feComposite in2="edge" operator="in" result="edgeC"/>
          <feMorphology in="g" operator="erode" radius="1.1" result="er"/>
          <feComposite in="g" in2="er" operator="out" result="rim"/>
          <feFlood class="rmf"/>
          <feComposite in2="rim" operator="in" result="rimC"/>
          <feGaussianBlur in="g" stdDeviation="2.4" result="gb"/>
          <feSpecularLighting in="gb" surfaceScale="3.5" specularConstant=".85" specularExponent="32" lighting-color="#ffffff" result="sp">
            <fePointLight class="light" x="180" y="40" z="140"/>
          </feSpecularLighting>
          <feComposite in="sp" in2="g" operator="in" result="spIn"/>
          <feMerge>
            <feMergeNode in="shadow"/><feMergeNode in="bodyA"/><feMergeNode in="edgeC"/><feMergeNode in="rimC"/><feMergeNode in="spIn"/>
          </feMerge>
        </filter>
      </defs>
      <g class="ringg"><circle class="prog-t"/><circle class="prog" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></g>
      <g class="goo" filter="url(#c-goo)">
        <ellipse class="body"/>
        <circle class="reach" r="0"/>
        <g class="sats"></g>
      </g>
      <g class="pearls"></g>
      <g class="face">
        <g class="eyeL"><rect class="eye" x="-1.6" y="-3.8" width="3.2" height="7.6" rx="1.6"/><path class="lid" d="M-2.6 0H2.6"/></g>
        <g class="eyeR"><rect class="eye" x="-1.6" y="-3.8" width="3.2" height="7.6" rx="1.6"/><path class="lid" d="M-2.6 0H2.6"/></g>
      </g>
      <g class="fx"></g>
      <ellipse class="hit"/>
    </svg>
    <div class="count" aria-live="polite"></div>
  </div>`);
    const $ = (s2) => root.querySelector(s2);
    const box = $(".box");
    const svg = $(".sl");
    const frost = $(".frost");
    const body = $(".body");
    const reachC = $(".reach");
    const satsG = $(".sats");
    const pearlsG = $(".pearls");
    const face = $(".face");
    const eyeL = $(".eyeL");
    const eyeR = $(".eyeR");
    const eyes = [...root.querySelectorAll(".eye")];
    const lids = [...root.querySelectorAll(".lid")];
    const light = $(".light");
    const hit = $(".hit");
    const ringT = $(".prog-t");
    const ring = $(".prog");
    const fx = $(".fx");
    const countEl = $(".count");
    const actions = createActions(root, box, store, options.label);
    let frac = 0.56;
    const anchor = new Spring(frac * innerHeight, { stiffness: 300, damping: 32 });
    const bx = new Spring(HX, { stiffness: 160, damping: 16 });
    const by = new Spring(HY, { stiffness: 160, damping: 16 });
    const sqx = new Spring(1, { stiffness: 300, damping: 18 });
    const sqy = new Spring(1, { stiffness: 300, damping: 18 });
    const reach = new Spring(0, { stiffness: 170, damping: 18 });
    const reachR = new Spring(0, { stiffness: 170, damping: 18 });
    const lookX = new Spring(0, { stiffness: 420, damping: 32 });
    const lookY = new Spring(0, { stiffness: 420, damping: 32 });
    const lid = new Spring(1, { stiffness: 1200, damping: 50 });
    const lidCap = new Spring(1, { stiffness: 50, damping: 12 });
    const widen = new Spring(1, { stiffness: 320, damping: 18 });
    const tilt = new Spring(0, { stiffness: 220, damping: 12 });
    const lxS = new Spring(-0.5, { stiffness: 80, damping: 16 });
    const lyS = new Spring(-0.9, { stiffness: 80, damping: 16 });
    const ringO = new Spring(0, { stiffness: 300, damping: 30 });
    const reveal = new Spring(0, { stiffness: 380, damping: 36 });
    let mood = "idle";
    let moodUntil = 0;
    let nextBlink = performance.now() + 2500;
    let nextIdle = performance.now() + 4e3;
    let pressed = null;
    let dragging = false;
    let panelOpen = false;
    let shown = store.state.staged.length;
    let shiverUntil = 0;
    let lastActive = performance.now();
    let wakeGuard = 0;
    let dozeLevel = 0;
    let breathPh = 0;
    let breathK = 1;
    let scrollImpulse = 0;
    let petDist = 0;
    let petCool = 0;
    let startleCool = 0;
    let peekCool = 0;
    let lastPx = null;
    let lastPy = null;
    let shakeFlips = 0;
    let shakeSign = 0;
    let shakeT = 0;
    let dizzyPending = false;
    let incoming = null;
    let geo = { cx: HX, cy: HY, R: R0, btnY: HY + R0 + 10 };
    let pinUntil = 0;
    let aiPhase = store.state.ai || "idle";
    let aiT0 = performance.now();
    let aiStreamMs = 2800;
    let forming = null;
    let nextPulse = 0;
    let lastInputRect = null;
    const poseX = new Spring(1, { stiffness: 120, damping: 14 });
    const poseY = new Spring(1, { stiffness: 120, damping: 14 });
    const orbitL = new Spring(0, { stiffness: 60, damping: 14 });
    const gaze = { x: 0, y: 0, until: 0, fn: null };
    const sats = [];
    const pearls = [];
    const parts = [];
    const timers = /* @__PURE__ */ new Set();
    const later = (ms, fn) => {
      const id = setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };
    const panel = createPanel(root, store, { onRequestClose: () => closePanel(), openSettings: options.openSettings, label: options.label });
    const setMood = (m, ms) => {
      mood = m;
      moodUntil = performance.now() + ms;
    };
    function baseMood() {
      const st = store.state;
      if (st.phase === "capturing") return "focus";
      if (!st.tracked) return "sleep";
      if (st.phase === "error") return "error";
      return "idle";
    }
    const look = (x, y, ms) => {
      gaze.fn = null;
      gaze.x = x;
      gaze.y = y;
      gaze.until = performance.now() + ms;
    };
    const follow = (fn, ms) => {
      gaze.fn = fn;
      gaze.until = performance.now() + ms;
    };
    const blink = () => {
      lid.set(0);
      later(90, () => lid.set(1));
    };
    const pick = (pool) => {
      const total = pool.reduce((s2, [, w]) => s2 + w, 0);
      let r = Math.random() * total;
      for (const [name, w] of pool) if ((r -= w) <= 0) return name;
      return pool[0][0];
    };
    const acts = {
      // look around: at the chat, up, down at its buttons, toward the edge
      glance() {
        const pts = [[-1, -0.1], [-0.7, -0.7], [0.15, -1], [0, 0.95], [0.8, -0.5], [-0.9, 0.6]];
        const a = pts[Math.floor(Math.random() * pts.length)];
        look(a[0], a[1], 800 + Math.random() * 700);
        if (Math.random() < 0.45) {
          later(1e3, () => {
            const b = pts[Math.floor(Math.random() * pts.length)];
            look(b[0], b[1], 700);
          });
        }
      },
      blink2() {
        blink();
        later(230, blink);
      },
      stretch() {
        setMood("closed", 950);
        sqx.set(0.9);
        sqy.set(1.15);
        later(720, () => {
          sqx.set(1);
          sqy.set(1);
          sqy.kick(-1.5);
          sqx.kick(1.1);
        });
      },
      sigh() {
        sqx.set(1.06);
        sqy.set(0.95);
        lidCap.set(0.55);
        later(1e3, () => {
          sqx.set(1);
          sqy.set(1);
          if (!dozeLevel) lidCap.set(1);
        });
      },
      shift() {
        const s2 = Math.random() > 0.5 ? 1 : -1;
        bx.kick(110 * s2);
        tilt.kick(-70 * s2);
      },
      nod() {
        look(lookX.value * 0.5, 1, 170);
        sqy.kick(-0.8);
        later(180, () => look(lookX.value * 0.5, -0.25, 300));
      },
      shake() {
        [0, 130, 260, 390].forEach(
          (ms, i) => later(ms, () => {
            tilt.kick((i % 2 ? -1 : 1) * 230 * (1 - i * 0.2));
            look(i % 2 ? 0.8 : -0.8, 0.1, 150);
          })
        );
      },
      shiver() {
        shiverUntil = performance.now() + 480;
        widen.set(0.85);
        later(520, () => widen.set(1));
      },
      hop() {
        sqy.set(0.88);
        sqx.set(1.07);
        later(150, () => {
          sqy.set(1);
          sqx.set(1);
          by.kick(-260);
          sqy.kick(1.8);
        });
      },
      // keep an eye on one of its own droplets as it orbits
      watchDroplet() {
        const s2 = sats.find((x) => !x.dying);
        if (!s2) return acts.glance();
        follow(() => ({ x: +s2.el.getAttribute("cx"), y: +s2.el.getAttribute("cy") }), 2300);
      },
      doze() {
        dozeLevel = 1;
        wakeGuard = performance.now() + 1800;
        lidCap.set(0.28);
        breathK = 0.6;
      },
      wake() {
        dozeLevel = 0;
        lidCap.set(1);
        breathK = 1;
        by.kick(-100);
        widen.kick(2.5);
        acts.blink2();
      },
      startle(sign = Math.random() > 0.5 ? 1 : -1) {
        bx.kick(230 * sign);
        sqx.kick(-1.6);
        widen.set(1.3);
        blink();
        later(480, () => widen.set(1));
      },
      dizzy() {
        setMood("closed", 1100);
        [0, 160, 320, 480, 640].forEach((ms, i) => later(ms, () => tilt.kick((i % 2 ? -1 : 1) * 170 * (1 - i * 0.15))));
        later(1150, acts.blink2);
      },
      pet() {
        setMood("content", 1200);
        [0, 150, 300].forEach(
          (ms, i) => later(ms, () => {
            sqx.kick(i % 2 ? -0.9 : 0.9);
            sqy.kick(i % 2 ? 0.9 : -0.9);
          })
        );
      },
      perk() {
        widen.set(1.25);
        sqy.kick(1.3);
        later(750, () => widen.set(1));
      },
      peek() {
        setMood("peek", 900);
      }
    };
    function addSat(angle, rad) {
      const s2 = {
        el: mk2("circle", { class: "sat", r: 6.4 }, satsG),
        a: angle,
        w: (0.35 + Math.random() * 0.25) * (Math.random() > 0.5 ? 1 : -1),
        ph: Math.random() * 6,
        rad: new Spring(rad, { stiffness: 110, damping: 13 }).set(R0 + 15),
        dying: false
      };
      sats.push(s2);
    }
    function syncSats() {
      const want = Math.min(shown, MAX_SATS);
      const alive = sats.filter((s2) => !s2.dying);
      while (alive.length < want) {
        addSat(Math.random() * Math.PI * 2, 0);
        alive.push(sats[sats.length - 1]);
      }
      while (alive.length > want) {
        const s2 = alive.pop();
        s2.dying = true;
        s2.rad.set(0);
      }
    }
    function absorbAll() {
      sats.forEach((s2, i) => {
        s2.dying = true;
        later(i * 40, () => s2.rad.config(170, 22).set(0));
      });
    }
    function syncPearls() {
      const want = store.state.phase === "pushing" ? pearls.length : Math.min(store.ahead, MAX_PEARLS);
      while (pearls.length < want) {
        pearls.push({ el: mk2("circle", { class: "pearl", r: 2.1 }, pearlsG), s: new Spring(0, { stiffness: 380, damping: 32 }).set(1), x: 0, y: 0 });
      }
      while (pearls.length > want) pearls.pop().el.remove();
    }
    function releasePearls() {
      pearls.splice(0).forEach((p, i) => {
        p.el.remove();
        const el = mk2("circle", { class: "rise", r: 2.1, cx: p.x, cy: p.y }, fx);
        parts.push({ el, rise: true, x: p.x, y: p.y, vy: -40, ay: -300, life: -i * 0.05, max: 0.8 });
      });
    }
    function flyIn(delay, start = null) {
      later(delay, () => {
        const far = !!start;
        const el = far ? mk2("circle", { class: "flyd", r: 5.5 }, fx) : mk2("circle", { class: "dropc", r: 6.4 }, $(".goo"));
        const sx = start ? start.x : HX - 150 - Math.random() * 30;
        const sy = start ? start.y : HY - 90 - Math.random() * 30;
        const c = start ? { x: (sx + HX) / 2, y: Math.min(sy, HY) - 90 } : { x: HX - 60, y: HY - 130 };
        parts.push({ el, bez: { x0: sx, y0: sy, cx: c.x, cy: c.y, t: 0, dur: far ? 0.8 : 0.6 } });
      });
    }
    function landed(angle) {
      shown = Math.min(shown + 1, store.state.staged.length);
      addSat(angle, R0 + 2);
      sqx.kick(0.8);
      sqy.kick(-0.8);
    }
    const inputStart = () => lastInputRect && {
      x: lastInputRect.left + Math.min(lastInputRect.width / 2, 80) - (innerWidth - BOX),
      y: lastInputRect.top + lastInputRect.height / 2 - (anchor.value - HY)
    };
    function startForming() {
      if (forming) return;
      forming = { el: mk2("circle", { class: "dropc", r: 0 }, $(".goo")), r: new Spring(0, { stiffness: 60, damping: 9 }), a: Math.PI * 1.08 };
    }
    function detachForming() {
      const f = forming;
      forming = null;
      const full = sats.filter((s2) => !s2.dying).length >= MAX_SATS;
      f.el.setAttribute("class", "sat");
      f.el.setAttribute("r", "6.4");
      sats.push({
        el: f.el,
        a: f.a,
        w: 0.45 * (Math.random() > 0.5 ? 1 : -1),
        ph: Math.random() * 6,
        rad: new Spring(R0 + 2 + f.r.value * 0.7, { stiffness: 90, damping: 11 }).set(full ? 0 : R0 + 15),
        dying: full
      });
      shown = Math.min(shown + 1, store.state.staged.length);
      sqx.kick(-0.9);
      sqy.kick(0.9);
    }
    function dissolveForming() {
      const f = forming;
      forming = null;
      sats.push({ el: f.el, a: f.a, w: 0, ph: 0, rad: new Spring(R0, { stiffness: 120, damping: 16 }).set(0), dying: true });
    }
    function onAi(phase, d) {
      lastActive = performance.now();
      if (!store.state.tracked) {
        aiPhase = "idle";
        return;
      }
      aiT0 = performance.now();
      if (phase === "thinking") {
        aiPhase = "thinking";
        blink();
      } else if (phase === "streaming") {
        aiPhase = "streaming";
        aiStreamMs = d.ms || 2800;
        startForming();
      } else {
        aiPhase = "idle";
        if (forming) dissolveForming();
        later(150, () => {
          blink();
          setMood("content", 600);
        });
      }
    }
    function renderButtons() {
      const st = store.state;
      box.classList.toggle("sending", st.phase === "pushing");
      box.classList.toggle("err", st.phase === "error");
    }
    const unsub = store.subscribe((type, d) => {
      if (type === "staged") {
        d.items.forEach((_, i) => {
          if (d.from === "stream" && forming) detachForming();
          else if (d.from === "input" && lastInputRect) flyIn(i * 200, inputStart());
          else flyIn(i * 200);
        });
      } else if (type === "ai") onAi(d.phase, d);
      else if (type === "committed") {
        shown = 0;
        absorbAll();
        blink();
        sqx.set(0.93);
        sqy.set(0.93);
        later(320, () => {
          sqx.set(1);
          sqy.set(1);
          sqx.kick(1.3);
          sqy.kick(1.3);
          syncPearls();
          setMood("content", 700);
        });
      } else if (type === "pushStart") {
        sqx.set(1.05);
        sqy.set(0.93);
        look(0.6, 0.85, 1500);
      } else if (type === "pushed") {
        sqx.set(1);
        sqy.set(1);
        sqy.kick(1.6);
        by.kick(-140);
        releasePearls();
        follow(() => {
          const r = parts.find((p) => p.rise && p.life >= 0);
          return r ? { x: r.x, y: r.y } : { x: geo.cx, y: geo.cy - 80 };
        }, 900);
        later(800, () => setMood("content", 900));
      } else if (type === "pushEnd") {
        sqx.set(1);
        sqy.set(1);
      } else if (type === "error") {
        sqx.set(1);
        sqy.set(1);
        acts.shiver();
        const at = d?.action === "init" ? () => ({ x: geo.cx, y: geo.btnY + BTN / 2 }) : () => ({ x: geo.cx + BTN / 2 + BTN_GAP / 2, y: geo.btnY + BTN / 2 });
        later(600, () => follow(at, 900));
      } else if (type === "nope") {
        acts.shake();
      } else if (type === "settings") {
        acts.nod();
      } else if (type === "captureStart") {
        acts.perk();
      } else if (type === "captured") {
        shown = 0;
        d.items.slice(0, MAX_SATS + 2).forEach((_, i) => flyIn(120 + i * 110));
        later(120 + (MAX_SATS + 2) * 110 + 700, () => shown = store.state.staged.length);
        setMood("content", 900);
      } else if (type === "reset") {
        shown = store.state.staged.length;
        aiPhase = store.state.ai;
        if (forming) {
          forming.el.remove();
          forming = null;
        }
        sats.splice(0).forEach((s2) => s2.el.remove());
        pearls.splice(0).forEach((p) => p.el.remove());
      }
      if (type !== "committed") syncPearls();
      syncSats();
      renderButtons();
    });
    const onActivity = () => {
      lastActive = performance.now();
      if (dozeLevel && performance.now() > wakeGuard) acts.wake();
    };
    addEventListener("pointermove", onActivity, { capture: true, passive: true });
    const lastScroll = /* @__PURE__ */ new WeakMap();
    const onScroll = (e) => {
      const el = e.target === document ? document.scrollingElement : e.target;
      if (!el || typeof el.scrollTop !== "number") return;
      const prev = lastScroll.has(el) ? lastScroll.get(el) : el.scrollTop;
      const dy = el.scrollTop - prev;
      lastScroll.set(el, el.scrollTop);
      if (!dy) return;
      onActivity();
      wake(900);
      scrollImpulse += -dy * 3.5;
      look(-0.7, dy < 0 ? -0.85 : 0.75, 450);
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    const onKey = (e) => {
      const el = e.composedPath()[0];
      if (!(el instanceof Element) || !el.matches('input, textarea, [contenteditable=""], [contenteditable="true"]')) return;
      onActivity();
      wake(1800);
      const r = el.getBoundingClientRect();
      lastInputRect = r;
      follow(() => {
        const len = (el.value ?? el.textContent ?? "").length;
        return { x: r.left + Math.min(r.width - 20, 30 + len * 8) - (innerWidth - BOX), y: r.top + r.height / 2 - (anchor.value - HY) };
      }, 1500);
      if (e.key === "Enter" && !e.shiftKey) {
        acts.perk();
        later(450, () => look(-1, -0.3, 1600));
      }
    };
    document.addEventListener("keydown", onKey, true);
    hit.addEventListener("pointerdown", (e) => {
      const top = anchor.value - HY;
      pressed = { x: e.clientX, y: e.clientY, gx: e.clientX - (innerWidth - BOX + bx.value), gy: e.clientY - (top + by.value) };
      hit.setPointerCapture(e.pointerId);
      sqx.set(1.05);
      sqy.set(0.93);
    });
    hit.addEventListener("pointermove", (e) => {
      if (!pressed || panelOpen) return;
      if (!dragging && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > 5) {
        dragging = true;
        box.classList.add("drag");
        bx.config(600, 40);
        by.config(600, 40);
        sqx.set(1);
        sqy.set(1);
        shakeFlips = 0;
      }
    });
    const release = () => {
      if (!pressed) return;
      pressed = null;
      sqx.set(1);
      sqy.set(1);
      if (dragging) {
        dragging = false;
        box.classList.remove("drag");
        bx.config(160, 16);
        by.config(160, 16);
        const screenY = anchor.value - HY + by.value;
        const next = clamp(screenY, 60, innerHeight - 60);
        frac = next / innerHeight;
        anchor.snap(next);
        by.value = screenY - (next - HY);
        sqy.kick(-1.4);
        if (dizzyPending) later(120, acts.dizzy);
        dizzyPending = false;
        return;
      }
      if (panelOpen) closePanel();
      else if (noPanel()) {
        pinUntil = performance.now() + 3e3;
        acts.nod();
      } else openPanel();
    };
    hit.addEventListener("pointerup", release);
    hit.addEventListener("pointercancel", release);
    const kb = $(".kb");
    kb.setAttribute("aria-label", options.label?.("widgetName") ?? "gitchat");
    kb.addEventListener("click", () => {
      wake();
      if (panelOpen) closePanel();
      else if (noPanel()) {
        acts.nod();
        actions.focusFirst();
      } else openPanel(true);
    });
    const bodyRect = () => ({ left: innerWidth - BOX + bx.value - R0, top: anchor.value - HY + by.value - R0, width: R0 * 2, height: R0 * 2 });
    function openPanel(focus = false) {
      panelOpen = true;
      panel.open(bodyRect(), { right: BOX - HX + R0 + 14, centerY: anchor.value }, { focus });
    }
    function closePanel() {
      if (!panel.isOpen) return;
      const hadFocus = panel.el.contains(root.activeElement);
      panel.close(bodyRect()).then(() => {
        panelOpen = false;
        if (hadFocus) kb.focus();
      });
    }
    const stop = onFrame((dt, t2) => {
      const st = store.state;
      const now = performance.now();
      anchor.set(clamp(frac * innerHeight, 60, Math.max(60, innerHeight - 60)));
      if (innerHeight > 0 && anchor.value <= 1) anchor.snap();
      anchor.step(dt);
      const top = anchor.value - HY;
      box.style.top = `${top.toFixed(1)}px`;
      const px = pointer.x - (innerWidth - BOX);
      const py = pointer.y - top;
      const dx = px - bx.value;
      const dy = py - by.value;
      const d = Math.hypot(dx, dy);
      const sleeping = !st.tracked && st.phase !== "capturing";
      if (dragging && pressed) {
        bx.set(px - pressed.gx);
        by.set(py - pressed.gy);
        const v = bx.velocity;
        const sg = Math.sign(v);
        if (Math.abs(v) > 350 && sg !== shakeSign) {
          shakeSign = sg;
          if (now - shakeT > 900) shakeFlips = 0;
          shakeFlips++;
          shakeT = now;
          if (shakeFlips >= 5) dizzyPending = true;
        }
      } else if (!panelOpen && pointer.active && !sleeping && dozeLevel < 2) {
        const f = smooth(170, 36, d);
        bx.set(HX + clamp(dx * 0.05 * f, -6, 3));
        by.set(HY + clamp(dy * 0.05 * f, -6, 6));
      } else {
        bx.set(HX);
        by.set(HY);
      }
      if (scrollImpulse) {
        by.kick(clamp(scrollImpulse, -220, 220));
        scrollImpulse = 0;
      }
      bx.step(dt);
      by.step(dt);
      sqx.step(dt);
      sqy.step(dt);
      const thinking = aiPhase === "thinking" && !sleeping;
      const streaming = aiPhase === "streaming" && !sleeping;
      const still = motion.reduced;
      tilt.set(thinking && !still ? Math.sin(t2 * 0.5) * 5 : 0);
      poseX.set(thinking ? 0.97 : 1);
      poseY.set(thinking ? 1.04 : 1);
      poseX.step(dt);
      poseY.step(dt);
      tilt.step(dt);
      widen.step(dt);
      lidCap.step(dt);
      breathPh += dt * (sleeping ? 1.1 : 1.8) * breathK;
      const breath = still ? 0 : Math.sin(breathPh) * (sleeping || dozeLevel ? 0.022 : 0.012);
      const vx = bx.velocity;
      const vy = by.velocity;
      const stretch = Math.min(0.16, Math.hypot(vx, vy) * 5e-4);
      const ang = Math.atan2(vy, vx) * 180 / Math.PI;
      const R2 = R0 * (sleeping ? 0.94 : 1);
      const rx = R2 * sqx.value * poseX.value * (1 + breath) * (1 + stretch);
      const ry = R2 * sqy.value * poseY.value * (1 - breath) * (1 - stretch * 0.6);
      const jitter = now < shiverUntil ? Math.sin(now / 13) * 1.4 : 0;
      const cx = bx.value + jitter;
      const cy = by.value + (1 - sqy.value) * R2 * 0.5;
      body.setAttribute("cx", cx.toFixed(2));
      body.setAttribute("cy", cy.toFixed(2));
      body.setAttribute("rx", Math.max(4, rx).toFixed(2));
      body.setAttribute("ry", Math.max(4, ry).toFixed(2));
      body.setAttribute("transform", `rotate(${(ang + tilt.value * 0.5).toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)})`);
      hit.setAttribute("cx", cx.toFixed(1));
      hit.setAttribute("cy", cy.toFixed(1));
      hit.setAttribute("rx", (R2 + 4).toFixed(1));
      hit.setAttribute("ry", (R2 + 4).toFixed(1));
      frost.style.width = `${(rx * 2).toFixed(1)}px`;
      frost.style.height = `${(ry * 2).toFixed(1)}px`;
      frost.style.transform = `translate(${(cx - rx).toFixed(1)}px, ${(cy - ry).toFixed(1)}px) rotate(${ang.toFixed(1)}deg)`;
      const btnY = cy + R2 + 10;
      geo = { cx, cy, R: R2, btnY };
      const onBody = d < R2 + 6;
      const onBtns = reveal.value > 0.2 && actions.covers(px, py);
      const hovered = pointer.active && !panelOpen && !dragging && (onBody || onBtns);
      reveal.set(hovered || now < pinUntil || st.phase === "capturing" || actions.focused && !panelOpen ? 1 : 0);
      reveal.step(dt);
      const buttonsMoving = actions.frame(dt, { reveal: reveal.value, x: cx, y: btnY, dir: "row" });
      if (st.phase === "capturing") {
        const txt = st.captureStage === "reading" ? `${Math.round((st.progress - 0.25) / 0.75 * 100)}%` : `\u2191 ${st.captureCount ?? 0}`;
        if (countEl.textContent !== txt) countEl.textContent = txt;
        countEl.style.opacity = "1";
        countEl.style.transform = `translate(${cx.toFixed(1)}px, ${(btnY + BTN + 8).toFixed(1)}px) translateX(-50%)`;
      } else if (countEl.style.opacity !== "0") countEl.style.opacity = "0";
      if (lastPx !== null && dt > 0 && pointer.active) {
        const mv = Math.hypot(px - lastPx, py - lastPy);
        const speed = mv / dt;
        if (!still && !sleeping && !panelOpen && !dragging && !pressed && speed > 2200 && d < 120 && d > R2 && now > startleCool) {
          acts.startle(dx > 0 ? -1 : 1);
          startleCool = now + 3e3;
        }
        if (onBody && !pressed && !dragging) petDist += mv;
      }
      lastPx = px;
      lastPy = py;
      petDist *= Math.exp(-dt * 1.6);
      if (petDist > 170 && now > petCool && !sleeping) {
        acts.pet();
        petCool = now + 2500;
        petDist = 0;
      }
      if (sleeping && onBody && pointer.active && now > peekCool) {
        acts.peek();
        peekCool = now + 4e3;
      }
      const prox = pointer.active && !panelOpen && !dragging && !sleeping && !dozeLevel && d > R2 ? smooth(160, R2 + 10, d) : 0;
      reach.set(prox * clamp(d - R2 * 0.4, 0, 24));
      reachR.set(prox * 8);
      reach.step(dt);
      reachR.step(dt);
      const ux = dx / (d || 1);
      const uy = dy / (d || 1);
      reachC.setAttribute("cx", (cx + ux * (R2 * 0.4 + reach.value)).toFixed(2));
      reachC.setAttribute("cy", (cy + uy * (R2 * 0.4 + reach.value)).toFixed(2));
      reachC.setAttribute("r", Math.max(0, reachR.value).toFixed(2));
      const near = pointer.active && d < 480;
      lxS.set(near ? ux : -0.5);
      lyS.set(near ? uy : -0.9);
      lxS.step(dt);
      lyS.step(dt);
      orbitL.set(thinking && !still ? 1 : 0);
      orbitL.step(dt);
      const ok = clamp(orbitL.value, 0, 1);
      const la = t2 * 2.4;
      light.setAttribute("x", lerp(cx + lxS.value * 60, cx + Math.cos(la) * 44, ok).toFixed(1));
      light.setAttribute("y", lerp(cy + lyS.value * 60 - 24, cy + Math.sin(la) * 44, ok).toFixed(1));
      light.setAttribute("z", lerp(140, 64, ok).toFixed(1));
      for (let i = sats.length - 1; i >= 0; i--) {
        const s2 = sats[i];
        s2.rad.step(dt);
        if (s2.dying && s2.rad.value < 3) {
          s2.el.remove();
          sats.splice(i, 1);
          continue;
        }
        if (!still) s2.a += dt * s2.w;
        const r = Math.max(0, s2.rad.value + (still ? 0 : Math.sin(t2 * 1.9 + s2.ph) * 3.5));
        s2.el.setAttribute("cx", (cx + Math.cos(s2.a) * r).toFixed(2));
        s2.el.setAttribute("cy", (cy + Math.sin(s2.a) * r * 0.9).toFixed(2));
      }
      if (forming) {
        if (streaming) {
          const el = now - aiT0;
          forming.r.set(2 + 5.6 * (1 - Math.exp(-el / (aiStreamMs * 0.45))));
          if (now > nextPulse && !still) {
            forming.r.kick(5);
            sqx.kick(0.22);
            nextPulse = now + 360 + Math.random() * 280;
          }
        }
        forming.r.step(dt);
        const a = forming.a + Math.sin(t2 * 2.3) * 0.05;
        const dist = R2 + 2 + forming.r.value * 0.7;
        forming.el.setAttribute("cx", (cx + Math.cos(a) * dist).toFixed(2));
        forming.el.setAttribute("cy", (cy + Math.sin(a) * dist * 0.95).toFixed(2));
        forming.el.setAttribute("r", Math.max(0, forming.r.value).toFixed(2));
      }
      pearls.forEach((p, i) => {
        p.s.step(dt);
        const a = (66 - i * 17) * Math.PI / 180;
        const rr = R2 * 0.7 + (still ? 0 : Math.sin(t2 * 1.4 + i * 0.8) * 0.3);
        p.x = cx + Math.cos(a) * rr * (rx / R2);
        p.y = cy + Math.sin(a) * rr * (ry / R2);
        const k = clamp(p.s.value, 0, 1);
        p.el.setAttribute("cx", p.x.toFixed(2));
        p.el.setAttribute("cy", p.y.toFixed(2));
        p.el.setAttribute("r", (1.85 * (0.6 + 0.4 * k)).toFixed(2));
        p.el.setAttribute("opacity", k.toFixed(3));
      });
      ringO.set(st.phase === "capturing" ? 1 : 0);
      ringO.step(dt);
      for (const c of [ringT, ring]) {
        c.setAttribute("cx", cx.toFixed(1));
        c.setAttribute("cy", cy.toFixed(1));
        c.setAttribute("r", (R2 + 12).toFixed(1));
      }
      ring.setAttribute("stroke-dashoffset", String(1 - st.progress));
      ring.setAttribute("transform", `rotate(-90 ${cx.toFixed(1)} ${cy.toFixed(1)})`);
      $(".ringg").setAttribute("opacity", clamp(ringO.value, 0, 1).toFixed(3));
      const idleFor = now - lastActive;
      if (st.tracked && !panelOpen && !dragging && st.phase === "idle" && aiPhase === "idle") {
        if (dozeLevel === 0 && idleFor > 2e4) acts.doze();
        else if (dozeLevel === 1 && idleFor > 45e3) {
          dozeLevel = 2;
          lidCap.set(0);
          breathK = 0.5;
        }
      }
      if (moodUntil && now > moodUntil) moodUntil = 0;
      if (now > nextIdle) {
        const calm = !panelOpen && !dragging && !pressed && !moodUntil && !incoming && aiPhase === "idle" && gaze.until < now && (!pointer.active || d > 220);
        if (still) {
        } else if (calm && st.tracked && st.phase === "idle" && !dozeLevel) {
          acts[pick([["glance", 34], ["blink2", 14], ["sigh", 10], ["shift", 10], ["stretch", 7], ["watchDroplet", sats.length ? 16 : 0], ["hop", 3]])]();
        } else if (calm && sleeping && Math.random() < 0.5) acts.sigh();
        nextIdle = now + 3500 + Math.random() * 5e3;
      }
      const m = pressed && !dragging ? "content" : moodUntil ? mood : baseMood();
      svg.classList.toggle("sleep", sleeping);
      svg.classList.toggle("err", st.phase === "error");
      const toward = (x, y) => {
        const ddx = x - cx;
        const ddy = y - cy;
        const dd = Math.hypot(ddx, ddy) || 1;
        const k = Math.min(1, dd / 90);
        return [ddx / dd * k, ddy / dd * k];
      };
      let lxT = 0;
      let lyT = 0;
      if (m === "focus") {
        const p = st.progress;
        if (p < 0.25) {
          lxT = -0.3;
          lyT = -1;
        } else {
          const ph = now % 760 / 760;
          lxT = ph < 0.8 ? -0.95 + ph * 0.9 : -0.95;
          lyT = -0.4 + (p - 0.25) / 0.75 * 1.2;
        }
      } else if (incoming) [lxT, lyT] = toward(incoming.x, incoming.y);
      else if (gaze.until > now) {
        if (gaze.fn) [lxT, lyT] = toward(gaze.fn().x, gaze.fn().y);
        else {
          lxT = gaze.x;
          lyT = gaze.y;
        }
      } else if (thinking) {
        lxT = 0.45 + (still ? 0 : Math.sin(t2 * 0.6) * 0.35);
        lyT = -0.8 + (still ? 0 : Math.sin(t2 * 1.1) * 0.12);
      } else if (streaming && !still) {
        const ph = now % 700 / 700;
        lxT = ph < 0.8 ? -0.95 + ph * 0.75 : -0.95;
        lyT = -0.3 + (now - aiT0) % 2600 / 2600 * 0.7;
      } else if (!sleeping && dozeLevel < 2 && pointer.active && (panelOpen || d < 640)) {
        const k = Math.min(1, d / 110);
        lxT = ux * k;
        lyT = uy * k;
      }
      lookX.set(lxT);
      lookY.set(lyT);
      lookX.step(dt);
      lookY.step(dt);
      if (now > nextBlink && !sleeping && m === "idle" && dozeLevel < 2) {
        blink();
        if (Math.random() < 0.2) later(260, blink);
        nextBlink = now + 2800 + Math.random() * 3600;
      }
      lid.step(dt);
      let h2 = 1;
      if (m === "content") h2 = 0.3;
      else if (m === "error") h2 = 0.45;
      else if (m === "focus") h2 = 1.1;
      else if (m === "peek") h2 = 0.35;
      else if (m === "sleep" || m === "closed") h2 = 0;
      if (m === "idle" || m === "content") h2 *= clamp(lidCap.value, 0, 1);
      if (thinking && now - aiT0 > 5e3 && m === "idle") h2 *= 0.6;
      const open = clamp(lid.value, 0, 1) * h2;
      const wv = clamp(widen.value, 0.6, 1.5);
      const ex = 7.5;
      face.setAttribute("transform", `translate(${(cx + lookX.value * 4.5).toFixed(2)} ${(cy - 5 + lookY.value * 3.5).toFixed(2)}) rotate(${tilt.value.toFixed(2)})`);
      eyeL.setAttribute("transform", `translate(${-ex} 0)`);
      eyeR.setAttribute("transform", `translate(${ex} 0)`);
      eyes.forEach((el) => {
        const hh = Math.max(0.01, 7.6 * open * wv);
        const ww = 3.2 * wv;
        el.setAttribute("height", hh.toFixed(2));
        el.setAttribute("y", (-hh / 2).toFixed(2));
        el.setAttribute("width", ww.toFixed(2));
        el.setAttribute("x", (-ww / 2).toFixed(2));
        el.setAttribute("rx", Math.min(ww / 2, hh / 2).toFixed(2));
        el.style.display = open < 0.08 ? "none" : "";
      });
      lids.forEach((el) => el.style.display = open < 0.08 ? "" : "none");
      let nextIncoming = null;
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (p.bez) {
          const z = p.bez;
          z.t = Math.min(1, z.t + dt / z.dur);
          const u = 1 - (1 - z.t) * (1 - z.t);
          const a2 = Math.atan2(z.y0 - cy, z.x0 - cx);
          const ex2 = cx + Math.cos(a2) * (R2 + 6);
          const ey2 = cy + Math.sin(a2) * (R2 + 6);
          const x = (1 - u) * (1 - u) * z.x0 + 2 * (1 - u) * u * z.cx + u * u * ex2;
          const y = (1 - u) * (1 - u) * z.y0 + 2 * (1 - u) * u * z.cy + u * u * ey2;
          if (z.t >= 1) {
            p.el.remove();
            parts.splice(i, 1);
            if (sats.filter((s2) => !s2.dying).length < MAX_SATS) landed(a2);
            else shown = Math.min(shown + 1, store.state.staged.length);
            continue;
          }
          if (!nextIncoming) nextIncoming = { x, y };
          p.el.setAttribute("cx", x.toFixed(1));
          p.el.setAttribute("cy", y.toFixed(1));
          continue;
        }
        p.life += dt;
        if (p.life < 0) continue;
        p.vy += p.ay * dt;
        p.y += p.vy * dt;
        const k = p.life / p.max;
        if (k >= 1) {
          p.el.remove();
          parts.splice(i, 1);
          continue;
        }
        p.el.setAttribute("cy", p.y.toFixed(1));
        p.el.setAttribute("opacity", (1 - k).toFixed(3));
      }
      incoming = nextIncoming;
      const engaged = dragging || pressed || panelOpen || st.phase === "capturing" || parts.length || forming || incoming || now < shiverUntil || now < pinUntil || buttonsMoving || (thinking || streaming) && !still || moving([anchor, bx, by, sqx, sqy, reach, reachR, tilt, ringO, reveal, poseX, poseY, orbitL], 0.01) || sats.some((x) => moving([x.rad], 0.05)) || pearls.some((x) => moving([x.s]));
      if (engaged) return FULL;
      if (still) return moving([lookX, lookY, lid, lidCap, widen], 0.01) ? 24 : 2;
      return sleeping || dozeLevel === 2 ? 10 : dozeLevel ? 16 : 24;
    });
    syncSats();
    syncPearls();
    renderButtons();
    return {
      // play one behavior by name (used by the demo menu)
      act(name) {
        if (name === "doze") lastActive = performance.now() - 21e3;
        acts[name]?.();
      },
      destroy() {
        stop();
        unsub();
        actions.destroy();
        panel.destroy();
        timers.forEach((id) => clearTimeout(id));
        removeEventListener("pointermove", onActivity, { capture: true });
        document.removeEventListener("scroll", onScroll, { capture: true });
        document.removeEventListener("keydown", onKey, true);
      }
    };
  }

  // src/content/ui/variants/dot.js
  var S = 40;
  var R = S / 2;
  var EDGE = 18;
  var RING = 13.5;
  var STEP = 24;
  var NS4 = "http://www.w3.org/2000/svg";
  var mk3 = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS4, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  var css2 = `
.dock { position: fixed; right: ${EDGE}px; top: 0; width: ${S}px; height: ${S}px; }
.orb { position: absolute; inset: 0; --r: 50%; border-radius: 50%; cursor: pointer; touch-action: none; }
.orb.dragging { cursor: grabbing; }
.orb .in { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.trk { fill: none; stroke: var(--ink-4); stroke-width: 1; }
.orb[data-s="untracked"] .trk { stroke: var(--ink-3); stroke-dasharray: 1.2 2.4; }
.orb[data-s="error"] .trk { stroke: var(--err); }
.arc { fill: none; stroke: var(--accent); stroke-width: 1.4; stroke-linecap: round; opacity: 0; transition: opacity .2s; }
.orb[data-s="capturing"] .arc { opacity: 1; }
.orb[data-s="pushing"] .arc { opacity: 1; stroke-dasharray: .16 .84; stroke-dashoffset: 0;
  transform-box: fill-box; transform-origin: center; animation: spin .9s linear infinite; }
.tick { fill: var(--accent); }
.num { font: 600 11.5px/1 var(--mono); fill: var(--ink); text-anchor: middle; dominant-baseline: central;
  font-variant-numeric: tabular-nums; transition: opacity .15s; }
.cdot { fill: var(--ink-3); transition: opacity .2s; }
.orb:not([data-s="clean"]):not([data-s="ahead"]):not([data-s="pushing"]) .cdot { opacity: 0; }
.orb[data-s="untracked"] .num, .orb[data-s="error"] .num { opacity: 0; }
.orb[data-s="capturing"] .num { font-size: 9px; fill: var(--accent); }
.gl { opacity: 0; transition: opacity .2s; }
.gl-init { color: var(--ink-2); }
.gl-up { color: var(--accent); }
.gl-err { color: var(--err); }
.orb[data-s="untracked"] .gl-init, .orb[data-s="error"] .gl-err { opacity: 1; }
@keyframes spin { to { transform: rotate(360deg); } }
`;
  function mountDot(host, store, options = {}) {
    const noPanel = () => !store.state.tracked && store.state.phase !== "error" || store.state.phase === "capturing";
    const root = host.attachShadow({ mode: "open" });
    setHTML(root, `<style>${glassCSS}${panelCSS}${actionsCSS}${css2}</style>
  <div class="dock">
    <div class="orb lg" role="button" tabindex="0">
      <div class="lg-b"></div>
      <svg class="in" viewBox="${-R} ${-R} ${S} ${S}">
        <circle class="trk" r="${RING}"/>
        <g transform="rotate(-90)"><circle class="arc" r="${RING}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></g>
        <g class="ticks"></g>
        <circle class="cdot" r="1.5"/>
        <text class="num" y=".5"></text>
        <g class="gl gl-init">${nestedIcon("init", 14, -7, -7, 1.8)}</g>
        <g class="gl gl-up">${nestedIcon("up", 12, -6, -6, 2)}</g>
        <g class="gl gl-err"><path d="M0-4.2V1.2M0 4.2v.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></g>
      </svg>
      <div class="lg-h"></div>
    </div>
  </div>`);
    const $ = (s2) => root.querySelector(s2);
    const dock = $(".dock");
    const actions = createActions(root, dock, store, options.label);
    let pinUntil = 0;
    const orb = $(".orb");
    orb.setAttribute("aria-label", options.label?.("widgetName") ?? "gitchat");
    const arc = $(".arc");
    const num = $(".num");
    const ticksG = $(".ticks");
    applyLens(root, $(".orb > .lg-b"), { w: S, h: S, r: R, bezel: 10, scale: 18, blur: 0.6, sat: 1.3 });
    const ox = new Spring(0, { stiffness: 320, damping: 34 });
    const oy = new Spring(0, { stiffness: 320, damping: 34 });
    const sc = new Spring(0, { stiffness: 520, damping: 44 }).set(1);
    const reveal = new Spring(0, { stiffness: 380, damping: 36 });
    const lx = new Spring(-0.6, { stiffness: 90, damping: 18 });
    const ly = new Spring(-0.8, { stiffness: 90, damping: 18 });
    let frac = 0.56;
    let anchorY = 0;
    const syncAnchor = () => anchorY = clamp(frac * innerHeight, R + 14, Math.max(R + 14, innerHeight - R - 14));
    syncAnchor();
    let pressed = false;
    let dragging = false;
    let down = null;
    let grab = { x: 0, y: 0 };
    let panelOpen = false;
    const ticks = [];
    const panel = createPanel(root, store, { onRequestClose: () => closePanel(), openSettings: options.openSettings, label: options.label });
    const orbRect = () => ({ left: innerWidth - EDGE - S, top: anchorY - R, width: S, height: S });
    function stateName() {
      const st = store.state;
      if (st.phase === "capturing") return "capturing";
      if (!st.tracked) return "untracked";
      if (st.phase === "error") return "error";
      if (st.phase === "pushing") return "pushing";
      if (st.staged.length) return "dirty";
      if (store.ahead) return "ahead";
      return "clean";
    }
    function syncTicks() {
      const want = store.state.phase === "pushing" ? ticks.filter((t2) => !t2.dying).length : Math.min(store.ahead, 9);
      const alive = ticks.filter((t2) => !t2.dying);
      while (alive.length < want) {
        const t2 = { el: mk3("circle", { class: "tick", r: 1.8 }, ticksG), a: new Spring(-90, { stiffness: 260, damping: 30 }), o: new Spring(0, { stiffness: 400, damping: 40 }).set(1), dying: false };
        ticks.push(t2);
        alive.push(t2);
      }
      while (alive.length > want) {
        const t2 = alive.pop();
        t2.dying = true;
        t2.o.set(0);
      }
      alive.forEach((t2, i) => t2.a.set(-90 + (alive.length - 1 - i) * STEP));
    }
    function collectTicks() {
      ticks.forEach((t2, i) => {
        t2.dying = true;
        t2.a.set(-90);
        setTimeout(() => t2.o.set(0), 120 + i * 30);
      });
    }
    function render() {
      const st = store.state;
      orb.dataset.s = stateName();
      arc.setAttribute("stroke-dashoffset", st.phase === "capturing" ? String(1 - st.progress) : "0");
      const capText = st.captureStage === "reading" ? String(Math.round((st.progress - 0.25) / 0.75 * 100)) : String(st.captureCount ?? 0);
      rollText(num, st.phase === "capturing" ? capText : st.tracked && st.staged.length ? String(st.staged.length) : "");
      syncTicks();
    }
    const unsub = store.subscribe((type) => {
      if (type === "pushed") collectTicks();
      render();
    });
    orb.addEventListener("pointerdown", (e) => {
      pressed = true;
      down = { x: e.clientX, y: e.clientY };
      grab = { x: e.clientX - (innerWidth - EDGE - R + ox.value), y: e.clientY - (anchorY + oy.value) };
      orb.setPointerCapture(e.pointerId);
    });
    orb.addEventListener("pointermove", (e) => {
      if (!pressed || dragging || panelOpen) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) {
        dragging = true;
        orb.classList.add("dragging");
        ox.config(900, 60);
        oy.config(900, 60);
      }
    });
    const release = () => {
      if (!pressed) return;
      pressed = false;
      if (dragging) {
        dragging = false;
        orb.classList.remove("dragging");
        ox.config(320, 34);
        oy.config(320, 34);
        const visual = anchorY + oy.value;
        const next = clamp(visual, R + 14, innerHeight - R - 14);
        oy.value = visual - next;
        oy.target = 0;
        frac = next / innerHeight;
        syncAnchor();
      } else if (panelOpen) closePanel();
      else if (noPanel()) pinUntil = performance.now() + 3e3;
      else openPanel();
    };
    orb.addEventListener("pointerup", release);
    orb.addEventListener("pointercancel", release);
    orb.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      wake();
      if (panelOpen) closePanel();
      else if (noPanel()) actions.focusFirst();
      else openPanel(true);
    });
    function openPanel(focus = false) {
      panelOpen = true;
      sc.set(0);
      panel.open(orbRect(), { right: EDGE - 2, centerY: anchorY }, { focus });
    }
    function closePanel() {
      if (!panel.isOpen) return;
      const hadFocus = panel.el.contains(root.activeElement);
      panel.close(orbRect()).then(() => {
        panelOpen = false;
        sc.set(1);
        if (hadFocus) orb.focus();
      });
    }
    const stop = onFrame((dt) => {
      syncAnchor();
      const cx = innerWidth - EDGE - R;
      const cy = anchorY;
      dock.style.top = `${(cy - R).toFixed(1)}px`;
      const dx = pointer.x - (cx + ox.value);
      const dy = pointer.y - (cy + oy.value);
      const d = Math.hypot(dx, dy);
      const hovered = pointer.active && d < R + 2 && !panelOpen;
      const lx0 = pointer.x - (innerWidth - EDGE - S);
      const ly0 = pointer.y - (cy - R);
      const onBtns = reveal.value > 0.2 && actions.covers(lx0, ly0);
      reveal.set((hovered || onBtns || performance.now() < pinUntil || store.state.phase === "capturing" || actions.focused) && !panelOpen && !dragging ? 1 : 0);
      reveal.step(dt);
      const buttonsMoving = actions.frame(dt, { reveal: reveal.value, x: R, y: S + 8, dir: "column" });
      if (dragging) {
        ox.set(pointer.x - grab.x - cx);
        oy.set(pointer.y - grab.y - cy);
      } else if (!panelOpen && pointer.active) {
        const f = smooth(110, 20, d);
        ox.set(clamp(dx * 0.06 * f, -3, 3));
        oy.set(clamp(dy * 0.06 * f, -3, 3));
      } else {
        ox.set(0);
        oy.set(0);
      }
      ox.step(dt);
      oy.step(dt);
      sc.set(panelOpen ? 0 : pressed && !dragging ? 0.94 : hovered ? 1.06 : 1);
      sc.step(dt);
      orb.style.transform = `translate(${ox.value.toFixed(2)}px, ${oy.value.toFixed(2)}px) scale(${Math.max(0, sc.value).toFixed(3)})`;
      const near = pointer.active && d < 360;
      lx.set(near ? dx / (d || 1) : -0.6);
      ly.set(near ? dy / (d || 1) : -0.8);
      lx.step(dt);
      ly.step(dt);
      setLight(orb, lx.value, ly.value);
      for (let i = ticks.length - 1; i >= 0; i--) {
        const t2 = ticks[i];
        t2.a.step(dt);
        t2.o.step(dt);
        if (t2.dying && t2.o.value < 0.02) {
          t2.el.remove();
          ticks.splice(i, 1);
          continue;
        }
        const a = t2.a.value * Math.PI / 180;
        t2.el.setAttribute("cx", (Math.cos(a) * RING).toFixed(2));
        t2.el.setAttribute("cy", (Math.sin(a) * RING).toFixed(2));
        t2.el.setAttribute("opacity", clamp(t2.o.value, 0, 1).toFixed(3));
      }
      const busy = dragging || buttonsMoving || performance.now() < pinUntil || moving([ox, oy, sc, reveal, lx, ly]) || ticks.some((x) => moving([x.a, x.o]));
      return busy ? FULL : 0;
    });
    render();
    return {
      destroy() {
        stop();
        unsub();
        actions.destroy();
        panel.destroy();
      }
    };
  }

  // src/content/ui/variants/line.js
  var BW = 150;
  var BH = 420;
  var MARGIN = 7;
  var MAXR = 9;
  var W_C = 8;
  var W_E = 24;
  var G_C = 11;
  var G_E = 20;
  var NS5 = "http://www.w3.org/2000/svg";
  var mk4 = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS5, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  var css3 = `
.box { position: fixed; right: 0; top: 0; width: ${BW}px; height: ${BH}px; pointer-events: none; }
.cap { position: absolute; right: ${MARGIN}px; top: 0; width: ${W_C}px; height: 40px; cursor: pointer; pointer-events: auto; touch-action: none; }
.box.drag .cap { cursor: grabbing; }
.cap:focus-visible { outline: 1.5px solid var(--accent); outline-offset: 3px; }
.cap > .lg-b { -webkit-backdrop-filter: blur(8px) saturate(1.4); backdrop-filter: blur(8px) saturate(1.4); }
.untracked .cap > .lg-h { box-shadow: inset 0 0 0 .5px var(--ink-3), 0 1px 2px var(--shadow); }
.marks { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.wk { fill: none; stroke: var(--ink); stroke-width: 1.1; }
.bd.empty .wk { stroke: var(--ink-3); }
.dt { fill: var(--dot); transition: fill .2s; }
.bd.ahead .dt { fill: var(--accent); }
.origin { stroke: var(--ink-3); stroke-width: 1; stroke-linecap: round; }
.sending .origin { stroke: var(--accent); }
.err .origin { stroke: var(--err); }
.prog { stroke: var(--accent); stroke-width: 1.4; stroke-linecap: round; }
.initg { color: var(--ink-2); }
.tip { position: absolute; top: 0; right: 0; height: 22px; padding: 0 8px; display: flex; align-items: center; gap: 6px;
  --r: 7px; border-radius: 7px; color: var(--ink); white-space: nowrap; pointer-events: none;
  opacity: 0; transform: translateX(4px); transition: opacity .15s, transform .25s var(--spring); }
.tip.on { opacity: 1; transform: none; }
.tip > .lg-b { background: var(--tint-strong); }
.tip .t { position: relative; display: flex; align-items: center; gap: 6px; font: 500 11px/1 var(--mono); font-variant-numeric: tabular-nums; }
.tip svg.i { width: 12px; height: 12px; stroke-width: 1.8; }
.tip .mu { color: var(--ink-3); }
.tip .a { color: var(--accent); display: flex; }
`;
  function mountLine(host, store, options = {}) {
    const noPanel = () => !store.state.tracked && store.state.phase !== "error" || store.state.phase === "capturing";
    const root = host.attachShadow({ mode: "open" });
    setHTML(root, `<style>${glassCSS}${panelCSS}${actionsCSS}${css3}</style>
  <div class="box">
    <div class="cap lg" role="button" tabindex="0"><div class="lg-b"></div><div class="lg-h"></div></div>
    <svg class="marks" viewBox="0 0 ${BW} ${BH}">
      <line class="prog"/>
      <line class="origin"/>
      <g class="beads"></g>
      <g class="initg">${nestedIcon("init", 12, -6, -6, 1.8)}</g>
    </svg>
    <div class="tip lg"><div class="lg-b"></div><div class="lg-h"></div><span class="t"></span></div>
  </div>`);
    const $ = (s2) => root.querySelector(s2);
    const box = $(".box");
    const cap = $(".cap");
    const beadsG = $(".beads");
    const origin = $(".origin");
    const prog = $(".prog");
    const initg = $(".initg");
    const tip = $(".tip");
    const tipT = $(".tip .t");
    const actions = createActions(root, box, store, options.label);
    let pinUntil = 0;
    let frac = 0.5;
    const cY = new Spring(frac * innerHeight, { stiffness: 420, damping: 40 });
    const exp = new Spring(0, { stiffness: 380, damping: 36 });
    const fy = new Spring(BH / 2, { stiffness: 500, damping: 45 });
    const len = new Spring(40, { stiffness: 320, damping: 34 });
    const originY = new Spring(BH / 2, { stiffness: 260, damping: 32 });
    const originO = new Spring(0, { stiffness: 400, damping: 40 });
    const lx = new Spring(-0.6, { stiffness: 90, damping: 18 });
    const ly = new Spring(-0.8, { stiffness: 90, damping: 18 });
    let pressed = null;
    let dragging = false;
    let panelOpen = false;
    let target = null;
    let geo = null;
    let snapNext = true;
    const beads = /* @__PURE__ */ new Map();
    const panel = createPanel(root, store, { onRequestClose: () => closePanel(), openSettings: options.openSettings, label: options.label });
    const rows = () => {
      const st = store.state;
      if (!st.tracked) return [];
      const cs = st.commits.slice(0, MAXR).reverse().map((c) => ({ id: c.id, type: "commit", c }));
      return [...cs, { id: "work", type: "work" }];
    };
    function sync(spawnY = null) {
      const rs = rows();
      const keep = /* @__PURE__ */ new Set();
      rs.forEach((r, i) => {
        let b = beads.get(r.id);
        if (!b) {
          const g = mk4("g", { class: `bd ${r.type}` }, beadsG);
          const shape = r.type === "work" ? mk4("circle", { class: "wk", r: 2.6 }, g) : mk4("circle", { class: "dt", r: 2 }, g);
          b = {
            id: r.id,
            r,
            g,
            shape,
            idx: i,
            y: new Spring(spawnY ?? (geo ? beadY(i) : 0), { stiffness: 380, damping: 38 }),
            o: new Spring(0, { stiffness: 400, damping: 40 }).set(1),
            dead: false,
            pv: r.c?.pushed
          };
          if (r.type === "commit") g.classList.toggle("ahead", !b.pv);
          beads.set(r.id, b);
        }
        b.r = r;
        b.idx = i;
        b.dead = false;
        keep.add(r.id);
      });
      for (const b of beads.values()) {
        if (!keep.has(b.id) && !b.dead) {
          b.dead = true;
          b.o.set(0);
        }
      }
      const st = store.state;
      originO.set(st.tracked && st.commits.some((c) => c.pushed) ? 1 : 0);
      const w = beads.get("work");
      if (w) w.g.classList.toggle("empty", !st.staged.length);
      box.classList.toggle("untracked", !st.tracked);
      box.classList.toggle("sending", st.phase === "pushing");
      box.classList.toggle("err", st.phase === "error");
    }
    const beadY = (i) => geo.y0 + geo.pad + i * geo.gap;
    const unsub = store.subscribe((type, d) => {
      if (type === "committed") {
        const w = beads.get("work");
        sync(w ? w.y.value : null);
      } else if (type === "reset" || type === "captured") {
        snapNext = true;
        sync();
      } else sync();
    });
    cap.addEventListener("pointerdown", (e) => {
      pressed = { y: e.clientY, dy: e.clientY - cY.value };
      cap.setPointerCapture(e.pointerId);
    });
    cap.addEventListener("pointermove", (e) => {
      if (!pressed || panelOpen) return;
      if (!dragging && Math.abs(e.clientY - pressed.y) > 5) {
        dragging = true;
        box.classList.add("drag");
      }
      if (dragging) frac = clamp(e.clientY - pressed.dy, 60, innerHeight - 60) / innerHeight;
    });
    const release = () => {
      if (!pressed) return;
      pressed = null;
      if (dragging) {
        dragging = false;
        box.classList.remove("drag");
        return;
      }
      if (panelOpen) return closePanel();
      if (noPanel()) {
        pinUntil = performance.now() + 3e3;
        return;
      }
      if (target?.kind === "work" && store.state.staged.length) store.commit();
      else if (target?.kind === "origin" && store.ahead) store.push();
      else openPanel();
    };
    cap.addEventListener("pointerup", release);
    cap.addEventListener("pointercancel", release);
    cap.setAttribute("aria-label", options.label?.("widgetName") ?? "gitchat");
    cap.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      wake();
      if (panelOpen) closePanel();
      else if (noPanel()) actions.focusFirst();
      else openPanel(true);
    });
    const capRect = () => cap.getBoundingClientRect();
    function openPanel(focus = false) {
      panelOpen = true;
      panel.open(capRect(), { right: MARGIN + W_C + 10, centerY: cY.value }, { focus });
    }
    function closePanel() {
      if (!panel.isOpen) return;
      const r = capRect();
      const hadFocus = panel.el.contains(root.activeElement);
      panel.close({ left: r.left, top: r.top, width: W_C, height: r.height }).then(() => {
        panelOpen = false;
        if (hadFocus) cap.focus();
      });
    }
    function showTip(t2, x) {
      if (!t2) return tip.classList.remove("on");
      const st = store.state;
      let html = "";
      if (t2.kind === "work") html = st.staged.length ? `+${st.staged.length}` : `<span class="mu">0</span>`;
      else if (t2.kind === "origin") html = `<span class="a">${icon.push}</span>${store.ahead}`;
      else if (t2.kind === "commit") html = `+${t2.c.n}<span class="mu">${fmtAgo(t2.c.t)}</span>`;
      else if (t2.kind === "init")
        html = st.phase !== "capturing" ? `<span class="a">${icon.init}</span>` : st.captureStage === "reading" ? `${Math.round((st.progress - 0.25) / 0.75 * 100)}%` : `<span class="a">${icon.up}</span>${st.captureCount ?? 0}`;
      if (tipT.innerHTML !== html) setHTML(tipT, html);
      tip.style.right = `${(BW - x + 8).toFixed(1)}px`;
      tip.style.top = `${(t2.y - 11).toFixed(1)}px`;
      tip.classList.add("on");
    }
    const stop = onFrame((dt) => {
      const st = store.state;
      cY.set(clamp(frac * innerHeight, 60, Math.max(60, innerHeight - 60)));
      if (snapNext) cY.snap();
      cY.step(dt);
      const top = cY.value - BH / 2;
      box.style.top = `${top.toFixed(1)}px`;
      const px = pointer.x - (innerWidth - BW);
      const py = pointer.y - top;
      exp.step(dt);
      const e = clamp(exp.value, 0, 1);
      const w = lerp(W_C, W_E, e);
      const gap = lerp(G_C, G_E, e);
      const capturing = st.phase === "capturing";
      const rs = rows();
      const n = capturing ? 6 : Math.max(1, rs.length);
      const pad = Math.max(w / 2, 7);
      len.set(st.tracked || capturing ? 2 * pad + (n - 1) * gap : 2 * pad + gap);
      if (snapNext) len.snap();
      len.step(dt);
      const L = len.value;
      const y0 = BH / 2 - L / 2;
      const cx = BW - MARGIN - w / 2;
      geo = { y0, gap, pad, cx, w };
      cap.style.width = `${w.toFixed(2)}px`;
      cap.style.height = `${L.toFixed(2)}px`;
      cap.style.top = `${y0.toFixed(2)}px`;
      cap.style.borderRadius = `${(w / 2).toFixed(2)}px`;
      const onCap = px > cx - w / 2 - 14 && px < BW && py > y0 - 10 && py < y0 + L + 10;
      const onBtns = e > 0.2 && actions.covers(px, py);
      const inside = pointer.active && !panelOpen && (onCap || onBtns) || performance.now() < pinUntil || actions.focused && !panelOpen;
      exp.set(inside || dragging ? 1 : 0);
      fy.set(clamp(py, y0, y0 + L));
      fy.step(dt);
      const lens = (y) => inside ? Math.exp(-((y - fy.value) ** 2) / (2 * 20 * 20)) : 0;
      const ccx = innerWidth - BW + cx;
      const ccy = top + y0 + L / 2;
      const ddx = pointer.x - ccx;
      const ddy = pointer.y - ccy;
      const dd = Math.hypot(ddx, ddy);
      const near = pointer.active && dd < 360;
      lx.set(near ? ddx / (dd || 1) : -0.6);
      ly.set(near ? ddy / (dd || 1) : -0.8);
      lx.step(dt);
      ly.step(dt);
      setLight(cap, lx.value, ly.value);
      const firstAhead = rs.findIndex((r) => r.type === "commit" && !r.c.pushed);
      const oT = beadY((firstAhead === -1 ? rs.length - 1 : firstAhead) - 0.5);
      originY.set(oT);
      if (snapNext) originY.snap();
      originY.step(dt);
      originO.step(dt);
      const oY = originY.value;
      const inset = Math.max(1.5, w * 0.22);
      origin.setAttribute("x1", (cx - w / 2 + inset).toFixed(2));
      origin.setAttribute("x2", (cx + w / 2 - inset).toFixed(2));
      origin.setAttribute("y1", oY.toFixed(2));
      origin.setAttribute("y2", oY.toFixed(2));
      origin.setAttribute("opacity", clamp(originO.value, 0, 1).toFixed(3));
      let nearest = null;
      let nd = 1e9;
      for (const [id, b] of beads) {
        b.y.set(beadY(b.idx));
        if (snapNext) b.y.snap();
        b.y.step(dt);
        b.o.step(dt);
        if (b.dead && b.o.value < 0.02) {
          b.g.remove();
          beads.delete(id);
          continue;
        }
        const y = b.y.value;
        if (b.r.type === "commit" && !b.dead) {
          const pv = b.r.c.pushed && oY > y;
          if (pv !== b.pv) {
            b.pv = pv;
            b.g.classList.toggle("ahead", !pv);
          }
        }
        const s2 = 1 + e * 0.3 + lens(y) * 0.9;
        b.g.setAttribute("transform", `translate(${cx.toFixed(2)} ${y.toFixed(2)}) scale(${s2.toFixed(3)})`);
        b.g.setAttribute("opacity", clamp(b.o.value, 0, 1).toFixed(3));
        if (!b.dead && Math.abs(py - y) < nd) {
          nd = Math.abs(py - y);
          nearest = b;
        }
      }
      const buttonsMoving = actions.frame(dt, { reveal: Math.max(e, st.phase === "capturing" ? 1 : 0), x: cx, y: y0 + L + BTN_GAP + 2, dir: "column" });
      if (capturing) {
        prog.setAttribute("x1", cx.toFixed(2));
        prog.setAttribute("x2", cx.toFixed(2));
        prog.setAttribute("y1", (y0 + pad).toFixed(2));
        prog.setAttribute("y2", (y0 + pad + (L - 2 * pad) * st.progress).toFixed(2));
        prog.style.display = "";
      } else prog.style.display = "none";
      initg.style.display = !st.tracked && !capturing ? "" : "none";
      initg.setAttribute("transform", `translate(${cx.toFixed(2)} ${(y0 + L / 2).toFixed(2)}) scale(${(0.55 + e * 0.45).toFixed(3)})`);
      initg.setAttribute("opacity", (0.4 + e * 0.6).toFixed(3));
      target = null;
      if (st.phase === "capturing") target = { kind: "init", y: y0 + L / 2 };
      else if (inside && !dragging) {
        if (!st.tracked) target = { kind: "init", y: y0 + L / 2 };
        else if (originO.value > 0.5 && Math.abs(py - oY) < 5 && store.ahead) target = { kind: "origin", y: oY };
        else if (nearest && nd < gap / 2) target = nearest.r.type === "work" ? { kind: "work", y: nearest.y.value } : { kind: "commit", c: nearest.r.c, y: nearest.y.value };
      }
      showTip(target, cx - w / 2);
      snapNext = false;
      let beadsMoving = false;
      for (const b of beads.values()) if (moving([b.y, b.o])) beadsMoving = true;
      const busy = dragging || buttonsMoving || beadsMoving || performance.now() < pinUntil || moving([cY, exp, fy, len, originY, originO, lx, ly]);
      return busy ? FULL : 0;
    });
    sync();
    return {
      destroy() {
        stop();
        unsub();
        actions.destroy();
        panel.destroy();
      }
    };
  }

  // src/options/preview.ts
  var MOUNT = {
    creature: mountCreature,
    line: mountLine,
    dot: mountDot
  };
  var dark = matchMedia("(prefers-color-scheme: dark)");
  function currentTheme() {
    const forced = document.documentElement.dataset.theme;
    if (forced === "light" || forced === "dark") return forced;
    return dark.matches ? "dark" : "light";
  }
  var WidgetPreview = class {
    store = createStore();
    host = null;
    inst = null;
    style = null;
    timer = 0;
    wanted = false;
    constructor() {
      dark.addEventListener("change", () => this.syncTheme());
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) clearTimeout(this.timer);
        else if (this.inst) this.schedule(4e3);
      });
    }
    get visible() {
      return !!this.inst;
    }
    /** Show (or switch to) a style. */
    show(style) {
      this.wanted = true;
      if (this.inst && this.style === style) {
        this.syncTheme();
        return;
      }
      this.unmount();
      const host = document.createElement("gitchat-ui");
      host.dataset.theme = currentTheme();
      host.setAttribute("aria-label", "Widget preview");
      document.body.appendChild(host);
      this.host = host;
      this.style = style;
      this.inst = MOUNT[style](host, this.store, { label: (k) => t(k) });
      document.body.classList.add("previewing");
      this.schedule(1400);
    }
    hide() {
      this.wanted = false;
      this.unmount();
    }
    /** Follow the page: a chosen light/dark, or the OS when the attribute is absent (Auto). */
    syncTheme() {
      if (this.host) this.host.dataset.theme = currentTheme();
    }
    /** Mirror the auto commit/push settings so the preview shows the right buttons. */
    syncAuto(autoCommit, autoPush) {
      const st = this.store.state.settings;
      if (autoPush && !st.autoPush) this.store.setAuto("autoPush", true);
      if (!autoPush && st.autoPush) this.store.setAuto("autoPush", false);
      if (autoCommit !== this.store.state.settings.autoCommit) this.store.setAuto("autoCommit", autoCommit);
    }
    unmount() {
      clearTimeout(this.timer);
      this.inst?.destroy();
      this.host?.remove();
      this.inst = null;
      this.host = null;
      this.style = null;
      if (!this.wanted) document.body.classList.remove("previewing");
    }
    /** Every so often, play one chat turn so the preview shows thinking → streaming → staged. */
    schedule(ms) {
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => {
        if (!this.inst || document.hidden) return;
        if (this.store.state.ai === "idle" && this.store.state.phase === "idle") this.store.aiTurn();
        this.schedule(11e3);
      }, ms);
    }
  };

  // src/shared/types.ts
  var SERVICES = ["chatgpt", "claude", "gemini"];

  // src/options/settings-view.ts
  var PROJECT_URL = "https://github.com/Aero123421/gitchat";
  var SERVICE_NAME = { chatgpt: "ChatGPT", claude: "Claude", gemini: "Gemini" };
  var SECTIONS = ["account", "repository", "behavior", "appearance", "advanced", "about"];
  var SECTION_LABEL = {
    account: "secAccount",
    repository: "secRepository",
    behavior: "secBehavior",
    appearance: "secAppearance",
    advanced: "secAdvanced",
    about: "secAbout"
  };
  function createSettingsView(opts) {
    const status = h("div", { class: "toast", role: "status", "aria-live": "polite" });
    let toastTimer = 0;
    const flash = (msg, kind = "ok") => {
      mount(status, h("div", { class: `note ${kind}` }, icon2(kind === "ok" ? "check" : "alert"), h("span", null, msg)));
      status.classList.add("on");
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => status.classList.remove("on"), kind === "ok" ? 1600 : 5e3);
    };
    const onError = (m) => flash(m, "err");
    const nav = h(
      "nav",
      { class: "sidenav", "aria-label": t("settings") },
      SECTIONS.map((id) => h("a", { href: `#${id}`, "data-sec": id }, t(SECTION_LABEL[id])))
    );
    const section = (id, ...children) => glass(h("section", { class: "sec", id, "aria-labelledby": `h-${id}` }, h("h2", { id: `h-${id}` }, t(SECTION_LABEL[id])), ...children), {
      radius: 18,
      scale: 18,
      bezel: 14
    });
    const accountBody = h("div", { class: "rows" });
    const renderAccount = () => {
      const a = app.auth;
      if (!a) {
        mount(
          accountBody,
          h("div", { class: "note" }, icon2("alert"), h("span", null, t("notSignedIn"))),
          createConnect(async () => {
            await refreshAuth().catch(() => void 0);
            flash(t("signedInAs", app.auth?.login ?? ""));
          })
        );
        return;
      }
      let confirming = false;
      let timer2 = 0;
      const out = h("button", { class: "btn small", type: "button" }, t("signOut"));
      out.addEventListener("click", async () => {
        if (!confirming) {
          confirming = true;
          out.classList.add("confirm");
          out.textContent = t("confirmSignOut");
          timer2 = window.setTimeout(() => {
            confirming = false;
            out.classList.remove("confirm");
            out.textContent = t("signOut");
          }, 3500);
          return;
        }
        clearTimeout(timer2);
        out.setAttribute("disabled", "");
        try {
          await request("auth/signout", {});
          await refreshAuth();
        } catch (e) {
          onError(errorText(e));
          out.removeAttribute("disabled");
        }
      });
      mount(
        accountBody,
        row(
          `@${a.login}`,
          [a.method === "pat" ? t("methodPat") : t("methodDevice"), a.scopes.length ? a.scopes.join(" ") : ""].filter(Boolean).join(" \xB7 "),
          out,
          void 0,
          icon2("key")
        )
      );
    };
    on("auth", renderAccount);
    renderAccount();
    const repoBody = h("div", { class: "rows" });
    let changing = false;
    const syncLine = h("span", { class: "chip" });
    const renderSyncLine = () => {
      const y = app.sync;
      syncLine.className = "chip";
      if (!y) {
        syncLine.replaceChildren(h("span", { class: "d" }), "\u2014");
        return;
      }
      if (y.lastError) {
        syncLine.classList.add("err");
        syncLine.replaceChildren(h("span", { class: "d" }), t("syncError", y.lastError));
      } else if (y.pending) {
        syncLine.classList.add("accent");
        syncLine.replaceChildren(h("span", { class: "d" }), t("pendingCommits", String(y.pending)));
      } else {
        syncLine.classList.add("ok");
        syncLine.replaceChildren(h("span", { class: "d" }), y.lastPushAt ? t("lastPush", fmtAgo(y.lastPushAt)) : t("allPushed"));
      }
    };
    const renderRepo = () => {
      const r = app.settings.repo;
      if (!r || changing) {
        mount(
          repoBody,
          createRepoChooser(async (repo) => {
            await refreshSettings().catch(() => void 0);
            if (!app.settings.repo) await patchSettings({ repo }).catch(() => void 0);
            changing = false;
            renderRepo();
            void refreshSync();
            flash(t("saved"));
          }),
          r ? h("button", { class: "btn ghost small", type: "button", onClick: () => (changing = false, renderRepo()) }, t("cancel")) : null
        );
        return;
      }
      const url = `https://github.com/${r.owner}/${r.name}`;
      mount(
        repoBody,
        row(
          `${r.owner}/${r.name}`,
          null,
          h(
            "div",
            { class: "row-actions" },
            h("a", { class: "btn small", href: url, target: "_blank", rel: "noopener noreferrer" }, h("span", null, t("openOnGitHub")), icon2("external")),
            h("button", { class: "btn small ghost", type: "button", onClick: () => (changing = true, renderRepo()) }, t("change"))
          ),
          void 0,
          icon2("repo")
        ),
        row(t("branch"), null, h("span", { class: "mono muted" }, r.branch)),
        row(t("syncState"), null, syncLine)
      );
      renderSyncLine();
    };
    on("sync", renderSyncLine);
    let lastRepoKey = JSON.stringify(app.settings.repo);
    on("settings", () => {
      const k = JSON.stringify(app.settings.repo);
      if (k !== lastRepoKey) {
        lastRepoKey = k;
        renderRepo();
      }
    });
    renderRepo();
    const autos = createAutoSwitches(opts.preview, onError);
    const svcSwitches = SERVICES.map((id) => {
      const sw = createSwitch({
        label: SERVICE_NAME[id],
        checked: app.settings.services[id],
        onChange: async (v) => {
          sw.set(v);
          try {
            await patchSettings({ services: { [id]: v } });
          } catch (e) {
            sw.set(!v);
            onError(errorText(e));
          }
        }
      });
      return { id, sw };
    });
    const vizSw = createSwitch({
      label: t("saveVisualizations"),
      checked: app.settings.saveVisualizations,
      describedBy: "gc-hint-saveVisualizations",
      onChange: async (v) => {
        vizSw.set(v);
        try {
          await patchSettings({ saveVisualizations: v });
        } catch (e) {
          vizSw.set(!v);
          onError(errorText(e));
        }
      }
    });
    on("settings", () => {
      for (const { id, sw } of svcSwitches) if (sw.get() !== app.settings.services[id]) sw.set(app.settings.services[id]);
      if (vizSw.get() !== app.settings.saveVisualizations) vizSw.set(app.settings.saveVisualizations);
    });
    const cid = h("input", {
      class: "field mono",
      id: "gc-client-id",
      value: app.settings.githubClientId,
      placeholder: t("builtIn"),
      spellcheck: "false",
      autocomplete: "off",
      "aria-describedby": "gc-hint-cid"
    });
    const saveCid = async () => {
      const v = cid.value.trim();
      if (v === app.settings.githubClientId) return;
      try {
        await patchSettings({ githubClientId: v });
        flash(t("saved"));
      } catch (e) {
        onError(errorText(e));
      }
    };
    cid.addEventListener("change", () => void saveCid());
    cid.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void saveCid();
    });
    let resetArmed = false;
    let resetTimer = 0;
    const resetBtn = h("button", { class: "btn small danger", type: "button" }, t("resetAll"));
    resetBtn.addEventListener("click", async () => {
      if (!resetArmed) {
        resetArmed = true;
        resetBtn.classList.add("confirm");
        resetBtn.textContent = t("confirmReset");
        resetTimer = window.setTimeout(() => {
          resetArmed = false;
          resetBtn.classList.remove("confirm");
          resetBtn.textContent = t("resetAll");
        }, 3500);
        return;
      }
      clearTimeout(resetTimer);
      resetBtn.setAttribute("disabled", "");
      resetBtn.replaceChildren(spinner(), h("span", null, t("resetAll")));
      try {
        await request("auth/signout", {}).catch(() => null);
        await patchSettings({ ...DEFAULT_SETTINGS });
        await refreshAuth().catch(() => void 0);
        opts.onReset();
      } catch (e) {
        onError(errorText(e));
        resetBtn.removeAttribute("disabled");
        resetBtn.textContent = t("resetAll");
      }
    });
    const appearance = section(
      "appearance",
      h("div", { class: "rows" }, row(t("theme"), null, createThemePicker(onError))),
      createStylePicker(opts.preview, onError)
    );
    const behavior = section(
      "behavior",
      h(
        "div",
        { class: "rows" },
        row(t("autoCommit"), t("autoCommitHint"), autos.commit.el, "gc-hint-autocommit", icon2("commit")),
        row(t("autoPush"), t("autoPushHint"), autos.push.el, "gc-hint-autopush", icon2("push"))
      ),
      h("h3", null, t("services")),
      h(
        "div",
        { class: "rows" },
        svcSwitches.map(({ id, sw }) => row(SERVICE_NAME[id], null, sw.el))
      ),
      h("h3", null, t("captureHeading")),
      h(
        "div",
        { class: "rows" },
        row(t("saveVisualizations"), t("saveVisualizationsHint"), vizSw.el, "gc-hint-saveVisualizations")
      )
    );
    const content = h(
      "div",
      { class: "sections" },
      section("account", accountBody),
      section("repository", repoBody),
      behavior,
      appearance,
      section(
        "advanced",
        h(
          "div",
          { class: "stack" },
          h("div", null, h("label", { class: "lbl", for: "gc-client-id" }, t("clientId")), cid, h("p", { class: "hint", id: "gc-hint-cid" }, t("clientIdHint"))),
          row(t("resetAll"), t("resetHint"), resetBtn)
        )
      ),
      section(
        "about",
        h(
          "div",
          { class: "rows" },
          row(t("version"), null, h("span", { class: "mono muted" }, "0.1.3")),
          row(t("project"), null, h("a", { class: "mono", href: PROJECT_URL, target: "_blank", rel: "noopener noreferrer" }, PROJECT_URL.replace("https://", ""))),
          row(t("license"), null, h("span", { class: "mono muted" }, "MIT"))
        )
      )
    );
    const visible = /* @__PURE__ */ new Set();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        const firstVisible = SECTIONS.find((id) => visible.has(id));
        for (const a of nav.querySelectorAll("a")) a.classList.toggle("on", a.dataset.sec === firstVisible);
        if (visible.has("appearance") || visible.has("behavior")) {
          opts.preview.show(app.settings.widget);
          opts.preview.syncAuto(app.settings.autoCommit, app.settings.autoPush);
        } else opts.preview.hide();
      },
      { rootMargin: "-64px 0px -30% 0px" }
    );
    requestAnimationFrame(() => content.querySelectorAll("section.sec").forEach((s2) => io.observe(s2)));
    on("settings", () => {
      if (opts.preview.visible) {
        opts.preview.show(app.settings.widget);
        opts.preview.syncAuto(app.settings.autoCommit, app.settings.autoPush);
      }
    });
    return h("div", { class: "layout" }, nav, content, status);
  }

  // src/options/options.ts
  async function main() {
    await installDevShim();
    injectKitStyles();
    document.documentElement.lang = chrome.i18n?.getUILanguage?.() ?? "en";
    document.title = `gitchat \u2014 ${t("settings")}`;
    const chip = h("a", { class: "chip sync-chip", target: "_blank", rel: "noopener noreferrer" });
    const top = h(
      "header",
      { class: "top" },
      h("div", { class: "brand" }, createMark(24, false), h("span", null, "gitchat")),
      h("span", { class: "sp" }),
      chip
    );
    const main2 = h("main", { id: "main" });
    const banner = h("div", { class: "banner" });
    document.body.append(top, banner, main2);
    const errors = await loadAll();
    if (errors.length) mount(banner, h("div", { class: "note err", role: "alert" }, icon2("alert"), h("span", null, errorText(errors[0]))));
    const renderChip = () => {
      const r = app.settings.repo;
      const y = app.sync;
      chip.hidden = !r;
      if (!r) return;
      chip.href = `https://github.com/${r.owner}/${r.name}`;
      chip.className = `chip sync-chip${y?.lastError ? " err" : y?.pending ? " accent" : " ok"}`;
      chip.replaceChildren(
        h("span", { class: "d" }),
        `${r.owner}/${r.name}`,
        ...y?.pending ? [h("span", { class: "n" }, `\u2191${y.pending}`)] : []
      );
      chip.title = y?.lastError ? t("syncError", y.lastError) : y?.pending ? t("pendingCommits", String(y.pending)) : t("allPushed");
    };
    on("settings", renderChip);
    on("sync", renderChip);
    renderChip();
    window.setInterval(() => {
      if (!document.hidden && app.settings.repo) void refreshSync();
    }, 15e3);
    const preview = new WidgetPreview();
    const paintTheme = () => {
      applyPageTheme(app.settings.theme);
      preview.syncTheme();
    };
    on("settings", paintTheme);
    paintTheme();
    const forceOnboarding = location.hash === "#onboarding";
    const showSettings = () => {
      preview.hide();
      document.body.dataset.view = "settings";
      mount(main2, createSettingsView({ preview, onReset: showOnboarding }));
      const target = location.hash.slice(1);
      if (target && target !== "onboarding") document.getElementById(target)?.scrollIntoView();
    };
    function showOnboarding() {
      preview.hide();
      document.body.dataset.view = "onboarding";
      mount(
        main2,
        createOnboarding({
          preview,
          onFinish: () => {
            history.replaceState(null, "", location.pathname + location.search);
            showSettings();
            scrollTo({ top: 0 });
          }
        })
      );
    }
    if (!app.settings.repo || forceOnboarding) showOnboarding();
    else showSettings();
  }
  void main();
})();
