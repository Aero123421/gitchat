// src/shared/protocol.ts
var EVENTS_PORT = "gitchat:events";
var GitchatError = class extends Error {
  constructor(message, code = "error") {
    super(message);
    this.code = code;
    this.name = "GitchatError";
  }
  code;
};
function isEnvelope(x) {
  return !!x && typeof x === "object" && x.gitchat === 1 && typeof x.type === "string";
}

// src/shared/types.ts
var SERVICES = ["chatgpt", "claude", "gemini", "grok"];
var ASSET_URL_PREFIX = "gitchat-asset:";
var chatKey = (service2, chatId) => `${service2}:${chatId}`;

// src/shared/settings.ts
var DEFAULT_SETTINGS = {
  widget: "creature",
  theme: "auto",
  autoCommit: false,
  autoPush: false,
  repo: null,
  services: { chatgpt: true, claude: true, gemini: true, grok: true },
  saveVisualizations: true,
  githubClientId: ""
};
var KEY = "settings";
function knownRepo(value) {
  if (!value || typeof value !== "object") return null;
  const repo = value;
  if (typeof repo.owner !== "string" || typeof repo.name !== "string" || typeof repo.branch !== "string") return null;
  return { owner: repo.owner, name: repo.name, branch: repo.branch };
}
function knownServices(value) {
  const raw = value && typeof value === "object" ? value : {};
  const services = { ...DEFAULT_SETTINGS.services };
  for (const id of SERVICES) {
    const flag = raw[id];
    if (typeof flag === "boolean") services[id] = flag;
  }
  return services;
}
function normalizeSettings(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const out = {
    widget: s.widget === "creature" || s.widget === "line" || s.widget === "dot" ? s.widget : DEFAULT_SETTINGS.widget,
    theme: s.theme === "light" || s.theme === "dark" || s.theme === "auto" ? s.theme : "auto",
    autoCommit: typeof s.autoCommit === "boolean" ? s.autoCommit : DEFAULT_SETTINGS.autoCommit,
    autoPush: typeof s.autoPush === "boolean" ? s.autoPush : DEFAULT_SETTINGS.autoPush,
    repo: knownRepo(s.repo),
    services: knownServices(s.services),
    saveVisualizations: typeof s.saveVisualizations === "boolean" ? s.saveVisualizations : DEFAULT_SETTINGS.saveVisualizations,
    githubClientId: typeof s.githubClientId === "string" ? s.githubClientId : DEFAULT_SETTINGS.githubClientId
  };
  if (out.autoPush) out.autoCommit = true;
  return out;
}
function applySettingsPatch(current, patch) {
  const merged = { ...current, ...patch, services: { ...current.services, ...patch.services ?? {} } };
  if (patch.autoCommit === false) merged.autoPush = false;
  if (patch.autoPush === true) merged.autoCommit = true;
  return normalizeSettings(merged);
}
async function restrictSettingsStorage() {
  await chrome.storage.sync.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
}
async function loadSettings() {
  await restrictSettingsStorage();
  const got = await chrome.storage.sync.get(KEY);
  return normalizeSettings(got[KEY]);
}
async function saveSettings(settings) {
  await restrictSettingsStorage();
  await chrome.storage.sync.set({ [KEY]: normalizeSettings(settings) });
}

// src/shared/log.ts
var PREFIX = "[gitchat]";
function debugEnabled() {
  try {
    return globalThis.localStorage?.getItem("gitchatDebug") === "1";
  } catch {
    return false;
  }
}
var log = {
  debug: (...args) => {
    if (debugEnabled()) console.debug(PREFIX, ...args);
  },
  info: (...args) => console.info(PREFIX, ...args),
  warn: (...args) => console.warn(PREFIX, ...args),
  error: (...args) => console.error(PREFIX, ...args)
};

// src/background/errors.ts
function toGitchatError(e) {
  if (e instanceof GitchatError) return e;
  return new GitchatError(e instanceof Error ? e.message : String(e), "error");
}

// src/background/github/client.ts
var API_BASE = "https://api.github.com";
var RateLimitError = class extends GitchatError {
  constructor(message, retryAfterMs) {
    super(message, "rate-limit");
    this.retryAfterMs = retryAfterMs;
    this.name = "RateLimitError";
  }
  retryAfterMs;
};
var ATTEMPTS = 3;
var backoff = (attempt) => 500 * 2 ** attempt;
var defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
var GitHub = class {
  constructor(token, opts = {}) {
    this.token = token;
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = opts.sleep ?? defaultSleep;
    this.maxWaitMs = opts.maxWaitMs ?? 6e4;
  }
  token;
  fetchImpl;
  sleep;
  maxWaitMs;
  /** Calls the API. Statuses in `allow` are returned instead of thrown. */
  async request(method, path, body, allow = []) {
    let lastError;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      let res;
      try {
        res = await this.fetchImpl(API_BASE + path, {
          method,
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            Authorization: `Bearer ${this.token}`,
            ...body === void 0 ? {} : { "Content-Type": "application/json" }
          },
          body: body === void 0 ? void 0 : JSON.stringify(body)
        });
      } catch (e) {
        lastError = new GitchatError(`Could not reach GitHub (${e.message}).`, "network");
        await this.sleep(backoff(attempt));
        continue;
      }
      const data = await readJson(res);
      if (res.ok || allow.includes(res.status)) return { status: res.status, data, headers: res.headers };
      const wait = rateLimitWait(res, data);
      if (wait !== null) {
        if (wait <= this.maxWaitMs && attempt < ATTEMPTS - 1) {
          await this.sleep(wait);
          continue;
        }
        throw new RateLimitError(`GitHub's rate limit was reached. Try again in about ${Math.max(1, Math.ceil(wait / 6e4))} min.`, wait);
      }
      if (res.status >= 500) {
        lastError = toError(res.status, data);
        await this.sleep(backoff(attempt));
        continue;
      }
      throw toError(res.status, data);
    }
    throw lastError ?? new GitchatError("The GitHub request failed.", "network");
  }
};
async function readJson(res) {
  if (res.status === 204) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}
function messageOf(data) {
  const m = data?.message;
  return typeof m === "string" ? m : "";
}
function rateLimitWait(res, data) {
  if (res.status !== 403 && res.status !== 429) return null;
  const retryAfter = res.headers.get("retry-after");
  if (retryAfter && Number.isFinite(Number(retryAfter))) return Math.max(1, Number(retryAfter)) * 1e3;
  if (res.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    return Number.isFinite(reset) ? Math.max(1e3, reset * 1e3 - Date.now()) : 6e4;
  }
  if (res.status === 429 || /secondary rate limit/i.test(messageOf(data))) return 6e4;
  return null;
}
function toError(status, data) {
  const msg = messageOf(data);
  switch (status) {
    case 401:
      return new GitchatError("GitHub rejected the sign-in. Connect GitHub again in the settings.", "auth");
    case 403:
      return new GitchatError(`GitHub denied access${msg ? `: ${msg}` : "."}`, "forbidden");
    case 404:
      return new GitchatError(`Not found on GitHub${msg ? ` (${msg})` : ""}.`, "not-found");
    case 409:
      return new GitchatError(msg || "GitHub reported a conflict.", "conflict");
    case 422:
      return /fast.forward/i.test(msg) ? new GitchatError("The branch moved on GitHub while pushing.", "non-fast-forward") : new GitchatError(msg || "GitHub rejected the request.", "invalid");
    default:
      return new GitchatError(`GitHub error ${status}${msg ? `: ${msg}` : ""}.`, status >= 500 ? "network" : "github");
  }
}

// src/background/base64.ts
function bytesToBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(bin);
}
function base64ToBytes(b64) {
  const bin = atob(b64.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
var utf8ToBase64 = (s) => bytesToBase64(new TextEncoder().encode(s));
var base64ToUtf8 = (b64) => new TextDecoder().decode(base64ToBytes(b64));

// src/background/hash.ts
function hash53(str2, seed = 0) {
  let h1 = 3735928559 ^ seed;
  let h2 = 1103547991 ^ seed;
  for (let i = 0; i < str2.length; i++) {
    const ch = str2.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507);
  h1 ^= Math.imul(h2 ^ h2 >>> 13, 3266489909);
  h2 = Math.imul(h2 ^ h2 >>> 16, 2246822507);
  h2 ^= Math.imul(h1 ^ h1 >>> 13, 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
async function gitBlobSha(content, encoding = "utf8") {
  const body = encoding === "utf8" ? new TextEncoder().encode(content) : base64ToBytes(content);
  const header = new TextEncoder().encode(`blob ${body.length}\0`);
  const buf = new Uint8Array(header.length + body.length);
  buf.set(header);
  buf.set(body, header.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", buf));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

// src/background/paths.ts
var MAX_SLUG = 48;
function slugify(title) {
  const s = title.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  const cut = Array.from(s).slice(0, MAX_SLUG).join("").replace(/-+$/, "");
  return cut || "chat";
}
function safeId(chatId) {
  return chatId.replace(/[^A-Za-z0-9_-]/g, "") || hash53(chatId);
}
function shortId(chatId, length = 8) {
  return safeId(chatId).slice(0, length);
}
function localDate(iso2) {
  const d = new Date(iso2);
  const t = Number.isNaN(d.getTime()) ? /* @__PURE__ */ new Date() : d;
  const pad = (n) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}
function chatPath(service2, title, chatId, createdIso, idLength = 8) {
  return `${service2}/${localDate(createdIso)}-${slugify(title)}--${shortId(chatId, idLength)}.md`;
}
function freePath(service2, title, chatId, createdIso, taken) {
  for (const n of [8, 16, 32]) {
    const p = chatPath(service2, title, chatId, createdIso, n);
    if (!taken(p)) return p;
  }
  return chatPath(service2, title, chatId, createdIso, Infinity);
}
function assetDir(path) {
  return `${path.replace(/\.md$/, "")}.assets`;
}
function chatFileCandidates(paths, service2, chatId) {
  const prefix = `${service2}/`;
  const id = safeId(chatId);
  const out = [];
  for (const path of paths) {
    if (!path.startsWith(prefix) || !path.endsWith(".md") || path.slice(prefix.length).includes("/")) continue;
    const cut = path.lastIndexOf("--");
    const suffix = cut < 0 ? "" : path.slice(cut + 2, -3);
    if (suffix.length >= Math.min(8, id.length) && id.startsWith(suffix)) out.push({ path, match: suffix.length });
  }
  return out.sort((a, b) => b.match - a.match).map((c) => c.path);
}
function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}
function repoId(repo) {
  return repo ? `${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}@${repo.branch}` : null;
}

// src/background/assets.ts
var MARKER_LINE = /^> \*\*(Artifact|File):\*\* (.*?)[ \t]*$/gm;
var LINKED = /^\[((?:\\.|[^\]\\])*\\?)\]\(([^()\s]+)\)$/;
var escapeLabel = (s) => s.replace(/[[\]]/g, "\\$&");
var unescapeLabel = (s) => s.replace(/\\([[\]\\])/g, "$1");
function parseMarker(kind, rest) {
  const l = LINKED.exec(rest);
  return l ? { kind, title: unescapeLabel(l[1] ?? ""), target: l[2] ?? "" } : { kind, title: rest, target: null };
}
function markerLine(m) {
  return `> **${m.kind}:** ${m.target ? `[${escapeLabel(m.title)}](${m.target})` : m.title}`;
}
function markers(md) {
  return [...md.matchAll(MARKER_LINE)].map((m) => parseMarker(m[1] ?? "", m[2] ?? ""));
}
function decode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
function assetNameOf(target) {
  const m = /^(?:gitchat-asset:|[^/()\s]+\.assets\/)([^()\s]+)$/.exec(target);
  return m ? decode(m[1] ?? "") : null;
}
var MIME = {
  html: "text/html",
  htm: "text/html",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  json: "application/json",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv"
};
var REPO_LINK = /(!?)\[((?:\\.|[^\]\\])*)\]\(([^()\s/]+\.assets\/([^()\s]+))\)/g;
async function materializeAssets(m, fetch2) {
  if (!m.markdown.includes(".assets/")) return m;
  const assets = [...m.assets ?? []];
  const found = /* @__PURE__ */ new Map();
  for (const [, , , , raw = ""] of m.markdown.matchAll(REPO_LINK)) {
    const name = decode(raw);
    if (found.has(name)) continue;
    const got = await fetch2(name);
    found.set(name, !!got);
    if (got && !assets.some((a) => a.name === name)) {
      const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
      assets.push({ name, mime: MIME[ext] ?? "application/octet-stream", data: got.data, encoding: "base64", sha: got.sha });
    }
  }
  const markdown = m.markdown.replace(MARKER_LINE, (line, kind, rest) => {
    const mk = parseMarker(kind, rest);
    const name = mk.target ? assetNameOf(mk.target) : null;
    if (!name || !mk.target?.includes(".assets/")) return line;
    return markerLine(found.get(name) ? { ...mk, target: `gitchat-asset:${encodeURIComponent(name)}` } : { ...mk, target: null });
  }).replace(
    REPO_LINK,
    (_s, bang, label, _target, raw) => found.get(decode(raw)) ? `${bang}[${label}](gitchat-asset:${raw})` : unescapeLabel(label)
  );
  const out = { ...m, markdown };
  if (assets.length) out.assets = assets;
  return out;
}

// src/background/stage.ts
function canonicalMarkdown(md) {
  return md.replace(/\r\n?/g, "\n").replace(/^(?:[ \t]*\n)+/, "").replace(/(?:\n[ \t]*)+$/, "");
}
var ASSET_LINK = /\]\((?:gitchat-asset:|[^()\s/]+\.assets\/)([^()\s]+)\)/g;
function decode2(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
function linkedAssetNames(md) {
  return [...md.matchAll(ASSET_LINK)].map((m) => decode2(m[1] ?? ""));
}
function assetDigest(a) {
  return a.sha ?? `h${hash53(`${a.encoding}
${a.data}`)}`;
}
function messageHash(m) {
  const md = canonicalMarkdown(m.markdown).replace(ASSET_LINK, (_s, name) => `](asset:${decode2(name)})`);
  const own = new Map((m.assets ?? []).map((a) => [a.name, assetDigest(a)]));
  const names = [.../* @__PURE__ */ new Set([...linkedAssetNames(m.markdown), ...own.keys()])].sort();
  return hash53(`${m.role}
${md}
${names.map((n) => `${n}=${own.get(n) ?? ""}`).join("\n")}`);
}
function refsOf(messages) {
  return messages.map((m) => ({ id: m.id, role: m.role, hash: messageHash(m) }));
}
var hashesOf = (refs) => new Map((refs ?? []).map((r) => [r.id, r.hash]));
var KIND_ORDER = ["viz", "math", "code", "image", "table"];
function primaryKind(m) {
  const kinds = m.kinds ?? [];
  return KIND_ORDER.find((k) => kinds.includes(k)) ?? "text";
}
function diffStaged(current, committed) {
  const before = new Map(committed.map((c) => [c.id, c]));
  const staged = [];
  for (const m of current) {
    const ref = before.get(m.id);
    if (!ref || ref.hash !== messageHash(m)) staged.push({ id: m.id, role: m.role, kind: primaryKind(m) });
  }
  const now = new Set(current.map((m) => m.id));
  for (const c of committed) if (!now.has(c.id)) staged.push({ id: c.id, role: c.role, kind: "removed" });
  return staged;
}
var AMBIGUOUS = { ok: false, code: "ambiguous", message: "The capture could not be placed in the saved chat; the whole chat has to be read again." };
function mergeSnapshot(known, snap, reads) {
  const incoming = uniqueIds(snap.messages);
  const byId = new Map(known.map((m) => [m.id, m]));
  const view = snap.view;
  const lastRead = (id) => {
    const r = reads?.get(id);
    return r && (view && r.hv && view.id in r.hv ? r.hv[view.id] : r.h);
  };
  const place = (m) => {
    const old = byId.get(m.id);
    if (!old) return m;
    if (lastRead(m.id) === messageHash(m)) return old;
    return keepArtifacts(old, m);
  };
  if (snap.complete) {
    if (!incoming.length) return { ok: false, code: "empty", message: "The capture found no messages, so nothing was changed." };
    const users = incoming.filter((m) => m.role === "user").length;
    if (users >= 2 && users === incoming.length) {
      return { ok: false, code: "invalid", message: "The capture looked incomplete, so nothing was changed." };
    }
    const placed = incoming.map(place);
    if (snap.startConfirmed === true || !known.length) return { ok: true, messages: placed };
    const at = new Map(known.map((m, i) => [m.id, i]));
    const first = incoming.find((m) => at.has(m.id));
    if (!first) return { ok: true, messages: known };
    const captured = new Set(incoming.map((m) => m.id));
    return { ok: true, messages: [...known.slice(0, at.get(first.id)).filter((m) => !captured.has(m.id)), ...placed] };
  }
  if (!incoming.length) return { ok: true, messages: known };
  const observed = (m) => {
    if (!reads) return true;
    const r = reads.get(m.id);
    return !!r && (!view || r.at <= view.since || !!r.v?.includes(view.id));
  };
  const index = new Map(known.map((m, i) => [m.id, i]));
  const firstKnown = incoming.findIndex((m) => index.has(m.id));
  if (firstKnown < 0) return known.length ? AMBIGUOUS : { ok: true, messages: incoming };
  if (snap.atEnd && branchChanged(incoming, firstKnown, known, index, observed)) {
    const anchorAt = index.get(incoming[firstKnown].id);
    const captured = new Set(incoming.map((m) => m.id));
    let out2 = [...known.slice(0, anchorAt).filter((m) => !captured.has(m.id)), ...incoming.map(place)];
    if (known.slice(anchorAt).some((m) => !captured.has(m.id) && !observed(m))) {
      const kept = new Set(out2.map((m) => m.id));
      out2 = unionMessages(out2, known.filter((m) => kept.has(m.id) || !observed(m)));
    }
    return { ok: true, messages: out2 };
  }
  if (snap.atEnd) {
    const lastAt = index.get(incoming.at(-1).id);
    const captured = new Set(incoming.map((m) => m.id));
    if (lastAt !== void 0 && known.slice(lastAt + 1).some((m) => !captured.has(m.id) && observed(m))) return AMBIGUOUS;
  }
  if (!snap.atEnd && diverged(incoming, known, index, observed)) return AMBIGUOUS;
  let lastKnown = firstKnown;
  incoming.forEach((m, i) => {
    if (index.has(m.id)) lastKnown = i;
  });
  const out = [...known];
  incoming.forEach((m, i) => {
    const at = index.get(m.id);
    if (at !== void 0) out[at] = place(m);
    else if (i > lastKnown) {
      index.set(m.id, out.length);
      out.push(m);
    }
  });
  return { ok: true, messages: out };
}
function diverged(incoming, known, index, observed) {
  const captured = new Set(incoming.map((m) => m.id));
  for (let i = 0; i < incoming.length; i++) {
    const at = index.get(incoming[i].id);
    if (at === void 0) continue;
    const next = known[at + 1];
    if (!next || captured.has(next.id) || !observed(next)) continue;
    if (incoming.slice(i + 1).some((m) => !index.has(m.id))) return true;
  }
  return false;
}
function branchChanged(incoming, firstKnown, known, index, observed) {
  const skipsSeen = (from, to) => known.slice(from, to).some(observed);
  let expected = index.get(incoming[firstKnown].id) + 1;
  let sawNew = false;
  for (const m of incoming.slice(firstKnown + 1)) {
    const at = index.get(m.id);
    if (at === void 0) {
      sawNew = true;
      continue;
    }
    if (sawNew || at < expected || skipsSeen(expected, at)) return true;
    expected = at + 1;
  }
  return sawNew && skipsSeen(expected, known.length);
}
function recordReads(reads, captured, chat, view, now) {
  const next = new Map(reads);
  for (const m of captured) {
    const prev = reads.get(m.id);
    const h = messageHash(m);
    const v = view ? [view.id, ...(prev?.v ?? []).filter((x) => x !== view.id)].slice(0, 4) : prev?.v;
    const hv = {};
    const remembered = /* @__PURE__ */ new Set([...v ?? [], ...Object.keys(prev?.hv ?? {})]);
    if (view) remembered.add(view.id);
    for (const id of remembered) {
      const was = view && id === view.id ? h : prev?.hv?.[id];
      if (was !== void 0) hv[id] = was;
    }
    next.set(m.id, { h, at: prev ? prev.at : now, ...v?.length ? { v } : {}, ...Object.keys(hv).length ? { hv } : {} });
  }
  const out = {};
  for (const m of chat) {
    const r = next.get(m.id);
    if (r) out[m.id] = r;
  }
  return out;
}
function uniqueIds(messages) {
  const seen = /* @__PURE__ */ new Map();
  return messages.map((m) => {
    const n = (seen.get(m.id) ?? 0) + 1;
    seen.set(m.id, n);
    return n === 1 ? m : { ...m, id: `${m.id}#${n}` };
  });
}
function keepArtifacts(old, next) {
  const saved = /* @__PURE__ */ new Map();
  for (const m of markers(old.markdown)) if (m.target) saved.set(`${m.kind}
${m.title}`, [...saved.get(`${m.kind}
${m.title}`) ?? [], m]);
  if (!saved.size) return next;
  const assets = [...next.assets ?? []];
  const used = /* @__PURE__ */ new Map();
  let carried = false;
  const markdown = next.markdown.replace(MARKER_LINE, (line, kind, rest) => {
    const now = parseMarker(kind, rest);
    const key2 = `${kind}
${now.title}`;
    const i = used.get(key2) ?? 0;
    used.set(key2, i + 1);
    const before = saved.get(key2)?.[i];
    if (!before?.target) return line;
    const oldName = assetNameOf(before.target);
    if (now.target) {
      const newName = assetNameOf(now.target);
      if (!oldName || !newName || newName === oldName || !now.target.startsWith("gitchat-asset:") || assets.some((a) => a.name === oldName)) return line;
      const at = assets.findIndex((a) => a.name === newName);
      if (at < 0) return line;
      assets[at] = { ...assets[at], name: oldName };
      return markerLine({ ...now, target: `gitchat-asset:${encodeURIComponent(oldName)}` });
    }
    const file = oldName ? old.assets?.find((a) => a.name === oldName) : void 0;
    if (file && !assets.some((a) => a.name === file.name)) assets.push(file);
    carried = true;
    return markerLine(before);
  });
  if (markdown === next.markdown) return next;
  const out = { ...next, markdown };
  if (assets.length) out.assets = assets;
  if (carried) out.kinds = [.../* @__PURE__ */ new Set([...next.kinds ?? [], "viz"])];
  return out;
}
function unionMessages(primary, secondary) {
  const out = [...primary];
  const has = new Set(out.map((m) => m.id));
  let after = -1;
  for (const m of secondary) {
    if (has.has(m.id)) {
      after = out.findIndex((x) => x.id === m.id);
      continue;
    }
    out.splice(after + 1, 0, m);
    has.add(m.id);
    after++;
  }
  return out;
}
function threeWayMerge(base, ours, theirs, oursNewer) {
  const o = new Map(ours.map((m) => [m.id, m]));
  const t = new Map(theirs.map((m) => [m.id, m]));
  const pick = (id) => {
    const mine = o.get(id);
    const other = t.get(id);
    const b = base?.get(id);
    if (mine && other) {
      const mh = messageHash(mine);
      const th = messageHash(other);
      if (mh === th || b === th) return mine;
      if (b === mh) return other;
      return oursNewer ? mine : other;
    }
    const only = mine ?? other;
    if (!only) return null;
    return b !== void 0 && messageHash(only) === b ? null : only;
  };
  const order = oursNewer ? unionMessages(ours, theirs) : unionMessages(theirs, ours);
  return order.map((m) => pick(m.id)).filter((m) => !!m);
}
function keepChangesSince(captured, current, base) {
  const changed = new Map(current.filter((m) => base.get(m.id) !== messageHash(m)).map((m) => [m.id, m]));
  const now = new Set(current.map((m) => m.id));
  const deleted = new Set([...base.keys()].filter((id) => !now.has(id)));
  let out = captured.filter((m) => !deleted.has(m.id)).map((m) => changed.get(m.id) ?? m);
  const have = new Set(out.map((m) => m.id));
  if ([...changed.keys()].some((id) => !have.has(id))) out = unionMessages(out, current.filter((m) => changed.has(m.id) || have.has(m.id)));
  return out;
}

// src/background/render.ts
var ROLE_HEADING = { user: "User", assistant: "Assistant" };
var UNTITLED = "Untitled chat";
var oneLine = (s) => s.replace(/\s+/g, " ").trim();
var yamlString = (s) => JSON.stringify(s);
var commentSafe = (s) => s.replace(/--+/g, "-").replace(/[<>"]/g, "");
function chatTitle(title) {
  return oneLine(title) || UNTITLED;
}
function renderChat(doc, path) {
  const dir = assetDir(path);
  const dirName = dir.slice(dir.lastIndexOf("/") + 1);
  const { files: assets, renames } = collectAssets(doc.messages);
  const title = chatTitle(doc.title);
  const lines = [
    "---",
    "gitchat: 1",
    `service: ${doc.service}`,
    `id: ${yamlString(doc.chatId)}`,
    `url: ${yamlString(doc.url)}`,
    `title: ${yamlString(title)}`,
    `created: ${doc.createdAt}`,
    `captured: ${doc.capturedAt}`,
    `messages: ${doc.messages.length}`,
    "---",
    "",
    `# ${title}`,
    ""
  ];
  doc.messages.forEach((m, i) => {
    const body = canonicalMarkdown(rewriteAssetLinks(m.markdown, renames[i], dirName));
    lines.push(`## ${ROLE_HEADING[m.role]}`, `<!-- gitchat:message id="${commentSafe(m.id)}" length="${body.length}" -->`, "");
    if (body) lines.push(body, "");
  });
  const out = [{ path, content: `${lines.join("\n").replace(/\n+$/, "")}
`, encoding: "utf8", kind: "chat" }];
  for (const [name, a] of assets) out.push({ path: `${dir}/${name}`, content: a.data, encoding: a.encoding, kind: "asset" });
  return out;
}
function copyCards(md) {
  return md.replace(MARKER_LINE, (line, kind, rest) => {
    const marker = parseMarker(kind, rest);
    return marker.target !== null && assetNameOf(marker.target) !== null ? markerLine({ ...marker, target: null }) : line;
  });
}
function renderCopy(doc) {
  const lines = [`# ${chatTitle(doc.title)}`, ""];
  for (const m of doc.messages) {
    const body = canonicalMarkdown(copyCards(m.markdown));
    lines.push(`## ${ROLE_HEADING[m.role]}`, "");
    if (body) lines.push(body, "");
  }
  return `${lines.join("\n").replace(/\n+$/, "")}
`;
}
function collectAssets(messages) {
  const files = /* @__PURE__ */ new Map();
  const linkedBy = /* @__PURE__ */ new Map();
  messages.forEach((m, i) => {
    for (const name of repositoryLinks(m.markdown)) if (!linkedBy.has(name)) linkedBy.set(name, i);
  });
  const taken = (name, a, i) => files.has(name) && files.get(name)?.data !== a.data || linkedBy.has(name) && linkedBy.get(name) !== i;
  const renames = messages.map((m, i) => {
    const map = /* @__PURE__ */ new Map();
    for (const a of m.assets ?? []) {
      const safe = safeName(a.name);
      let name = safe;
      for (let n = 2; taken(name, a, i); n++) name = withSuffix(safe, n);
      files.set(name, a);
      map.set(a.name, name);
    }
    return map;
  });
  return { files, renames };
}
function repositoryLinks(md) {
  return [...md.matchAll(/\]\([^()\s/]+\.assets\/([^()\s]+)\)/g)].map((m) => decodeURIComponentSafe(m[1] ?? ""));
}
function safeName(name) {
  const s = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/^\.+/, "").trim();
  return s || "asset";
}
function withSuffix(name, n) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)}-${n}${name.slice(dot)}` : `${name}-${n}`;
}
var encodeSegment = (s) => encodeURIComponent(s).replace(/\(/g, "%28").replace(/\)/g, "%29");
var ASSET_LINK2 = new RegExp(`${ASSET_URL_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\s)"'<>]+)`, "g");
function rewriteAssetLinks(md, renames, dirName) {
  if (!md.includes(ASSET_URL_PREFIX)) return md;
  return md.replace(ASSET_LINK2, (_m, raw) => {
    const name = renames?.get(raw) ?? renames?.get(decodeURIComponentSafe(raw));
    return name ? `${encodeSegment(dirName)}/${encodeSegment(name)}` : raw;
  });
}
function decodeURIComponentSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
function parseChatFile(md) {
  const front = parseFrontMatter(md);
  const text = md.replace(/\r\n?/g, "\n");
  const messages = [];
  let header = nextHeader(text, 0);
  while (header) {
    let body;
    let next = null;
    if (header.length !== void 0) {
      const at = text.startsWith("\n", header.end) ? header.end + 1 : header.end;
      const rest = text.slice(at + header.length);
      const fits = rest === "" || rest === "\n" || rest.startsWith("\n\n## ") || header.length === 0 && rest.startsWith("## ");
      if (fits) {
        body = text.slice(at, at + header.length);
        next = nextHeader(text, header.length === 0 ? at : at + header.length + 2);
      }
    }
    if (body === void 0) {
      next = nextHeader(text, header.end);
      body = canonicalMarkdown(text.slice(header.end, next ? next.start : text.length));
    }
    messages.push({ id: header.id, role: header.role, markdown: body });
    header = next;
  }
  return { front, messages };
}
var HEADER = /^## (User|Assistant)\n<!-- gitchat:message id="([^"]*)"(?: length="(\d+)")? -->(?:\n|$)/;
var FENCE = /^ {0,3}(`{3,}|~{3,})/;
function nextHeader(text, from) {
  let fence = null;
  for (let at = from; at < text.length; ) {
    const eol = text.indexOf("\n", at);
    const line = text.slice(at, eol < 0 ? text.length : eol);
    const f = FENCE.exec(line)?.[1];
    if (fence) {
      if (f && f[0] === fence[0] && f.length >= fence.length && line.trim() === f) fence = null;
    } else if (f) {
      fence = f;
    } else {
      const h = HEADER.exec(text.slice(at, at + 400));
      if (h) {
        const header = { role: h[1] === "User" ? "user" : "assistant", id: h[2] ?? "", start: at, end: at + h[0].length };
        if (h[3] !== void 0) header.length = Number(h[3]);
        return header;
      }
    }
    if (eol < 0) break;
    at = eol + 1;
  }
  return null;
}
function parseFrontMatter(md) {
  const out = {};
  if (!md.startsWith("---\n")) return out;
  const end = md.indexOf("\n---", 4);
  if (end < 0) return out;
  for (const line of md.slice(4, end).split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const key2 = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if (value.startsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
      }
    }
    out[key2] = value;
  }
  return out;
}

// src/background/github/git.ts
var repoPath = (repo) => `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
async function getHead(gh, repo) {
  const ref = await gh.request("GET", `${repoPath(repo)}/git/ref/heads/${encodePath(repo.branch)}`, void 0, [404, 409]);
  if (ref.status === 409) return null;
  if (ref.status === 404) {
    const commits = await gh.request("GET", `${repoPath(repo)}/commits?per_page=1`, void 0, [409]);
    if (commits.status === 409) return null;
    throw new GitchatError(`The branch "${repo.branch}" does not exist in ${repo.owner}/${repo.name}.`, "not-found");
  }
  const commit = await gh.request("GET", `${repoPath(repo)}/git/commits/${ref.data.object.sha}`);
  return { commit: ref.data.object.sha, tree: commit.data.tree.sha };
}
var treeCache = /* @__PURE__ */ new Map();
async function getTreeIndex(gh, repo, treeSha) {
  const cacheKey = `${repo.owner}/${repo.name}@${treeSha}`;
  const hit = treeCache.get(cacheKey);
  if (hit) return hit;
  const r = await gh.request("GET", `${repoPath(repo)}/git/trees/${treeSha}?recursive=1`);
  const index = { entries: /* @__PURE__ */ new Map(), truncated: !!r.data.truncated };
  for (const e of r.data.tree) if (e.type === "blob") index.entries.set(e.path, e.sha);
  if (treeCache.size > 16) treeCache.delete(treeCache.keys().next().value);
  treeCache.set(cacheKey, index);
  return index;
}
async function findEntry(gh, repo, head, index, path) {
  const sha = index.entries.get(path);
  if (sha || !index.truncated) return sha;
  const r = await gh.request("GET", `${repoPath(repo)}/contents/${encodePath(path)}?ref=${head.commit}`, void 0, [404]);
  return r.status === 404 ? void 0 : r.data.sha;
}
async function getBlobText(gh, repo, sha) {
  const r = await gh.request("GET", `${repoPath(repo)}/git/blobs/${sha}`);
  return r.data.encoding === "base64" ? base64ToUtf8(r.data.content) : r.data.content;
}
async function getBlobBase64(gh, repo, sha) {
  const r = await gh.request("GET", `${repoPath(repo)}/git/blobs/${sha}`);
  return r.data.encoding === "base64" ? r.data.content.replace(/\s+/g, "") : utf8ToBase64(r.data.content);
}
async function createBlob(gh, repo, base64) {
  const r = await gh.request("POST", `${repoPath(repo)}/git/blobs`, { content: base64, encoding: "base64" });
  return r.data.sha;
}
async function createTree(gh, repo, baseTree, entries) {
  const r = await gh.request("POST", `${repoPath(repo)}/git/trees`, { base_tree: baseTree, tree: entries });
  return r.data.sha;
}
async function createCommit(gh, repo, message, tree, parents) {
  const r = await gh.request("POST", `${repoPath(repo)}/git/commits`, { message, tree, parents });
  return r.data.sha;
}
async function updateRef(gh, repo, sha) {
  try {
    await gh.request("PATCH", `${repoPath(repo)}/git/refs/heads/${encodePath(repo.branch)}`, { sha, force: false });
  } catch (e) {
    if (e instanceof GitchatError && e.code === "conflict") throw new GitchatError("The branch moved on GitHub while pushing.", "non-fast-forward");
    throw e;
  }
}
async function putFile(gh, repo, path, text, message) {
  await gh.request("PUT", `${repoPath(repo)}/contents/${encodePath(path)}`, { message, content: utf8ToBase64(text) });
}

// src/background/github/repo.ts
var README_MARKER = "<!-- gitchat -->";
var TOPIC = "gitchat";
var SERVICE_DIRS = ["chatgpt", "claude", "gemini", "grok"];
var README = `${README_MARKER}
# AI chat archive

This repository is managed by [gitchat](https://github.com/Aero123421/gitchat). Each conversation is one Markdown file:

| Folder | Service |
| --- | --- |
| \`chatgpt/\` | ChatGPT |
| \`claude/\` | Claude |
| \`gemini/\` | Gemini |
| \`grok/\` | Grok |

File names look like \`2026-11-09-chat-title--a1b2c3d4.md\`: the date of the first save, the title, and the
start of the chat id. Interactive visualizations are saved next to their chat in a \`*.assets/\` folder.
`;
var PAGE = 100;
var MAX_PAGES = 10;
async function listRepos(gh) {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await gh.request("GET", `/user/repos?per_page=${PAGE}&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`);
    all.push(...r.data);
    if (r.data.length < PAGE) break;
  }
  return all.filter((x) => x.permissions?.push !== false).map(summary);
}
function summary(x) {
  return {
    owner: x.owner.login,
    name: x.name,
    private: x.private,
    defaultBranch: x.default_branch || "main",
    empty: (x.size ?? 0) === 0,
    managed: (x.topics ?? []).includes(TOPIC)
  };
}
async function repoInfo(gh, owner, name) {
  const r = await gh.request("GET", repoPath({ owner, name }), void 0, [404]);
  if (r.status === 404) throw new GitchatError(`${owner}/${name} was not found, or this sign-in cannot see it.`, "not-found");
  return summary(r.data);
}
async function createRepo(gh, name, isPrivate) {
  const clean = name.trim();
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(clean)) {
    throw new GitchatError('Repository names can only use letters, numbers, ".", "-" and "_".', "invalid");
  }
  const r = await gh.request("POST", "/user/repos", {
    name: clean,
    private: isPrivate,
    auto_init: false,
    description: "AI chat archive managed by gitchat",
    has_issues: false,
    has_projects: false,
    has_wiki: false
  }).catch((e) => {
    if (e instanceof GitchatError && e.code === "invalid" && /already exists/i.test(e.message)) {
      throw new GitchatError(`You already have a repository named ${clean}. Pick it from the list or choose another name.`, "repo-exists");
    }
    throw e;
  });
  return bootstrapRepo(gh, { owner: r.data.owner.login, name: r.data.name }, r.data.default_branch);
}
async function useRepo(gh, owner, name, branch) {
  const info = await gh.request("GET", repoPath({ owner, name }), void 0, [404]);
  if (info.status === 404) throw new GitchatError(`${owner}/${name} was not found, or this sign-in cannot see it.`, "not-found");
  if (info.data.permissions && !info.data.permissions.push) throw new GitchatError(`You don't have permission to push to ${owner}/${name}.`, "forbidden");
  const ref = { owner: info.data.owner.login, name: info.data.name, branch: branch || info.data.default_branch || "main" };
  const head = await getHead(gh, ref);
  if (!head) return bootstrapRepo(gh, ref, ref.branch);
  if (!await isManaged(gh, ref, head)) {
    throw new GitchatError(`${ref.owner}/${ref.name} already has files that gitchat did not create. Choose an empty repository, or let gitchat create a new one.`, "repo-not-empty");
  }
  return ref;
}
async function bootstrapRepo(gh, repo, fallbackBranch) {
  const ref = async () => {
    const info = await gh.request("GET", repoPath(repo));
    return { owner: repo.owner, name: repo.name, branch: info.data.default_branch || fallbackBranch || "main" };
  };
  try {
    await putFile(gh, repo, "README.md", README, "Initialize gitchat archive");
  } catch (e) {
    const current = await ref().catch(() => null);
    if (!current || !await getHead(gh, current).catch(() => null)) throw e;
    return current;
  }
  await gh.request("PUT", `${repoPath(repo)}/topics`, { names: [TOPIC] }).catch(() => void 0);
  return ref();
}
async function isManaged(gh, repo, head) {
  const index = await getTreeIndex(gh, repo, head.tree);
  const readme = index.entries.get("README.md");
  if (readme && (await getBlobText(gh, repo, readme)).includes(README_MARKER)) return true;
  const chats = [...index.entries].filter(([p]) => SERVICE_DIRS.some((d) => p.startsWith(`${d}/`)) && p.endsWith(".md")).slice(0, 3);
  for (const [, sha] of chats) {
    if (parseFrontMatter(await getBlobText(gh, repo, sha)).gitchat !== void 0) return true;
  }
  return false;
}

// src/background/sync.ts
var MAX_ATTEMPTS = 4;
async function pushCommits(gh, repo, items, getChat) {
  for (let attempt = 1; ; attempt++) {
    const head = await ensureHead(gh, repo);
    try {
      return await pushOnto(gh, repo, head, items, getChat);
    } catch (e) {
      if (e instanceof GitchatError && e.code === "non-fast-forward" && attempt < MAX_ATTEMPTS) continue;
      throw e;
    }
  }
}
async function ensureHead(gh, repo) {
  const head = await getHead(gh, repo);
  if (head) return head;
  await bootstrapRepo(gh, repo, repo.branch);
  const after = await getHead(gh, repo);
  if (!after) throw new GitchatError("Could not initialize the repository.", "github");
  return after;
}
async function pushOnto(gh, repo, head, items, getChat) {
  const index = await getTreeIndex(gh, repo, head.tree);
  const out = { pushed: /* @__PURE__ */ new Map(), superseded: /* @__PURE__ */ new Set(), chats: /* @__PURE__ */ new Map() };
  const targets = /* @__PURE__ */ new Map();
  const claimed = /* @__PURE__ */ new Set();
  let parent = head.commit;
  let tree = head.tree;
  for (const { commit: c, doc } of items) {
    let target = targets.get(c.key);
    if (!target) {
      target = await resolveTarget(gh, repo, head, index, doc, await getChat(c.key), claimed);
      targets.set(c.key, target);
      claimed.add(target.path);
    }
    const theirs = target.theirs;
    const next = theirs ? combine(doc, theirs, target.base) : doc;
    if (theirs && !target.written && sameContent(next.messages, theirs.messages)) {
      out.superseded.add(c.id);
      out.chats.set(c.key, { path: target.path, remoteBlob: theirs.sha, messages: theirs.messages, capturedAt: theirs.front.captured || doc.capturedAt, merged: true });
      continue;
    }
    const files = renderChat(next, target.path);
    const nextTree = await createTree(gh, repo, tree, await Promise.all(files.map((f) => toEntry(gh, repo, f))));
    if (nextTree !== tree) {
      parent = await createCommit(gh, repo, c.message, nextTree, [parent]);
      tree = nextTree;
    }
    target.written = true;
    out.pushed.set(c.id, parent);
    out.chats.set(c.key, { path: target.path, remoteBlob: await gitBlobSha(files[0].content), messages: next.messages, capturedAt: next.capturedAt, merged: !!theirs });
  }
  if (parent !== head.commit) await updateRef(gh, repo, parent);
  return out;
}
async function resolveTarget(gh, repo, head, index, doc, rec, claimed) {
  let path;
  let copy = null;
  if (rec?.pathConfirmed && rec.path) {
    path = rec.path;
  } else {
    copy = await findChat(gh, repo, head, index, doc.service, doc.chatId);
    if (!copy) {
      const existing = new Set(await candidatePaths(gh, repo, head, index, doc.service));
      const taken = (p) => existing.has(p) || claimed.has(p);
      path = rec?.path && !taken(rec.path) ? rec.path : freePath(doc.service, doc.title, doc.chatId, doc.createdAt, taken);
      return { path, base: null, written: false };
    }
    path = copy.path;
  }
  const knowsBase = path === rec?.path && !!rec.remoteBlob;
  const sha = copy?.sha ?? await findEntry(gh, repo, head, index, path);
  if (!sha || knowsBase && rec && sha === rec.remoteBlob && bodyMatchesBase(doc, rec)) return { path, base: null, written: false };
  return {
    path,
    theirs: copy ?? await readCopy(gh, repo, head, index, path, sha),
    base: knowsBase && rec.baseRefs ? hashesOf(rec.baseRefs) : null,
    written: false
  };
}
function combine(doc, theirs, base) {
  const oursWins = oursIsNewer(doc, theirs.front);
  const theirCapture = theirs.front.captured ?? "";
  const theirCreated = theirs.front.created ?? "";
  return {
    ...doc,
    title: oursWins ? doc.title : theirs.front.title || doc.title,
    capturedAt: Date.parse(theirCapture) > Date.parse(doc.capturedAt) ? theirCapture : doc.capturedAt,
    createdAt: Date.parse(theirCreated) < Date.parse(doc.createdAt) ? theirCreated : doc.createdAt,
    messages: threeWayMerge(base, doc.messages, theirs.messages, oursWins)
  };
}
function bodyMatchesBase(doc, rec) {
  const base = rec.baseRefs;
  if (!base || base.length !== doc.messages.length) return false;
  return doc.messages.every((m, i) => m.id === base[i].id && messageHash(m) === base[i].hash);
}
function sameContent(a, b) {
  return a.length === b.length && a.every((m, i) => m.id === b[i].id && messageHash(m) === messageHash(b[i]));
}
function oursIsNewer(doc, theirs) {
  if (theirs.gitchat === void 0) return true;
  const ours = Date.parse(doc.capturedAt);
  const other = Date.parse(theirs.captured ?? "");
  if (Number.isNaN(other)) return true;
  if (Number.isNaN(ours)) return false;
  if (ours !== other) return ours > other;
  return doc.messages.length >= Number(theirs.messages ?? 0);
}
async function toEntry(gh, repo, f) {
  if (f.encoding === "utf8") return { path: f.path, mode: "100644", type: "blob", content: f.content };
  return { path: f.path, mode: "100644", type: "blob", sha: await createBlob(gh, repo, f.content) };
}
var blobTexts = /* @__PURE__ */ new Map();
async function blobText(gh, repo, sha) {
  const hit = blobTexts.get(sha);
  if (hit !== void 0) return hit;
  const text = await getBlobText(gh, repo, sha);
  if (blobTexts.size > 32) blobTexts.delete(blobTexts.keys().next().value);
  blobTexts.set(sha, text);
  return text;
}
async function readCopy(gh, repo, head, index, path, sha) {
  const { front, messages } = parseChatFile(await blobText(gh, repo, sha));
  const fetchAsset = async (name) => {
    const assetSha = await findEntry(gh, repo, head, index, `${assetDir(path)}/${name}`);
    return assetSha ? { data: await getBlobBase64(gh, repo, assetSha), sha: assetSha } : null;
  };
  const live = [];
  for (const m of messages) live.push(await materializeAssets(m, fetchAsset));
  return { path, sha, front, messages: live };
}
async function candidatePaths(gh, repo, head, index, service2) {
  if (!index.truncated) return index.entries.keys();
  const prefix = `${service2}/`;
  const known = [...index.entries.keys()].filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"));
  const listed = await listServiceBlobs(gh, repo, head.tree, service2);
  return [.../* @__PURE__ */ new Set([...known, ...listed])];
}
async function listServiceBlobs(gh, repo, rootTree, dir) {
  const root = await gh.request("GET", `${repoPath(repo)}/git/trees/${rootTree}`);
  const sub = (root.data.tree ?? []).find((e) => e.path === dir && e.type === "tree");
  if (!sub) return [];
  const inner = await gh.request("GET", `${repoPath(repo)}/git/trees/${sub.sha}`);
  return (inner.data.tree ?? []).filter((e) => e.type === "blob").map((e) => `${dir}/${e.path}`);
}
async function findChat(gh, repo, head, index, service2, chatId) {
  const paths = await candidatePaths(gh, repo, head, index, service2);
  for (const path of chatFileCandidates(paths, service2, chatId)) {
    const sha = await findEntry(gh, repo, head, index, path);
    if (!sha) continue;
    const front = parseFrontMatter(await blobText(gh, repo, sha));
    if (front.service === service2 && front.id === chatId) return readCopy(gh, repo, head, index, path, sha);
  }
  return null;
}
async function findRemoteChat(gh, repo, service2, chatId) {
  const head = await getHead(gh, repo);
  if (!head) return null;
  return findChat(gh, repo, head, await getTreeIndex(gh, repo, head.tree), service2, chatId);
}

// src/background/engine.ts
var RECENT_COMMITS = 12;
var REMOTE_MISS_TTL = 5 * 6e4;
var INIT_IDLE_MS = 2 * 6e4;
var RETRYABLE = /* @__PURE__ */ new Set(["network", "rate-limit", "github", "non-fast-forward", "conflict"]);
var REPO_META = "repo";
function splitKey(key2) {
  const i = key2.indexOf(":");
  return { service: key2.slice(0, i), chatId: key2.slice(i + 1) };
}
var inRepo = (c, repo) => c.repo === repo || c.repo === null;
var isPending = (c, repo) => !c.pushed && !c.superseded && inRepo(c, repo);
var isOlder = (a, b) => !!b && Date.parse(a) < Date.parse(b);
var later = (a, b) => isOlder(a, b) ? b : a;
var Engine = class {
  constructor(deps) {
    this.deps = deps;
  }
  deps;
  inits = /* @__PURE__ */ new Map();
  initsLoaded = null;
  initSaving = Promise.resolve();
  chatErrors = /* @__PURE__ */ new Map();
  remoteMisses = /* @__PURE__ */ new Map();
  adopting = /* @__PURE__ */ new Set();
  pushing = null;
  /** Work requested while a push was running: a manual push, or an automatic one. */
  again = { manual: false, auto: false };
  pushTimer;
  /** Staged items per chat as of a record revision (status is asked for often; hashing a long chat is not free). */
  stagedMemo = /* @__PURE__ */ new Map();
  queue = Promise.resolve();
  repoQueue = Promise.resolve();
  now() {
    return (this.deps.now ?? Date.now)();
  }
  iso() {
    return new Date(this.now()).toISOString();
  }
  /** Runs chat mutations one at a time. */
  exclusive(fn) {
    const run2 = this.queue.then(fn, fn);
    this.queue = run2.catch(() => void 0);
    return run2;
  }
  /** Pushing and switching repositories never overlap (a push must finish against the repository it started with). */
  withRepoLock(fn) {
    const run2 = this.repoQueue.then(fn, fn);
    this.repoQueue = run2.catch(() => void 0);
    return run2;
  }
  async currentRepo() {
    return repoId((await this.deps.settings.get()).repo);
  }
  /** Aligns stored state with the chosen repository before working with it (it may have changed elsewhere). */
  async ensureRepo() {
    const repo = await this.currentRepo();
    if (repo === null || await this.deps.db.getMeta(REPO_META) === repo) return;
    await this.withRepoLock(async () => this.syncRepoLocked(await this.currentRepo()));
  }
  // ---- chats
  async open(p) {
    const key2 = chatKey(p.service, p.chatId);
    const known = await this.exclusive(async () => {
      const rec = await this.deps.db.getChat(key2);
      if (rec && (rec.url !== p.url || p.title && rec.title !== p.title)) {
        rec.url = p.url || rec.url;
        rec.title = p.title || rec.title;
        rec.updatedAt = this.now();
        await this.saveChat(rec);
      }
      return !!rec;
    });
    if (!known) void this.adoptRemote(key2, p);
    return this.status(key2);
  }
  /**
   * A chat saved by another device is tracked here too, continuing from the repository's copy. The
   * lookup is network work outside any lock; the result is only stored if the repository it came
   * from is still the chosen one (otherwise it is looked up again in the new one).
   */
  async adoptRemote(key2, p) {
    const missedAt = this.remoteMisses.get(key2);
    if (this.adopting.has(key2) || missedAt !== void 0 && this.now() - missedAt < REMOTE_MISS_TTL) return;
    this.adopting.add(key2);
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const { repo } = await this.deps.settings.get();
        if (!repo) return;
        const id = repoId(repo);
        const gh = await this.deps.github().catch(() => null);
        if (!gh) return;
        const found = await findRemoteChat(gh, repo, p.service, p.chatId);
        const result2 = await this.withRepoLock(async () => {
          if (await this.currentRepo() !== id) return "stale";
          await this.syncRepoLocked(id);
          if (!found) {
            this.remoteMisses.set(key2, this.now());
            return "missing";
          }
          return this.exclusive(async () => {
            if (await this.deps.db.getChat(key2)) return "known";
            const at = this.iso();
            await this.saveChat({
              key: key2,
              service: p.service,
              chatId: p.chatId,
              url: p.url,
              title: p.title || found.front.title || "",
              tracked: true,
              repo: id,
              path: found.path,
              pathConfirmed: true,
              remoteBlob: found.sha,
              baseRefs: refsOf(found.messages),
              createdAt: found.front.created || at,
              capturedAt: found.front.captured || at,
              messages: found.messages,
              committed: refsOf(found.messages),
              // Baseline for the next page read: the adopted text, not "this device edited it".
              pageReads: seedPageReads(found.messages, this.now()),
              settled: true,
              updatedAt: this.now()
            });
            return "adopted";
          });
        });
        if (result2 === "adopted") await this.emitStatus(key2);
        if (result2 !== "stale") return;
      }
    } catch (e) {
      log.debug("remote lookup failed", e);
    } finally {
      this.adopting.delete(key2);
    }
  }
  /**
   * Applies a capture of a tracked chat. A capture read from the page before one we already applied
   * is ignored (captures can arrive out of order). Auto-commit only runs once the AI finished answering.
   * A capture that cannot be placed safely changes nothing. The reply asks the page to read the whole
   * chat again (`fullRead`), including a branch seen away from the bottom. A capture taken while the
   * AI is still answering (`sent`) does not.
   */
  async snapshot(snap, reason = "answered") {
    const key2 = chatKey(snap.service, snap.chatId);
    await this.ensureRepo();
    const messages = uniqueIds(await withAssetShas(snap.messages));
    let fullRead = false;
    const committed = await this.exclusive(async () => {
      const rec = await this.deps.db.getChat(key2);
      if (!rec?.tracked || isOlder(snap.capturedAt, rec.seenAt)) return false;
      const reads = pageReadsOf(rec);
      const baseline = isAdoptedBaseline(reads);
      const merged = baseline ? { ok: true, messages: keepAdoptedBodies(rec.messages, messages) } : mergeSnapshot(rec.messages, { ...snap, messages }, reads);
      if (!merged.ok) {
        if (merged.code === "ambiguous") fullRead = reason !== "sent";
        else this.chatErrors.set(key2, merged.message);
        return false;
      }
      this.chatErrors.delete(key2);
      rec.messages = merged.messages;
      const readView = baseline ? snap.view ?? { id: "page" } : snap.view;
      rec.pageReads = recordReads(baseline ? stripAdoptedMark(reads) : reads, messages, merged.messages, readView, this.now());
      delete rec.seen;
      rec.settled = reason !== "sent";
      rec.capturedAt = snap.capturedAt || this.iso();
      rec.seenAt = rec.capturedAt;
      rec.title = snap.title || rec.title;
      rec.url = snap.url || rec.url;
      rec.updatedAt = this.now();
      await this.saveChat(rec);
      return reason === "answered" && await this.autoCommit(rec);
    });
    if (committed) this.afterCommit();
    const status = await this.emitStatus(key2);
    return fullRead ? { ...status, fullRead: true } : status;
  }
  // ---- init (tracking a chat, or rescanning a tracked one: one complete capture of its history)
  loadInits() {
    return this.initsLoaded ??= (async () => {
      const stored = await this.deps.initStore?.load().catch(() => []) ?? [];
      for (const s of stored) {
        if (this.inits.has(s.key)) continue;
        const session = { id: s.id, progress: s.progress, touchedAt: s.touchedAt, base: new Map(s.base) };
        if (s.owner) session.owner = s.owner;
        this.inits.set(s.key, session);
      }
    })();
  }
  persistInits() {
    const store = this.deps.initStore;
    if (!store) return;
    const list = [...this.inits].map(([key2, s]) => ({ key: key2, id: s.id, ...s.owner ? { owner: s.owner } : {}, progress: s.progress, touchedAt: s.touchedAt, base: [...s.base] }));
    this.initSaving = this.initSaving.then(() => store.save(list)).catch(() => void 0);
  }
  activeInit(key2) {
    const s = this.inits.get(key2);
    if (s && this.now() - s.touchedAt > INIT_IDLE_MS) {
      this.endInit(key2, s.id);
      return void 0;
    }
    return s;
  }
  /** Ends the init `id` (only that one: a newer init of the same chat is left alone). */
  endInit(key2, id) {
    const s = this.inits.get(key2);
    if (!s || id !== void 0 && s.id !== id) return;
    this.inits.delete(key2);
    this.persistInits();
  }
  /** The session `initId` of `key`, when it is still running and belongs to the caller. */
  ownSession(key2, initId, owner) {
    const s = this.activeInit(key2);
    if (!s || s.id !== initId || s.owner && owner && !sameOwner(s.owner, owner)) throw staleInit();
    return s;
  }
  /**
   * Starts an init owned by the calling tab; a tracked chat can be rescanned the same way. Another
   * tab's running init is not taken over. Checking and reserving happen without a pause in between,
   * so two tabs starting at once cannot both get it.
   */
  async initStart(key2, owner) {
    await this.loadInits();
    const current = this.activeInit(key2);
    if (current && !sameOwner(current.owner, owner)) throw new GitchatError("This chat is already being saved in another tab.", "busy");
    const session = { id: crypto.randomUUID(), progress: 0, touchedAt: this.now(), base: /* @__PURE__ */ new Map() };
    if (owner) session.owner = owner;
    this.inits.set(key2, session);
    this.chatErrors.delete(key2);
    await this.exclusive(async () => {
      const rec = await this.deps.db.getChat(key2);
      session.base = new Map((rec?.messages ?? []).map((m) => [m.id, messageHash(m)]));
    });
    this.persistInits();
    return { status: await this.emitStatus(key2), initId: session.id };
  }
  async initProgress(key2, initId, progress, owner) {
    await this.loadInits();
    const s = this.ownSession(key2, initId, owner);
    s.progress = Math.min(1, Math.max(0, progress));
    s.touchedAt = this.now();
    if (this.now() - (s.savedAt ?? 0) > 2e4) {
      s.savedAt = this.now();
      this.persistInits();
    }
    await this.emitStatus(key2);
    return null;
  }
  /**
   * A complete capture: the chat becomes tracked (or is replaced, for a rescan) and the differences
   * are staged. Network work (has another device saved this chat?) happens first; then, in order
   * with cancellation and every other change, the session is checked and the change applied in one
   * step, so a cancel either wins entirely or comes too late. Changes applied since the init started
   * are kept.
   */
  async initDone(snap, initId, owner) {
    const key2 = chatKey(snap.service, snap.chatId);
    await this.loadInits();
    this.ownSession(key2, initId, owner);
    await this.ensureRepo();
    const messages = uniqueIds(await withAssetShas(snap.messages));
    const lookup = (await this.deps.db.getChat(key2))?.path ? null : await this.lookupRemote(snap.service, snap.chatId);
    try {
      const committed = await this.exclusive(async () => {
        const session = this.ownSession(key2, initId, owner);
        const existing = await this.deps.db.getChat(key2);
        const reads = existing ? pageReadsOf(existing) : /* @__PURE__ */ new Map();
        const merged = mergeSnapshot(existing?.messages ?? [], { ...snap, messages, complete: true }, reads);
        if (!merged.ok) {
          this.chatErrors.set(key2, merged.message);
          return false;
        }
        const list = existing ? keepChangesSince(merged.messages, existing.messages, session.base) : merged.messages;
        const at = snap.capturedAt || this.iso();
        const rec = existing ?? {
          key: key2,
          service: snap.service,
          chatId: snap.chatId,
          url: snap.url,
          title: snap.title,
          tracked: true,
          pathConfirmed: false,
          createdAt: at,
          capturedAt: at,
          messages: [],
          committed: [],
          updatedAt: this.now()
        };
        rec.tracked = true;
        rec.messages = list;
        rec.pageReads = recordReads(reads, messages, list, snap.view, this.now());
        delete rec.seen;
        rec.settled = true;
        rec.capturedAt = later(at, rec.capturedAt);
        rec.seenAt = rec.seenAt ? later(at, rec.seenAt) : at;
        rec.url = snap.url || rec.url;
        rec.title = snap.title || rec.title;
        rec.updatedAt = this.now();
        if (!rec.path) {
          const repo = await this.currentRepo();
          placeChat(rec, repo, lookup && lookup.repo === repo ? lookup.found : null);
        }
        this.chatErrors.delete(key2);
        this.endInit(key2, initId);
        await this.saveChat(rec);
        return this.autoCommit(rec);
      });
      if (committed) this.afterCommit();
    } finally {
      this.endInit(key2, initId);
    }
    return this.emitStatus(key2);
  }
  /**
   * Ends an init. Without an id (the user pressed Cancel anywhere), whichever init runs is ended. It
   * runs in order with the init's completion: whichever comes first wins.
   */
  async initCancel(key2, initId) {
    await this.loadInits();
    await this.exclusive(async () => this.endInit(key2, initId));
    return this.emitStatus(key2);
  }
  /** A tab closed or navigated away: the inits it was running end with it. */
  async ownerGone(tabId) {
    await this.loadInits();
    const gone = await this.exclusive(async () => {
      const keys = [];
      for (const [key2, s] of [...this.inits]) {
        if (s.owner?.tabId !== tabId) continue;
        this.endInit(key2, s.id);
        keys.push(key2);
      }
      return keys;
    });
    for (const key2 of gone) await this.emitStatus(key2);
  }
  /**
   * A tracked chat as Markdown to paste elsewhere, from the working copy (what the next commit
   * saves, older history from other devices included). Read-only: nothing is staged or committed,
   * and no push or network call is needed.
   */
  async copyMarkdown(key2) {
    return this.exclusive(async () => {
      const rec = await this.deps.db.getChat(key2);
      if (!rec?.tracked) throw new GitchatError("Start saving this chat first.", "not-tracked");
      return renderCopy(rec);
    });
  }
  async untrack(key2) {
    await this.exclusive(async () => {
      const rec = await this.deps.db.getChat(key2);
      if (rec) {
        rec.tracked = false;
        rec.updatedAt = this.now();
        await this.saveChat(rec);
      }
      this.endInit(key2);
    });
    this.chatErrors.delete(key2);
    return this.emitStatus(key2);
  }
  /**
   * Whether another device already saved this chat in the chosen repository (network, so done
   * before taking the chat queue). Null when it could not be checked (offline, signed out, a failed
   * download): the push checks again.
   */
  async lookupRemote(service2, chatId) {
    try {
      const { repo } = await this.deps.settings.get();
      if (!repo) return { repo: null, found: null };
      return { repo: repoId(repo), found: await findRemoteChat(await this.deps.github(), repo, service2, chatId) };
    } catch (e) {
      log.debug("path lookup failed", e);
      return null;
    }
  }
  // ---- commits
  async commit(key2) {
    await this.ensureRepo();
    const c = await this.exclusive(async () => {
      const rec = await this.deps.db.getChat(key2);
      return rec?.tracked ? this.commitLocked(rec) : null;
    });
    if (c) this.afterCommit();
    return this.emitStatus(key2);
  }
  /** Automatic commits never split a question from its answer: the last capture must have been settled. */
  async autoCommit(rec) {
    const s = await this.deps.settings.get();
    return s.autoCommit && rec.settled !== false && !!await this.commitLocked(rec);
  }
  async commitLocked(rec) {
    const staged = diffStaged(rec.messages, rec.committed);
    if (!staged.length) return null;
    const repo = await this.currentRepo();
    rec.path ??= chatPath(rec.service, rec.title, rec.chatId, rec.createdAt);
    rec.repo ??= repo;
    const doc = { service: rec.service, chatId: rec.chatId, url: rec.url, title: rec.title, createdAt: rec.createdAt, capturedAt: rec.capturedAt, messages: rec.messages };
    rec.committed = refsOf(rec.messages);
    rec.updatedAt = this.now();
    rec.rev = (rec.rev ?? 0) + 1;
    return this.deps.db.addCommit(
      {
        id: crypto.randomUUID(),
        key: rec.key,
        repo,
        message: `${rec.service}: ${chatTitle(rec.title)} (+${staged.length})`,
        n: staged.length,
        createdAt: this.now(),
        pushed: false
      },
      doc,
      rec
    );
  }
  afterCommit() {
    void this.emitSync();
    void this.deps.settings.get().then((s) => {
      if (s.autoPush) this.schedulePush();
    });
  }
  // ---- push
  /** Commits anything staged for `key`, then pushes every pending commit of the current repository. */
  async push(key2) {
    await this.ensureRepo();
    if (key2) {
      const c = await this.exclusive(async () => {
        const rec = await this.deps.db.getChat(key2);
        return rec?.tracked ? this.commitLocked(rec) : null;
      });
      if (c) void this.emitSync();
    }
    this.cancelScheduledPush();
    await this.runPush("manual");
    return key2 ? this.emitStatus(key2) : null;
  }
  /**
   * One push at a time. A request arriving meanwhile runs right after it: a manual one always, an
   * automatic one only if auto-push is still on by then.
   */
  runPush(kind) {
    if (this.pushing) {
      this.again[kind] = true;
      return this.pushing;
    }
    const run2 = (async () => {
      try {
        for (; ; ) {
          await this.withRepoLock(() => this.pushOnce());
          if (this.again.manual) {
            this.again.manual = this.again.auto = false;
            continue;
          }
          if (!this.again.auto) break;
          this.again.auto = false;
          if (!(await this.deps.settings.get()).autoPush) break;
        }
      } finally {
        this.pushing = null;
        await this.emitAll();
        await this.emitSync();
      }
    })();
    this.pushing = run2;
    return run2;
  }
  async pushOnce() {
    const { repo } = await this.deps.settings.get();
    const id = repoId(repo);
    await this.syncRepoLocked(id);
    const commits = await this.deps.db.allCommits();
    const pending = commits.filter((c) => isPending(c, id)).sort((a, b) => a.seq - b.seq);
    if (!repo && commits.some((c) => !c.pushed && !c.superseded)) {
      const err = new GitchatError("Choose a repository in the gitchat settings first.", "no-repo");
      await this.setSyncMeta({ lastError: err.message });
      throw err;
    }
    if (!repo || !pending.length) {
      this.deps.clearRetry?.();
      return;
    }
    let outcome;
    let items;
    try {
      await this.emitAll();
      const docs = await this.deps.db.getDocs(pending.map((c) => c.id));
      items = pending.flatMap((commit) => {
        const doc = docs.get(commit.id);
        return doc ? [{ commit, doc }] : [];
      });
      const gh = await this.deps.github();
      const run2 = () => pushCommits(gh, repo, items, (k) => this.deps.db.getChat(k));
      outcome = await (this.deps.keepAlive ? this.deps.keepAlive(run2) : run2());
    } catch (e) {
      const err = toGitchatError(e);
      await this.setSyncMeta({ lastError: err.message });
      throw err;
    }
    await this.exclusive(() => this.applyPush(pending, items, outcome, id));
    await this.setSyncMeta({ lastPushAt: this.now() }, { clearWait: true });
    this.deps.clearRetry?.();
  }
  /**
   * Records a push: receipts, final paths and bases. Where the repository copy had changes from
   * another device, the chat is rebased on it: the pushed batch's last document is the common base,
   * and both the working messages and the commits made while the push ran keep their own changes.
   */
  async applyPush(pending, items, outcome, repo) {
    const sent = new Set(items.map((i) => i.commit.id));
    const batch = new Map(items.map((i) => [i.commit.key, i.doc]));
    const done = [];
    for (const c of pending) {
      const sha = outcome.pushed.get(c.id);
      if (sha) {
        c.pushed = true;
        c.sha = sha;
      } else if (outcome.superseded.has(c.id) || !sent.has(c.id)) {
        c.superseded = true;
      } else continue;
      c.repo = repo;
      done.push(c.id);
    }
    await this.deps.db.putCommits(pending);
    await this.deps.db.deleteDocs(done);
    for (const [key2, res] of outcome.chats) {
      const rec = await this.deps.db.getChat(key2);
      if (!rec) continue;
      const pushedDoc = batch.get(key2);
      if (res.merged && pushedDoc) {
        const base = hashesOf(refsOf(pushedDoc.messages));
        const newer = (at) => !isOlder(at, res.capturedAt);
        rec.messages = threeWayMerge(base, rec.messages, res.messages, newer(rec.capturedAt));
        const waiting = (await this.deps.db.commitsFor(key2)).filter((c) => !c.pushed && !c.superseded && !sent.has(c.id)).sort((a, b) => a.seq - b.seq);
        const docs = await this.deps.db.getDocs(waiting.map((c) => c.id));
        for (const doc of docs.values()) doc.messages = threeWayMerge(base, doc.messages, res.messages, newer(doc.capturedAt));
        await this.deps.db.putDocs(docs);
        const last = waiting.length ? docs.get(waiting.at(-1).id) : void 0;
        rec.committed = refsOf(last ? last.messages : res.messages);
        rec.capturedAt = later(rec.capturedAt, res.capturedAt);
      }
      rec.baseRefs = refsOf(res.messages);
      rec.repo = repo;
      rec.path = res.path;
      rec.pathConfirmed = true;
      rec.remoteBlob = res.remoteBlob;
      rec.updatedAt = this.now();
      await this.saveChat(rec);
    }
    await this.prune();
  }
  /** Keeps the most recent pushed commits per chat (for the graph); older ones live in git. */
  async prune() {
    const done = (await this.deps.db.allCommits()).filter((c) => c.pushed || c.superseded);
    const byChat = /* @__PURE__ */ new Map();
    for (const c of done) byChat.set(c.key, [...byChat.get(c.key) ?? [], c]);
    const drop = [];
    for (const list of byChat.values()) {
      const keep = new Set(
        list.filter((c) => c.pushed).sort((a, b) => b.seq - a.seq).slice(0, RECENT_COMMITS).map((c) => c.id)
      );
      for (const c of list) if (!keep.has(c.id)) drop.push(c.id);
    }
    if (drop.length) await this.deps.db.deleteCommits(drop);
  }
  schedulePush(delay = this.deps.pushDelayMs ?? 3e3) {
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = void 0;
      void this.autoPush();
    }, delay);
    this.deps.scheduleRetry?.(delay + 3e4);
  }
  /** Drops automatic work that has not started yet (a running push finishes). */
  cancelScheduledPush() {
    clearTimeout(this.pushTimer);
    this.pushTimer = void 0;
    this.again.auto = false;
  }
  /**
   * An automatic push. After a failed one the next waits (the rate limit's reset, or a growing
   * backoff); the deadline and the attempt count are stored, so a restarted worker keeps waiting
   * instead of pushing right away. A manual push does not wait.
   */
  async autoPush() {
    if (!(await this.deps.settings.get()).autoPush) {
      this.deps.clearRetry?.();
      return;
    }
    const left = await this.waitLeft();
    if (left > 0) {
      this.deps.scheduleRetry?.(left);
      return;
    }
    try {
      await this.runPush("auto");
    } catch (e) {
      const err = toGitchatError(e);
      if (!RETRYABLE.has(err.code)) return;
      const retries = ((await this.deps.db.getMeta("sync"))?.retries ?? 0) + 1;
      const wait = err instanceof RateLimitError ? err.retryAfterMs : Math.min(30 * 6e4, 3e4 * 2 ** (retries - 1));
      await this.setSyncMeta({ nextAllowedAt: this.now() + wait, retries }, { keepError: true });
      this.deps.scheduleRetry?.(wait);
    }
  }
  /** Time left before an automatic push may run again (0 when it may run now). */
  async waitLeft() {
    const until = (await this.deps.db.getMeta("sync"))?.nextAllowedAt ?? 0;
    return Math.max(0, until - this.now());
  }
  /** Woken up by the alarm: after a failed automatic push, or because the worker was restarted. */
  async retry() {
    await this.autoPush();
  }
  /** On every start of the worker, after sign-in, etc.: push what is waiting when auto-push is on. */
  async resume() {
    await this.ensureRepo();
    const s = await this.deps.settings.get();
    if (!s.autoPush || await this.pendingCount() === 0) return;
    const left = await this.waitLeft();
    if (left > 0) this.deps.scheduleRetry?.(left);
    else this.schedulePush(Math.min(1e3, this.deps.pushDelayMs ?? 1e3));
  }
  // ---- settings
  async settingsChanged(prev, next) {
    if (!next.autoPush) {
      this.cancelScheduledPush();
      if (prev.autoPush) this.deps.clearRetry?.();
    }
    const repoChanged = repoId(prev.repo) !== repoId(next.repo);
    if (repoChanged) await this.withRepoLock(() => this.syncRepoLocked(repoId(next.repo)));
    let committed = false;
    if (next.autoCommit && !prev.autoCommit) {
      committed = await this.exclusive(async () => {
        let any = false;
        for (const rec of await this.deps.db.allChats()) if (rec.tracked && await this.autoCommit(rec)) any = true;
        return any;
      });
    }
    if (next.autoPush && (committed || !prev.autoPush || repoChanged) && await this.pendingCount() > 0) this.schedulePush();
    if (committed || repoChanged) {
      await this.emitAll();
      await this.emitSync();
    }
  }
  /**
   * Makes the stored state match the chosen repository. When it changed (here, or synced from
   * another device while this worker was asleep): commits for other repositories are dropped — their
   * content is still in the chats, assets included — and chats saved to another repository are
   * staged in full again, so the next commit writes them to this one.
   */
  async syncRepoLocked(repo) {
    if (repo === null) return;
    const stored = await this.deps.db.getMeta(REPO_META);
    if (stored === repo) return;
    await this.exclusive(async () => {
      const commits = await this.deps.db.allCommits();
      const drop = commits.filter((c) => c.repo !== null && c.repo !== repo).map((c) => c.id);
      if (drop.length) await this.deps.db.deleteCommits(drop);
      for (const rec of await this.deps.db.allChats()) {
        if (rec.repo === repo) continue;
        if (rec.repo) rec.committed = [];
        rec.repo = repo;
        rec.pathConfirmed = false;
        delete rec.remoteBlob;
        delete rec.baseRefs;
        rec.updatedAt = this.now();
        await this.saveChat(rec);
      }
      await this.deps.db.setMeta(REPO_META, repo);
    });
    this.remoteMisses.clear();
    await this.clearError();
  }
  /** Forget the last push error (e.g. after signing in again). */
  async clearError() {
    await this.setSyncMeta({});
  }
  // ---- status
  async status(key2) {
    await this.loadInits();
    const [rec, all, settings, meta] = await Promise.all([
      this.deps.db.getChat(key2),
      this.deps.db.allCommits(),
      this.deps.settings.get(),
      this.deps.db.getMeta("sync")
    ]);
    const mine = all.filter((c) => c.key === key2);
    const repo = repoId(settings.repo);
    const { service: service2, chatId } = rec ?? splitKey(key2);
    const tracked = !!rec?.tracked;
    const commits = mine.filter((c) => !c.superseded && inRepo(c, repo)).sort((a, b) => b.seq - a.seq).slice(0, RECENT_COMMITS);
    const aheadHere = commits.some((c) => !c.pushed);
    const chatError = this.chatErrors.get(key2);
    const pushError = aheadHere ? meta?.lastError : void 0;
    const init = this.activeInit(key2);
    let phase = "idle";
    if (init) phase = "capturing";
    else if (this.pushing && aheadHere) phase = "pushing";
    else if (chatError || pushError) phase = "error";
    const status = {
      key: key2,
      service: service2,
      chatId,
      tracked,
      staged: tracked && rec ? this.stagedOf(rec) : [],
      commits: commits.map(toInfo),
      aheadTotal: all.filter((c) => isPending(c, repo)).length,
      phase
    };
    if (rec?.path) status.path = rec.path;
    if (init) status.progress = init.progress;
    if (phase === "error") status.error = chatError ?? pushError;
    if (rec?.path && rec.remoteBlob && rec.repo === repo && settings.repo) {
      const { owner, name, branch } = settings.repo;
      status.webUrl = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/blob/${encodePath(branch)}/${encodePath(rec.path)}`;
    }
    return status;
  }
  /** What is staged in a chat, computed once per revision of its record. */
  stagedOf(rec) {
    const hit = this.stagedMemo.get(rec.key);
    if (rec.rev !== void 0 && hit?.rev === rec.rev) return hit.staged;
    const staged = diffStaged(rec.messages, rec.committed);
    if (rec.rev !== void 0) this.stagedMemo.set(rec.key, { rev: rec.rev, staged });
    return staged;
  }
  async syncStatus() {
    const [settings, meta] = await Promise.all([this.deps.settings.get(), this.deps.db.getMeta("sync")]);
    const out = { repo: settings.repo, pending: await this.pendingCount() };
    if (meta?.lastPushAt) out.lastPushAt = meta.lastPushAt;
    if (meta?.lastError) out.lastError = meta.lastError;
    return out;
  }
  async pendingCount() {
    const repo = await this.currentRepo();
    return (await this.deps.db.allCommits()).filter((c) => isPending(c, repo)).length;
  }
  /**
   * Updates the sync meta. The last error goes unless the patch sets it (or `keepError`); the wait
   * after a failed automatic push stays until a push succeeds (`clearWait`).
   */
  async setSyncMeta(patch, opts = {}) {
    const cur = await this.deps.db.getMeta("sync") ?? {};
    const next = { ...cur, ...patch };
    if (!("lastError" in patch) && !opts.keepError) delete next.lastError;
    if (opts.clearWait) {
      delete next.nextAllowedAt;
      delete next.retries;
    }
    await this.deps.db.setMeta("sync", next);
    await this.emitSync();
  }
  /** Writes a chat record; every write gets a new revision. */
  saveChat(rec) {
    rec.rev = (rec.rev ?? 0) + 1;
    return this.deps.db.putChat(rec);
  }
  async emitStatus(key2) {
    const s = await this.status(key2);
    this.deps.emit.status(s);
    return s;
  }
  async emitSync() {
    this.deps.emit.broadcast({ type: "sync", sync: await this.syncStatus() });
  }
  /** Re-sends the status of every chat that is open somewhere. */
  async emitAll() {
    await Promise.all(this.deps.emit.shownKeys().map((k) => this.emitStatus(k)));
  }
};
function toInfo(c) {
  return c.sha ? { id: c.id, n: c.n, t: c.createdAt, pushed: c.pushed, sha: c.sha } : { id: c.id, n: c.n, t: c.createdAt, pushed: c.pushed };
}
var ADOPTED_VIEW = "\0adopted";
function seedPageReads(messages, at) {
  const out = {};
  for (const m of messages) out[m.id] = { h: messageHash(m), at, v: [ADOPTED_VIEW] };
  return out;
}
function isAdoptedBaseline(reads) {
  if (reads.size === 0) return false;
  for (const r of reads.values()) {
    if (!r.h || r.v?.length !== 1 || r.v[0] !== ADOPTED_VIEW) return false;
  }
  return true;
}
function stripAdoptedMark(reads) {
  const next = /* @__PURE__ */ new Map();
  for (const [id, r] of reads) {
    const v = (r.v ?? []).filter((x) => x !== ADOPTED_VIEW);
    const copy = { h: r.h, at: r.at };
    if (v.length) copy.v = v;
    if (r.hv && Object.keys(r.hv).length) copy.hv = { ...r.hv };
    next.set(id, copy);
  }
  return next;
}
function keepAdoptedBodies(adopted, page) {
  const byId = new Map(adopted.map((m) => [m.id, m]));
  return unionMessages(
    page.map((m) => {
      const old = byId.get(m.id);
      return old ? keepArtifacts(m, old) : m;
    }),
    adopted
  );
}
function pageReadsOf(rec) {
  if (rec.pageReads) return new Map(Object.entries(rec.pageReads));
  return new Map((rec.seen ?? rec.messages.map((m) => m.id)).map((id) => [id, { h: "", at: 0 }]));
}
function placeChat(rec, repo, found) {
  rec.path = chatPath(rec.service, rec.title, rec.chatId, rec.createdAt);
  rec.pathConfirmed = false;
  rec.repo = repo;
  if (!found) return;
  rec.path = found.path;
  rec.pathConfirmed = true;
  rec.remoteBlob = found.sha;
  rec.baseRefs = refsOf(found.messages);
  rec.createdAt = found.front.created || rec.createdAt;
  const theirs = new Map(found.messages.map((m) => [m.id, m]));
  const ours = new Map(rec.messages.map((m) => [m.id, m]));
  if (oursIsNewer(rec, found.front)) {
    rec.messages = rec.messages.map((m) => theirs.has(m.id) ? keepArtifacts(theirs.get(m.id), m) : m);
  } else {
    rec.messages = unionMessages(
      found.messages.map((m) => ours.has(m.id) ? keepArtifacts(ours.get(m.id), m) : m),
      rec.messages
    );
  }
  rec.committed = refsOf(found.messages);
}
function sameOwner(a, b) {
  if (!a || !b) return !a && !b;
  return a.tabId === b.tabId && (!a.documentId || !b.documentId || a.documentId === b.documentId);
}
function staleInit(message = "This capture was cancelled or replaced. Start again.") {
  return new GitchatError(message, "stale-init");
}
async function withAssetShas(messages) {
  return Promise.all(
    messages.map(
      async (m) => m.assets?.length ? { ...m, assets: await Promise.all(m.assets.map(async (a) => ({ ...a, sha: await gitBlobSha(a.data, a.encoding) }))) } : m
    )
  );
}

// src/background/validate.ts
var LIMITS = {
  id: 512,
  text: 4096,
  messages: 2e4,
  markdown: 2e6,
  assets: 32,
  /** Characters of one asset (HTML text or base64). */
  asset: 16e6,
  /** Characters of a whole snapshot (Chrome messages are capped at 64 MB). */
  snapshot: 48e6
};
function fail(what) {
  throw new GitchatError(`Invalid request: ${what}.`, "invalid");
}
function obj(v, what) {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail(what);
  return v;
}
function str(v, what, max = LIMITS.text, min = 0) {
  if (typeof v !== "string" || v.length > max || v.length < min) fail(what);
  return v;
}
function bool(v, what) {
  if (typeof v !== "boolean") fail(what);
}
function service(v) {
  if (!SERVICES.includes(v)) fail("service");
  return v;
}
function key(v) {
  const k = str(v, "chat key", LIMITS.id + 16, 3);
  const i = k.indexOf(":");
  if (i <= 0 || i === k.length - 1) fail("chat key");
  return service(k.slice(0, i));
}
function iso(v, what) {
  if (Number.isNaN(Date.parse(str(v, what, 64, 1)))) fail(what);
}
function snapshot(v) {
  const s = obj(v, "snapshot");
  const svc = service(s.service);
  str(s.chatId, "chat id", LIMITS.id, 1);
  str(s.url, "url");
  str(s.title, "title");
  iso(s.capturedAt, "capture time");
  bool(s.complete, "complete");
  if (s.atEnd !== void 0) bool(s.atEnd, "atEnd");
  if (s.startConfirmed !== void 0) bool(s.startConfirmed, "startConfirmed");
  if (s.view !== void 0) {
    const view = obj(s.view, "view");
    str(view.id, "view id", 64, 1);
    if (typeof view.since !== "number" || !Number.isFinite(view.since)) fail("view");
  }
  if (!Array.isArray(s.messages) || s.messages.length > LIMITS.messages) fail("messages");
  let size = 0;
  for (const raw of s.messages) {
    const m = obj(raw, "message");
    str(m.id, "message id", LIMITS.id, 1);
    if (m.role !== "user" && m.role !== "assistant") fail("message role");
    size += str(m.markdown, "message text", LIMITS.markdown).length;
    if (m.kinds !== void 0 && (!Array.isArray(m.kinds) || m.kinds.length > 16 || m.kinds.some((k) => typeof k !== "string" || k.length > 32))) fail("message kinds");
    if (m.assets === void 0) continue;
    if (!Array.isArray(m.assets) || m.assets.length > LIMITS.assets) fail("message assets");
    for (const rawAsset of m.assets) {
      const a = obj(rawAsset, "asset");
      str(a.name, "asset name", 200, 1);
      str(a.mime, "asset type", 200);
      size += str(a.data, "asset data", LIMITS.asset).length;
      if (a.encoding !== "utf8" && a.encoding !== "base64") fail("asset encoding");
    }
  }
  if (size > LIMITS.snapshot) fail("snapshot size");
  return svc;
}
function validatePayload(type, payload) {
  const p = obj(payload ?? {}, "payload");
  switch (type) {
    case "chat/open":
      str(p.chatId, "chat id", LIMITS.id, 1);
      str(p.url, "url");
      str(p.title, "title");
      return service(p.service);
    case "chat/snapshot":
      if (p.reason !== void 0 && !["sent", "answered", "manual"].includes(p.reason)) fail("reason");
      return snapshot(p.snapshot);
    case "chat/init/done":
      str(p.initId, "init id", 64, 1);
      return snapshot(p.snapshot);
    case "chat/init/progress":
      str(p.initId, "init id", 64, 1);
      if (typeof p.progress !== "number" || !Number.isFinite(p.progress)) fail("progress");
      return key(p.key);
    case "chat/init/cancel":
      if (p.initId !== void 0) str(p.initId, "init id", 64, 1);
      return key(p.key);
    case "chat/status":
    case "chat/init/start":
    case "chat/commit":
    case "chat/markdown":
    case "chat/untrack":
      return key(p.key);
    case "chat/push":
      return p.key === void 0 ? null : key(p.key);
    case "settings/set":
      obj(p.patch, "settings");
      return null;
    case "auth/pat":
      str(p.token, "token", 1e3);
      return null;
    case "repo/create":
      str(p.name, "repository name", 100);
      bool(p.private, "private");
      return null;
    case "repo/info":
      str(p.owner, "owner", 100, 1);
      str(p.name, "repository name", 100, 1);
      return null;
    case "repo/use":
      str(p.owner, "owner", 100, 1);
      str(p.name, "repository name", 100, 1);
      if (p.branch !== void 0) str(p.branch, "branch", 255);
      return null;
    default:
      return null;
  }
}
var SITE_SERVICES = {
  "https://chatgpt.com": "chatgpt",
  "https://claude.ai": "claude",
  "https://gemini.google.com": "gemini",
  "https://grok.com": "grok"
};
function isTopDocument(sender) {
  if (sender.documentLifecycle === "prerender") return false;
  if (sender.frameType) return sender.frameType === "outermost_frame";
  return sender.frameId === 0;
}
function senderService(sender) {
  if (!sender || !isTopDocument(sender)) return null;
  let origin = sender.origin;
  if (!origin && sender.url) {
    try {
      origin = new URL(sender.url).origin;
    } catch {
      return null;
    }
  }
  return origin && SITE_SERVICES[origin] || null;
}

// src/background/events.ts
var Events = class {
  constructor(isExtensionPage, onTabGone = () => void 0) {
    this.isExtensionPage = isExtensionPage;
    this.onTabGone = onTabGone;
  }
  isExtensionPage;
  onTabGone;
  /** Port → tab id (undefined for extension pages). */
  ports = /* @__PURE__ */ new Map();
  tabChats = /* @__PURE__ */ new Map();
  /** Accepts ports from extension pages and from the top frame of the supported chat sites only. */
  attach(port) {
    const page = this.isExtensionPage(port.sender);
    if (!page && !senderService(port.sender)) {
      port.disconnect();
      return false;
    }
    const tabId = page ? void 0 : port.sender?.tab?.id;
    this.ports.set(port, tabId);
    port.onDisconnect.addListener(() => {
      this.ports.delete(port);
      if (tabId !== void 0 && ![...this.ports.values()].includes(tabId)) {
        this.tabChats.delete(tabId);
        this.onTabGone(tabId);
      }
    });
    return true;
  }
  setTabChat(tabId, key2) {
    this.tabChats.set(tabId, key2);
  }
  status(status) {
    for (const [port, tabId] of this.ports) {
      if (tabId === void 0 || this.tabChats.get(tabId) === status.key) this.post(port, { type: "status", status });
    }
  }
  broadcast(event) {
    for (const port of this.ports.keys()) this.post(port, event);
  }
  shownKeys() {
    return [...new Set(this.tabChats.values())];
  }
  post(port, event) {
    try {
      port.postMessage(event);
    } catch {
      this.ports.delete(port);
    }
  }
};

// src/background/github/auth.ts
var DEFAULT_CLIENT_ID = "";
var AUTH_KEY = "auth";
var PENDING_KEY = "deviceFlow";
var DEVICE_CODE_URL = "https://github.com/login/device/code";
var TOKEN_URL = "https://github.com/login/oauth/access_token";
var SCOPE = "repo";
async function restrictStorage() {
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  } catch (error) {
    try {
      await chrome.storage.local.remove(AUTH_KEY);
    } catch (removeError) {
      throw new AggregateError(
        [error, removeError],
        "Could not restrict token storage to trusted contexts, and the saved token could not be removed."
      );
    }
    throw error;
  }
}
async function loadAuth() {
  await restrictStorage();
  const got = await chrome.storage.local.get(AUTH_KEY);
  const a = got[AUTH_KEY];
  return a?.token ? a : null;
}
async function saveAuth(a) {
  await restrictStorage();
  await chrome.storage.local.set({ [AUTH_KEY]: a });
}
async function clearAuth() {
  await chrome.storage.local.remove(AUTH_KEY);
}
async function identify(token, opts = {}) {
  const t = token.trim();
  if (!t) throw new GitchatError("Paste a token first.", "invalid");
  await restrictStorage();
  const r = await new GitHub(t, opts).request("GET", "/user");
  const scopes = (r.headers.get("x-oauth-scopes") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return { login: r.data.login, scopes };
}
var DeviceFlow = class {
  constructor(fetchImpl = (input, init) => fetch(input, init), sleep = defaultSleep, now = () => Date.now()) {
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
    this.now = now;
  }
  fetchImpl;
  sleep;
  now;
  generation = 0;
  async start(clientId) {
    if (!clientId) {
      throw new GitchatError('"Sign in with GitHub" is not available in this build. Use a personal access token, or set an OAuth client ID under Advanced.', "no-client-id");
    }
    const generation = this.generation;
    await restrictStorage();
    if (generation !== this.generation) throw new GitchatError("The sign-in was cancelled.", "cancelled");
    const data = await this.post(DEVICE_CODE_URL, { client_id: clientId, scope: SCOPE });
    if (generation !== this.generation) throw new GitchatError("The sign-in was cancelled.", "cancelled");
    if (!data.device_code || !data.user_code || !data.verification_uri) throw signInError(data);
    const expiresIn = Number(data.expires_in) || 900;
    const pending = { id: crypto.randomUUID(), clientId, deviceCode: data.device_code, interval: Number(data.interval) || 5, expiresAt: this.now() + expiresIn * 1e3 };
    this.generation++;
    await chrome.storage.session.set({ [PENDING_KEY]: pending });
    return { userCode: data.user_code, verificationUri: data.verification_uri, expiresIn, interval: pending.interval };
  }
  /**
   * Polls GitHub until the user approves the code. Returns the access token and the attempt it
   * belongs to; the caller saves the token only if `claim(flowId)` still succeeds afterwards.
   */
  async wait() {
    const generation = this.generation;
    const p = (await chrome.storage.session.get(PENDING_KEY))[PENDING_KEY];
    if (!p) throw new GitchatError("The sign-in expired. Start again.", "expired");
    await restrictStorage();
    const cancelled = () => new GitchatError("The sign-in was cancelled.", "cancelled");
    if (generation !== this.generation) throw cancelled();
    let interval = p.interval;
    while (this.now() < p.expiresAt) {
      await this.sleep(interval * 1e3);
      if (generation !== this.generation) throw cancelled();
      const data = await this.post(TOKEN_URL, { client_id: p.clientId, device_code: p.deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" });
      if (generation !== this.generation) throw cancelled();
      if (data.access_token) return { token: data.access_token, flowId: p.id };
      if (data.error === "authorization_pending") continue;
      if (data.error === "slow_down") {
        interval = Number(data.interval) || interval + 5;
        continue;
      }
      await chrome.storage.session.remove(PENDING_KEY);
      if (data.error === "expired_token") throw new GitchatError("The sign-in code expired. Start again.", "expired");
      if (data.error === "access_denied") throw new GitchatError("Sign-in was cancelled on GitHub.", "denied");
      throw signInError(data);
    }
    await chrome.storage.session.remove(PENDING_KEY);
    throw new GitchatError("The sign-in code expired. Start again.", "expired");
  }
  /** Ends the pending sign-in (cancel, sign-out, or a token signed in instead): its approval is ignored. */
  async cancel() {
    this.generation++;
    await chrome.storage.session.remove(PENDING_KEY);
  }
  /** True (once) when `flowId` is still the pending sign-in; a stale approval returns false. */
  async claim(flowId) {
    const p = (await chrome.storage.session.get(PENDING_KEY))[PENDING_KEY];
    if (p?.id !== flowId) return false;
    await chrome.storage.session.remove(PENDING_KEY);
    return true;
  }
  async post(url, params) {
    let res;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params).toString()
      });
    } catch (e) {
      throw new GitchatError(`Could not reach GitHub (${e.message}).`, "network");
    }
    const data = await res.json().catch(() => ({})) ?? {};
    if (!res.ok && !data.error) data.error = `http_${res.status}`;
    return data;
  }
};
function signInError(data) {
  if (data.error === "device_flow_disabled") return new GitchatError("Device sign-in is turned off for this OAuth app.", "device-flow-disabled");
  if (data.error === "incorrect_client_credentials" || data.error === "http_404" || data.error === "Not Found") {
    return new GitchatError("The OAuth client ID is not valid.", "no-client-id");
  }
  return new GitchatError(data.error_description || data.error || "GitHub sign-in failed.", "auth");
}

// src/background/keepalive.ts
async function keepAlive(fn) {
  const timer = setInterval(() => void chrome.runtime.getPlatformInfo(), 2e4);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}

// src/background/router.ts
var PAGE_ONLY = /* @__PURE__ */ new Set(["auth/get", "auth/device/start", "auth/device/wait", "auth/device/cancel", "auth/pat", "auth/signout", "repo/list", "repo/info", "repo/create", "repo/use"]);
var WIDGET_SETTINGS = [
  ["autoCommit", "boolean"],
  ["autoPush", "boolean"],
  ["widget", "string"]
];
async function dispatch(handlers, env, ctx) {
  try {
    const handler = handlers[env.type];
    if (!handler) throw new GitchatError(`Unknown request "${env.type}".`, "invalid");
    if (!ctx.fromExtensionPage && !ctx.service) throw new GitchatError("Requests are only accepted from gitchat and the supported chat sites.", "forbidden");
    if (PAGE_ONLY.has(env.type) && !ctx.fromExtensionPage) throw new GitchatError("This request is only allowed from the extension pages.", "forbidden");
    let payload = env.payload ?? {};
    const about = validatePayload(env.type, payload);
    if (!ctx.fromExtensionPage && about && about !== ctx.service) throw new GitchatError("A page can only act on its own chats.", "forbidden");
    if (env.type === "settings/set" && !ctx.fromExtensionPage) {
      const patch = payload.patch ?? {};
      payload = { patch: Object.fromEntries(WIDGET_SETTINGS.filter(([k, type]) => typeof patch[k] === type).map(([k]) => [k, patch[k]])) };
    }
    return { ok: true, data: await handler(payload, ctx) };
  } catch (e) {
    const err = toGitchatError(e);
    return { ok: false, error: err.message, code: err.code };
  }
}

// src/background/store/db.ts
var VERSION = 3;
function result(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function finished(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}
async function openDb(name = "gitchat") {
  const db = await new Promise((resolve, reject) => {
    const r = indexedDB.open(name, VERSION);
    r.onupgradeneeded = (e) => {
      const d = r.result;
      if (e.oldVersion < 3) for (const s of [...d.objectStoreNames]) d.deleteObjectStore(s);
      if (!d.objectStoreNames.contains("chats")) d.createObjectStore("chats", { keyPath: "key" });
      if (!d.objectStoreNames.contains("commits")) d.createObjectStore("commits", { keyPath: "id" }).createIndex("key", "key");
      if (!d.objectStoreNames.contains("docs")) d.createObjectStore("docs");
      if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const read = (store, fn) => result(fn(db.transaction(store, "readonly").objectStore(store)));
  const write = (stores, fn) => {
    const tx = db.transaction(stores, "readwrite");
    fn(tx);
    return finished(tx);
  };
  return {
    getChat: (key2) => read("chats", (s) => s.get(key2)),
    putChat: (rec) => write(["chats"], (tx) => tx.objectStore("chats").put(rec)),
    allChats: () => read("chats", (s) => s.getAll()),
    commitsFor: (key2) => read("commits", (s) => s.index("key").getAll(key2)),
    allCommits: () => read("commits", (s) => s.getAll()),
    putCommits: (commits) => write(["commits"], (tx) => commits.forEach((c) => tx.objectStore("commits").put(c))),
    deleteCommits: (ids) => write(
      ["commits", "docs"],
      (tx) => ids.forEach((id) => {
        tx.objectStore("commits").delete(id);
        tx.objectStore("docs").delete(id);
      })
    ),
    getDocs: async (ids) => {
      const tx = db.transaction("docs", "readonly");
      const docs = await Promise.all(ids.map((id) => result(tx.objectStore("docs").get(id))));
      const out = /* @__PURE__ */ new Map();
      ids.forEach((id, i) => {
        const d = docs[i];
        if (d) out.set(id, d);
      });
      return out;
    },
    putDocs: (docs) => write(["docs"], (tx) => docs.forEach((d, id) => tx.objectStore("docs").put(d, id))),
    deleteDocs: (ids) => write(["docs"], (tx) => ids.forEach((id) => tx.objectStore("docs").delete(id))),
    addCommit: async (commit, doc, rec) => {
      let stored;
      await write(["commits", "docs", "chats", "meta"], (tx) => {
        const meta = tx.objectStore("meta");
        const r = meta.get("seq");
        r.onsuccess = () => {
          const seq = (r.result ?? 0) + 1;
          stored = { ...commit, seq };
          meta.put(seq, "seq");
          tx.objectStore("commits").put(stored);
          tx.objectStore("docs").put(doc, stored.id);
          tx.objectStore("chats").put(rec);
        };
      });
      return stored;
    },
    getMeta: (name2) => read("meta", (s) => s.get(name2)),
    setMeta: (name2, value) => write(["meta"], (tx) => tx.objectStore("meta").put(value, name2))
  };
}

// src/background/app.ts
var RETRY_ALARM = "gitchat:push-retry";
var INITS_KEY = "inits";
function createBackground(opts = {}) {
  const fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
  const sleep = opts.sleep ?? defaultSleep;
  const clientOpts = { fetch: fetchImpl, sleep };
  const isExtensionPage = (sender) => !!sender?.url?.startsWith(chrome.runtime.getURL(""));
  const events = new Events(isExtensionPage, (tabId) => void engine().then((e) => e.ownerGone(tabId)));
  const deviceFlow = new DeviceFlow(fetchImpl, sleep, opts.now);
  const settingsStore = { get: loadSettings, save: saveSettings };
  let lastSettings = null;
  const github = async () => {
    const auth = await loadAuth();
    if (!auth) throw new GitchatError("Connect GitHub in the gitchat settings first.", "no-auth");
    return new GitHub(auth.token, clientOpts);
  };
  let enginePromise = null;
  const engine = () => enginePromise ??= openDb(opts.dbName).then((db) => {
    const e = new Engine({
      db,
      settings: settingsStore,
      github,
      emit: events,
      now: opts.now,
      pushDelayMs: opts.pushDelayMs,
      keepAlive,
      scheduleRetry: (ms) => void chrome.alarms.create(RETRY_ALARM, { when: Date.now() + Math.max(3e4, ms) }),
      clearRetry: () => void chrome.alarms.clear(RETRY_ALARM),
      // Session storage: survives a worker restart, cleared when the browser closes.
      initStore: {
        load: async () => (await chrome.storage.session.get(INITS_KEY))[INITS_KEY] ?? [],
        save: (inits) => chrome.storage.session.set({ [INITS_KEY]: inits })
      }
    });
    void e.resume().catch(() => void 0);
    return e;
  });
  let settingsQueue = Promise.resolve();
  const serialSettings = (fn) => {
    const run2 = settingsQueue.then(fn, fn);
    settingsQueue = run2.catch(() => void 0);
    return run2;
  };
  async function settingsUpdated(next) {
    const prev = lastSettings;
    lastSettings = next;
    if (prev && JSON.stringify(prev) === JSON.stringify(next)) return;
    if (prev) await (await engine()).settingsChanged(prev, next);
    events.broadcast({ type: "settings", settings: next });
  }
  const patchSettings = (patch) => serialSettings(async () => {
    const prev = await loadSettings();
    lastSettings ??= prev;
    const next = applySettingsPatch(prev, patch.autoCommit === false ? { ...patch, autoPush: false } : patch);
    await saveSettings(next);
    await settingsUpdated(next);
    return next;
  });
  let authGeneration = 0;
  let authQueue = Promise.resolve();
  const serialAuth = (fn) => {
    const run2 = authQueue.then(fn, fn);
    authQueue = run2.catch(() => void 0);
    return run2;
  };
  const cancelledSignIn = () => new GitchatError("The sign-in was cancelled.", "cancelled");
  async function signedIn() {
    const e = await engine();
    await e.clearError();
    await e.resume();
  }
  const setRepo = (repo) => patchSettings({ repo });
  const ownerOf = (ctx) => {
    if (ctx.tabId === void 0) return void 0;
    return ctx.documentId ? { tabId: ctx.tabId, documentId: ctx.documentId } : { tabId: ctx.tabId };
  };
  const handlers = {
    "chat/open": async (p, ctx) => {
      if (ctx.tabId !== void 0 && !ctx.fromExtensionPage) events.setTabChat(ctx.tabId, chatKey(p.service, p.chatId));
      return (await engine()).open(p);
    },
    "chat/snapshot": async (p) => (await engine()).snapshot(p.snapshot, p.reason),
    "chat/status": async (p) => (await engine()).status(p.key),
    "chat/init/start": async (p, ctx) => (await engine()).initStart(p.key, ownerOf(ctx)),
    "chat/init/progress": async (p, ctx) => (await engine()).initProgress(p.key, p.initId, p.progress, ownerOf(ctx)),
    "chat/init/done": async (p, ctx) => (await engine()).initDone(p.snapshot, p.initId, ownerOf(ctx)),
    "chat/init/cancel": async (p) => (await engine()).initCancel(p.key, p.initId),
    "chat/commit": async (p) => (await engine()).commit(p.key),
    "chat/push": async (p) => (await engine()).push(p.key),
    "chat/markdown": async (p) => ({ markdown: await (await engine()).copyMarkdown(p.key) }),
    "chat/untrack": async (p) => (await engine()).untrack(p.key),
    "settings/get": () => loadSettings(),
    "settings/set": (p) => patchSettings(p.patch ?? {}),
    "auth/get": async () => {
      const a = await loadAuth();
      return a && { login: a.login, method: a.method, scopes: a.scopes };
    },
    "auth/device/start": async () => {
      authGeneration++;
      const s = await loadSettings();
      return deviceFlow.start(s.githubClientId || DEFAULT_CLIENT_ID);
    },
    "auth/device/wait": async () => {
      const generation = authGeneration;
      const { token, flowId } = await keepAlive(() => deviceFlow.wait());
      const who = await identify(token, clientOpts);
      await serialAuth(async () => {
        if (generation !== authGeneration || !await deviceFlow.claim(flowId)) throw cancelledSignIn();
        await saveAuth({ token, method: "device", login: who.login, scopes: who.scopes, savedAt: Date.now() });
      });
      await signedIn();
      return { login: who.login };
    },
    "auth/device/cancel": () => serialAuth(async () => {
      authGeneration++;
      await deviceFlow.cancel();
      return null;
    }),
    "auth/pat": async (p) => {
      const generation = ++authGeneration;
      await deviceFlow.cancel();
      const token = p.token.trim();
      const who = await identify(token, clientOpts);
      await serialAuth(async () => {
        if (generation !== authGeneration) throw cancelledSignIn();
        await saveAuth({ token, method: "pat", login: who.login, scopes: who.scopes, savedAt: Date.now() });
      });
      await signedIn();
      return { login: who.login };
    },
    "auth/signout": () => serialAuth(async () => {
      authGeneration++;
      await deviceFlow.cancel();
      await clearAuth();
      return null;
    }),
    "repo/list": async () => listRepos(await github()),
    "repo/info": async (p) => repoInfo(await github(), p.owner, p.name),
    "repo/create": async (p) => {
      const ref = await createRepo(await github(), p.name, p.private);
      await setRepo(ref);
      return ref;
    },
    "repo/use": async (p) => {
      const ref = await useRepo(await github(), p.owner, p.name, p.branch);
      await setRepo(ref);
      return ref;
    },
    "sync/status": async () => (await engine()).syncStatus(),
    "app/open-settings": async () => {
      await chrome.runtime.openOptionsPage();
      return null;
    }
  };
  function contextOf(sender) {
    const ctx = { fromExtensionPage: isExtensionPage(sender) };
    if (ctx.fromExtensionPage) return ctx;
    const service2 = senderService(sender);
    if (service2) ctx.service = service2;
    if (sender.tab?.id !== void 0) ctx.tabId = sender.tab.id;
    if (sender.documentId) ctx.documentId = sender.documentId;
    return ctx;
  }
  return {
    handlers,
    events,
    engine,
    /** Called once when the worker starts. */
    start() {
      void engine();
    },
    onMessage(msg, sender, sendResponse) {
      if (!isEnvelope(msg) || sender.id !== chrome.runtime.id) return false;
      void dispatch(handlers, msg, contextOf(sender)).then(sendResponse);
      return true;
    },
    onConnect(port) {
      if (port.name !== EVENTS_PORT || port.sender?.id !== chrome.runtime.id) return;
      if (!events.attach(port)) return;
      void loadSettings().then((settings) => events.post(port, { type: "settings", settings }));
    },
    onAlarm(alarm) {
      if (alarm.name === RETRY_ALARM) void engine().then((e) => e.retry());
    },
    onStartup() {
      void engine();
    },
    onInstalled(details) {
      if (details.reason === "install") void chrome.runtime.openOptionsPage();
      void engine();
    },
    /**
     * chrome.storage changes (this device or synced from another one). `previous` is the value before
     * the change: after a worker restart it is the baseline the engine hooks compare against.
     */
    onSettingsStored(previous) {
      void serialSettings(async () => {
        if (previous) lastSettings ??= previous;
        await settingsUpdated(await loadSettings());
      });
    }
  };
}

// src/background/index.ts
var ready = Promise.allSettled([restrictStorage(), restrictSettingsStorage()]).then((restricted) => {
  const failures = restricted.flatMap((result2) => result2.status === "rejected" ? [result2.reason] : []);
  if (failures.length > 1) throw new AggregateError(failures, "Could not restrict extension storage to trusted contexts.");
  if (failures.length === 1) throw failures[0];
  return createBackground();
});
function run(fn) {
  void ready.then(fn).catch((error) => console.error("Could not initialize gitchat background.", error));
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!isEnvelope(msg) || sender.id !== chrome.runtime.id) return false;
  void ready.then((app) => app.onMessage(msg, sender, sendResponse)).catch((error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  });
  return true;
});
chrome.runtime.onConnect.addListener((port) => {
  void ready.then((app) => app.onConnect(port)).catch(() => port.disconnect());
});
chrome.alarms.onAlarm.addListener((alarm) => run((app) => app.onAlarm(alarm)));
chrome.runtime.onStartup.addListener(() => run((app) => app.onStartup()));
chrome.runtime.onInstalled.addListener((details) => run((app) => app.onInstalled(details)));
chrome.storage.onChanged.addListener((changes, area) => {
  const c = changes.settings;
  if (area === "sync" && c) run((app) => app.onSettingsStored(normalizeSettings(c.oldValue)));
});
run((app) => app.start());
