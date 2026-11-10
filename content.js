"use strict";
(() => {
  // src/content/adapters/dom.ts
  function pick(root, candidates) {
    for (const sel of candidates) {
      try {
        const el = root.querySelector(sel);
        if (el) return el;
      } catch {
      }
    }
    return null;
  }
  function pickAll(root, candidates) {
    for (const sel of candidates) {
      try {
        const list2 = root.querySelectorAll(sel);
        if (list2.length) return Array.from(list2);
      } catch {
      }
    }
    return [];
  }
  function exists(root, candidates) {
    return pick(root, candidates) !== null;
  }
  function inDocumentOrder(nodes) {
    const sorted = [...nodes].sort((a, b) => {
      if (a.el === b.el) return 0;
      return a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    const out = [];
    for (const n of sorted) {
      const last2 = out[out.length - 1];
      if (last2 && (last2.el === n.el || last2.el.contains(n.el))) continue;
      out.push(n);
    }
    return out;
  }
  function combine(user, assistant, idOf) {
    return inDocumentOrder([
      ...user.map((el) => ({ el, role: "user", id: idOf(el, "user") })),
      ...assistant.map((el) => ({ el, role: "assistant", id: idOf(el, "assistant") }))
    ]);
  }
  function scrollableAncestor(el) {
    let cur = el;
    while (cur && cur !== document.documentElement) {
      if (cur instanceof HTMLElement) {
        const oy = getComputedStyle(cur).overflowY;
        if ((oy === "auto" || oy === "scroll" || oy === "overlay") && cur.scrollHeight > cur.clientHeight + 4) return cur;
      }
      cur = cur.parentElement;
    }
    return document.scrollingElement ?? null;
  }
  function themeFromBackground(doc) {
    const pickBg = (el) => el ? getComputedStyle(el).backgroundColor : "";
    const bg = [pickBg(doc.body), pickBg(doc.documentElement)].find((c) => c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) ?? "";
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg);
    if (!m) return doc.documentElement.classList.contains("dark") ? "dark" : "light";
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128 ? "dark" : "light";
  }
  function titleFromDocument(doc, siteNames) {
    let t2 = doc.title.trim();
    for (const name of siteNames) {
      const re = new RegExp(`\\s*[-|\u2013\u2014]\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
      t2 = t2.replace(re, "");
      if (t2.toLowerCase() === name.toLowerCase()) return "";
    }
    return t2.trim();
  }
  function isShown(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    if (el.hidden || el.getAttribute("aria-hidden") === "true") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // src/content/adapters/define.ts
  function defineAdapter(spec) {
    const s = spec.selectors;
    const scope = (doc) => spec.root?.(doc) ?? doc;
    const messages = (doc) => {
      const root = scope(doc);
      const all = combine(pickAll(root, s.user), pickAll(root, s.assistant), (el, role) => spec.idOf?.(el, role) ?? null);
      return spec.keep ? all.filter((n) => spec.keep(n.el, n.role)) : all;
    };
    let opened = null;
    let openedFor = null;
    const chatNow = () => {
      try {
        return spec.chatId(new URL(location.href));
      } catch {
        return null;
      }
    };
    const currentOpened = () => {
      if (opened && openedFor !== chatNow()) {
        opened = null;
        openedFor = null;
      }
      return opened;
    };
    const watched = /* @__PURE__ */ new WeakSet();
    const ownerId = (el) => {
      for (const role of ["assistant", "user"]) {
        let found = null;
        for (const sel of role === "user" ? s.user : s.assistant) {
          try {
            for (let cur = el.closest(sel); cur; cur = cur.parentElement?.closest(sel) ?? null) found = cur;
          } catch {
          }
          if (found) break;
        }
        if (found) return spec.idOf?.(found, role) ?? null;
      }
      return null;
    };
    return {
      service: spec.service,
      selectors: s,
      virtualized: spec.virtualized,
      ...spec.positionOf ? { positionOf: (node) => spec.positionOf(node.el) } : {},
      ...spec.rowPositions ? { rowPositions: (doc) => spec.rowPositions(doc) } : {},
      watch(doc) {
        if (!spec.cardOf || watched.has(doc)) return;
        watched.add(doc);
        doc.addEventListener(
          "click",
          (e) => {
            const card = e.target instanceof Element ? spec.cardOf(e.target) : null;
            if (card) {
              opened = { messageId: ownerId(card), title: spec.cardTitle?.(card) ?? (card.textContent ?? "").trim() };
              openedFor = chatNow();
            }
          },
          true
        );
      },
      ...spec.watchAttributes ? { watchAttributes: spec.watchAttributes } : {},
      ...spec.activeTurnId ? { activeTurnId: spec.activeTurnId } : {},
      ...spec.hasTurn ? { hasTurn: spec.hasTurn } : {},
      ...spec.doneQuietMs ? { doneQuietMs: spec.doneQuietMs } : {},
      ...spec.topQuietMs ? { topQuietMs: spec.topQuietMs } : {},
      chatId: (url) => spec.chatId(url),
      ...spec.sameChatUrl ? { sameChatUrl: spec.sameChatUrl } : {},
      canonicalUrl: (url) => spec.canonicalUrl?.(url) ?? `${url.origin}${url.pathname}`,
      ...spec.pageChatId ? { pageChatId: (doc) => spec.pageChatId(doc) } : {},
      title(doc) {
        const el = s.title ? pick(doc, s.title) : null;
        const fromEl = el?.textContent?.trim();
        return fromEl || titleFromDocument(doc, spec.siteNames);
      },
      messages,
      body(node) {
        const custom = spec.bodyOf?.(node);
        if (custom) return custom;
        const sel = node.role === "user" ? s.userBody : s.assistantBody;
        return sel && pick(node.el, sel) || node.el;
      },
      markdown: spec.markdown ?? {},
      scrollContainer(doc) {
        if (s.scroller) {
          const known = scrollerCandidates(scope(doc), doc, s.scroller);
          const shown = known.find((el) => isShown(el));
          if (shown) return shown;
          const overflowing = known.find((el) => el.scrollHeight > el.clientHeight);
          if (overflowing) return overflowing;
        }
        const first = messages(doc)[0]?.el ?? null;
        return scrollableAncestor(first);
      },
      isGenerating(doc) {
        for (const sel of s.generating) {
          try {
            for (const el of Array.from(doc.querySelectorAll(sel))) if (isShown(el) || el.matches('[data-is-streaming="true"]')) return true;
          } catch {
          }
        }
        return false;
      },
      isLoadingOlder: (doc) => s.loadingOlder ? pickAll(doc, s.loadingOlder).some(isShown) : false,
      isAtStart: (doc) => spec.atStart?.(doc) ?? (s.start ? exists(doc, s.start) : false),
      loadedCount: (doc) => spec.loadedCount?.(doc) ?? null,
      aiPhase: (doc) => spec.aiPhase?.(doc) ?? null,
      composer: (doc) => pick(doc, s.composer),
      ...spec.artifacts ? {
        artifacts: (doc, opts) => spec.artifacts(doc, { ownerId, skip: (key) => opts?.skip?.has(key) ?? false, opened: currentOpened })
      } : {},
      theme: (doc) => s.dark && exists(doc, s.dark) ? "dark" : s.dark ? "light" : themeFromBackground(doc)
    };
  }
  function scrollerCandidates(scope, doc, sels) {
    const out = [];
    const add = (el) => {
      if (el instanceof HTMLElement && !out.includes(el)) out.push(el);
    };
    for (const sel of sels) {
      try {
        if (scope instanceof Element && scope.matches(sel)) add(scope);
        scope.querySelectorAll(sel).forEach(add);
        doc.querySelectorAll(sel).forEach(add);
      } catch {
      }
    }
    return out;
  }
  function idFromPath(url, ...patterns) {
    for (const re of patterns) {
      const m = re.exec(url.pathname);
      if (m?.[1]) return m[1].toLowerCase();
    }
    return null;
  }

  // src/content/capture/frames.ts
  function requestFrameHtml(target, timeoutMs = 1500) {
    return new Promise((resolve) => {
      const nonce = crypto.randomUUID();
      const onMessage = (e) => {
        const d = e.data;
        if (!d || d.gitchat !== 1 || d.type !== "frame/html" || d.nonce !== nonce || e.source !== target) return;
        done(typeof d.html === "string" ? { html: d.html, title: typeof d.title === "string" ? d.title : "" } : null);
      };
      const timer2 = window.setTimeout(() => done(null), timeoutMs);
      const done = (v) => {
        clearTimeout(timer2);
        window.removeEventListener("message", onMessage);
        resolve(v);
      };
      window.addEventListener("message", onMessage);
      target.postMessage({ gitchat: 1, type: "frame/serialize", nonce }, "*");
    });
  }
  async function serializeFrames(requests, timeoutMs = 1500) {
    const got = await Promise.all(requests.map((r) => requestFrameHtml(r.win, timeoutMs)));
    const out = [];
    for (const [i, r] of requests.entries()) {
      const html = got[i];
      if (html) out.push({ key: r.key, messageId: r.messageId, title: r.title || html.title || "Visualization", html: html.html });
    }
    return out;
  }
  function assetSlug(title) {
    return title.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "visualization";
  }

  // src/content/capture/markdown.ts
  var BLOCK = /* @__PURE__ */ new Set([
    "ADDRESS",
    "ARTICLE",
    "ASIDE",
    "BLOCKQUOTE",
    "DETAILS",
    "DIV",
    "DL",
    "FIELDSET",
    "FIGCAPTION",
    "FIGURE",
    "FOOTER",
    "FORM",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HEADER",
    "HR",
    "LI",
    "MAIN",
    "NAV",
    "OL",
    "P",
    "PRE",
    "SECTION",
    "SUMMARY",
    "TABLE",
    "UL"
  ]);
  var SKIP = /* @__PURE__ */ new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "BUTTON", "svg", "SVG", "INPUT", "TEXTAREA", "SELECT", "CANVAS", "VIDEO", "AUDIO"]);
  var DEFAULT_IGNORE = [".sr-only", "[hidden]"];
  function toMarkdown(root, hooks = {}) {
    const ctx = {
      hooks,
      ignore: [...DEFAULT_IGNORE, ...hooks.ignore ?? []].join(","),
      kinds: /* @__PURE__ */ new Set(),
      pre: false,
      listDepth: 0
    };
    const md = normalize(renderChildren(root, ctx));
    return { markdown: md, kinds: [...ctx.kinds] };
  }
  function renderChildren(el, ctx) {
    let out = "";
    for (const child of Array.from(el.childNodes)) out += render(child, ctx);
    return out;
  }
  function render(node, ctx) {
    if (node.nodeType === Node.TEXT_NODE) return text(node.textContent ?? "", ctx);
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node;
    const special = ctx.hooks.render?.(el, (x) => renderChildren(x, ctx), (k) => ctx.kinds.add(k));
    if (special != null) return special;
    if (SKIP.has(el.tagName)) return "";
    if (ctx.ignore && safeMatches(el, ctx.ignore)) return "";
    const math = mathOf(el, ctx);
    if (math) {
      ctx.kinds.add("math");
      return math.display ? block(`$$
${math.tex}
$$`) : `$${math.tex}$`;
    }
    switch (el.tagName) {
      case "BR":
        return ctx.pre ? "\n" : "  \n";
      case "P":
        return block(escapeLineStarts(inline(el, ctx)));
      case "H1":
      case "H2":
      case "H3":
      case "H4":
      case "H5":
      case "H6": {
        const level = Math.min(6, Math.max(1, ctx.hooks.headingLevel?.(el) ?? Number(el.tagName[1])));
        return block(`${"#".repeat(level)} ${inline(el, ctx).replace(/\n+/g, " ")}`);
      }
      case "STRONG":
      case "B":
        return wrap(renderChildren(el, ctx), "**");
      case "EM":
      case "I":
        return wrap(renderChildren(el, ctx), "*");
      case "DEL":
      case "S":
        return wrap(renderChildren(el, ctx), "~~");
      case "CODE":
        return inlineCode(el.textContent ?? "");
      case "PRE":
        return codeBlock(el, ctx);
      case "BLOCKQUOTE":
        return block(
          normalize(renderChildren(el, ctx)).split("\n").map((l) => l ? `> ${l}` : ">").join("\n")
        );
      case "UL":
      case "OL":
        return list(el, ctx);
      case "HR":
        return block("---");
      case "A":
        return link(el, ctx);
      case "IMG":
        return ctx.skipImages ? "" : image(el, ctx);
      case "IFRAME":
        return iframe(el, ctx);
      case "TABLE":
        return table(el, ctx);
      case "DETAILS":
        return details(el, ctx);
      case "SUP":
        return `<sup>${inline(el, ctx)}</sup>`;
      case "SUB":
        return `<sub>${inline(el, ctx)}</sub>`;
      default:
        if (!BLOCK.has(el.tagName)) return renderChildren(el, ctx);
        return block(hasBlockChild(el) ? renderChildren(el, ctx) : escapeLineStarts(renderChildren(el, ctx)));
    }
  }
  var BLOCK_SELECTOR = [...BLOCK].map((t2) => t2.toLowerCase()).join(",");
  function hasBlockChild(el) {
    try {
      return el.querySelector(BLOCK_SELECTOR) !== null;
    } catch {
      return true;
    }
  }
  function safeMatches(el, selector) {
    try {
      return el.matches(selector);
    } catch {
      return false;
    }
  }
  var block = (s) => s.trim() ? `

${s.trim()}

` : "";
  function text(s, ctx) {
    if (ctx.pre) return s;
    return escapeText(s.replace(/[ \t\r\n\f]+/g, " "));
  }
  var isWordChar = (c) => !!c && /[\p{L}\p{N}]/u.test(c);
  var isSpace = (c) => c === void 0 || /\s/.test(c);
  function escapeText(s) {
    const dollars = (s.match(/\$/g) ?? []).length;
    let out = "";
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      const prev = s[i - 1];
      const next = s[i + 1];
      switch (c) {
        case "\\":
          out += next && /[!-/:-@[-`{-~]/.test(next) ? "\\\\" : c;
          break;
        case "`":
          out += "\\`";
          break;
        case "<":
          out += next && /[A-Za-z/!?]/.test(next) ? "\\<" : c;
          break;
        case "&":
          out += /^&#?[A-Za-z0-9]+;/.test(s.slice(i)) ? "\\&" : c;
          break;
        case "*":
          out += isSpace(prev) && isSpace(next) && prev !== void 0 && next !== void 0 ? c : "\\*";
          break;
        case "_":
          out += isWordChar(prev) && isWordChar(next) ? c : "\\_";
          break;
        case "~":
          out += next === "~" || prev === "~" ? "\\~" : c;
          break;
        case "[":
          out += next === "^" ? "\\[" : c;
          break;
        case "]":
          out += next === "(" || next === "[" ? "\\]" : c;
          break;
        case "$":
          out += dollars >= 2 ? "\\$" : c;
          break;
        default:
          out += c;
      }
    }
    return out;
  }
  function escapeLineStarts(s) {
    const lines = s.split("\n");
    return lines.map((line, i) => {
      if (/^> \*\*(?:Artifact|File):\*\* /.test(line)) return line;
      let l = line.replace(/^(\s*)(#{1,6})(?=\s|$)/, "$1\\$2");
      l = l.replace(/^(\s*)>/, "$1\\>");
      l = l.replace(/^(\s*)([-+])(?=\s)/, "$1\\$2");
      l = l.replace(/^(\s*)(\d{1,9})([.)])(?=\s|$)/, "$1$2\\$3");
      if (/^\s*=+\s*$/.test(l) || i > 0 && lines[i - 1]?.trim() && /^\s*-+\s*$/.test(l)) l = l.replace(/^(\s*)([=-])/, "$1\\$2");
      return l;
    }).join("\n");
  }
  function inline(el, ctx) {
    return renderChildren(el, ctx).replace(/\n{2,}/g, "\n").trim();
  }
  function wrap(s, mark) {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    if (!m || !m[2]) return s;
    return `${m[1]}${mark}${m[2]}${mark}${m[3]}`;
  }
  function inlineCode(code) {
    const runs = code.match(/`+/g) ?? [];
    const fence = "`".repeat(Math.max(0, ...runs.map((r) => r.length)) + 1);
    const pad = code.startsWith("`") || code.endsWith("`") ? " " : "";
    return `${fence}${pad}${code}${pad}${fence}`;
  }
  function mathOf(el, ctx) {
    const custom = ctx.hooks.math?.(el);
    if (custom) return custom;
    if (el.classList.contains("katex-display") || el.classList.contains("katex") && !el.closest(".katex-display")) {
      const ann = el.querySelector('annotation[encoding="application/x-tex"]');
      if (ann?.textContent) return { tex: ann.textContent.trim(), display: el.classList.contains("katex-display") };
    }
    if (el.tagName === "MJX-CONTAINER") {
      const tex2 = el.getAttribute("data-latex") ?? el.querySelector("math")?.getAttribute("alttext");
      if (tex2) return { tex: tex2.trim(), display: el.getAttribute("display") === "true" };
    }
    for (const attr of ["data-math", "data-latex", "data-tex"]) {
      const tex2 = el.getAttribute(attr);
      if (tex2) {
        const display = /display|block/i.test(el.className) || el.tagName === "DIV";
        return { tex: tex2.trim(), display };
      }
    }
    if (el.tagName.toLowerCase() === "math") {
      const tex2 = el.getAttribute("alttext");
      if (tex2) return { tex: tex2.trim(), display: el.getAttribute("display") === "block" };
    }
    return null;
  }
  function codeBlock(pre, ctx) {
    ctx.kinds.add("code");
    const code = pre.querySelector("code") ?? pre;
    const lang = ctx.hooks.codeLanguage?.(pre) ?? languageFromClass(code) ?? languageFromClass(pre) ?? pre.getAttribute("data-language") ?? "";
    const body = (code.textContent ?? "").replace(/\n$/, "");
    return block(fencedCode(body, lang.toLowerCase()));
  }
  function codeFence(code) {
    let longest = 0;
    for (const run of code.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
    return "`".repeat(Math.max(3, longest + 1));
  }
  function fencedCode(code, lang = "") {
    const fence = codeFence(code);
    return `${fence}${lang}
${code}
${fence}`;
  }
  function languageFromClass(el) {
    for (const c of Array.from(el.classList)) {
      const m = /^(?:language|lang)-(.+)$/.exec(c);
      if (m?.[1]) return m[1];
    }
    return null;
  }
  function list(el, ctx) {
    const ordered = el.tagName === "OL";
    let n = Number(el.getAttribute("start") ?? "1") || 1;
    const items = [];
    ctx.listDepth++;
    for (const li of Array.from(el.children)) {
      if (li.tagName !== "LI") continue;
      const marker = ordered ? `${n++}.` : "-";
      const content = normalize(renderChildren(li, ctx));
      const indent = " ".repeat(marker.length + 1);
      const lines = content.split("\n");
      items.push(`${marker} ${lines[0] ?? ""}${lines.slice(1).map((l) => l ? `
${indent}${l}` : "\n").join("")}`);
    }
    ctx.listDepth--;
    const loose = items.some((i) => i.includes("\n\n"));
    return block(items.join(loose ? "\n\n" : "\n"));
  }
  function link(a, ctx) {
    const custom = ctx.hooks.linkLabel?.(a);
    const skip = ctx.skipImages;
    if ((a.textContent ?? "").trim()) ctx.skipImages = true;
    const label = custom != null ? escapeText(custom) : inline(a, ctx);
    ctx.skipImages = skip;
    const href = a.getAttribute("href") ?? "";
    if (!href || href.startsWith("javascript:")) return label;
    ctx.kinds.add("link");
    const abs = absolute(href, a.ownerDocument);
    const plain = (custom ?? a.textContent ?? "").trim();
    if (!label || plain === abs || plain === href) return `<${destination(abs)}>`;
    return `[${label.replace(/(?<!\\)[[\]]/g, "\\$&")}](${destination(abs)})`;
  }
  function destination(url) {
    return url.replace(/[()<>\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
  }
  function absolute(href, doc) {
    try {
      return new URL(href, doc.baseURI).href;
    } catch {
      return href;
    }
  }
  function image(img, ctx) {
    const custom = ctx.hooks.image?.(img);
    if (custom != null) {
      ctx.kinds.add("image");
      return custom;
    }
    const src = img.getAttribute("src") ?? "";
    const alt = (img.getAttribute("alt") ?? "").replace(/[[\]]/g, "");
    if (!src) return "";
    ctx.kinds.add("image");
    if (src.startsWith("data:") && src.length > 2048) return `![${alt || "image"}](image)`;
    if (src.startsWith("blob:")) return `![${alt || "image"}](image)`;
    return `![${alt}](${destination(absolute(src, img.ownerDocument))})`;
  }
  function iframe(el, ctx) {
    ctx.kinds.add("viz");
    const custom = ctx.hooks.iframe?.(el);
    if (custom != null) return block(custom);
    const title = el.getAttribute("title") || "interactive content";
    return block(`<!-- gitchat: ${title} (iframe) -->`);
  }
  function table(t2, ctx) {
    ctx.kinds.add("table");
    const rows = Array.from(t2.rows);
    if (!rows.length) return "";
    const cells = rows.map((r) => Array.from(r.cells).map((c) => cell(c, ctx)));
    const width = Math.max(...cells.map((r) => r.length));
    const pad = (r) => [...r, ...Array(width - r.length).fill("")];
    const header = pad(cells[0] ?? []);
    const align = Array.from(rows[0]?.cells ?? []).map((c) => {
      const a = (c.getAttribute("align") ?? c.getAttribute("data-d-align") ?? c.style?.textAlign ?? "").toLowerCase();
      return a === "center" ? ":---:" : a === "right" || a === "end" ? "---:" : "---";
    });
    const lines = [
      `| ${header.join(" | ")} |`,
      `| ${pad(align).map((a) => a || "---").join(" | ")} |`,
      ...cells.slice(1).map((r) => `| ${pad(r).join(" | ")} |`)
    ];
    return block(lines.join("\n"));
  }
  function cell(c, ctx) {
    return inline(c, ctx).replace(/\n+/g, "<br>").replace(/\|/g, "\\|");
  }
  function details(el, ctx) {
    ctx.kinds.add("thinking");
    const summaryEl = el.querySelector(":scope > summary");
    const summary = summaryEl ? inline(summaryEl, ctx) : "Details";
    const clone = el.cloneNode(true);
    clone.querySelector(":scope > summary")?.remove();
    const body = normalize(renderChildren(clone, ctx));
    return block(`<details>
<summary>${summary}</summary>

${body}

</details>`);
  }
  var FENCE = /^([ \t]*(?:>[ \t]?)*[ \t]*)(`{3,}|~{3,})(.*)$/;
  function normalize(s) {
    const out = [];
    let fence = null;
    let blanks = 0;
    for (const line of s.split("\n")) {
      const m = FENCE.exec(line);
      if (fence) {
        out.push(line);
        if (m && m[2][0] === fence.ch && m[2].length >= fence.len && !m[3].trim()) fence = null;
        continue;
      }
      if (m && !(m[2][0] === "`" && m[3].includes("`"))) {
        fence = { ch: m[2][0], len: m[2].length };
        blanks = 0;
        out.push(line.replace(/[ \t]+$/, ""));
        continue;
      }
      if (!line.trim()) {
        if (++blanks === 1) out.push("");
        continue;
      }
      blanks = 0;
      out.push(/\S {2}$/.test(line) ? line : line.replace(/[ \t]+$/, ""));
    }
    return out.join("\n").trim();
  }

  // src/content/adapters/chatgpt.ts
  function visiblePane(doc) {
    const panes = Array.from(doc.querySelectorAll(".thread-scroll-container"));
    return panes.find((p) => p.getBoundingClientRect().height > 0) ?? null;
  }
  function conversationAttr(root) {
    const el = root.querySelector("[data-chatgpt-conversation-selection-target], [data-chatgpt-selection-conversation-id]");
    if (!el) return null;
    return el.getAttribute("data-chatgpt-conversation-selection-target") ?? el.getAttribute("data-chatgpt-selection-conversation-id");
  }
  function transcript(doc) {
    const pane = visiblePane(doc);
    if (pane) return pane;
    return doc.querySelector(".thread-scroll-container") ? doc.createDocumentFragment() : doc;
  }
  function anyShown(doc, selector) {
    return Array.from(doc.querySelectorAll(selector)).some(isShown);
  }
  var VIZ_FRAME = 'iframe[src*="web-sandbox.oaiusercontent.com"]';
  var RIGHT_PANEL = 'aside[data-app-shell-focus-area="right-panel"]';
  var IN_PROGRESS = '[data-talvt-turn-state="in_progress"]';
  var DESCENDANT_ID = ["data-chatgpt-selection-message-id", "data-dil-source-message-id", "data-dil-message-id", "data-message-id"];
  function messageId(el, role) {
    const own = el.getAttribute("data-chatgpt-search-message-ids")?.split(/[\s,]+/)[0] || el.getAttribute("data-message-id");
    if (own) return own;
    for (const attr of DESCENDANT_ID) {
      const v = el.querySelector(`[${attr}]`)?.getAttribute(attr);
      if (v) return v;
    }
    const turn = el.closest("[data-turn-key]")?.getAttribute("data-turn-key");
    if (!turn || turn.startsWith("fallback-turn-")) return null;
    if (role === "user") return turn;
    const unit = /:(\d+):assistant$/.exec(el.getAttribute("data-chatgpt-search-unit-key") ?? el.getAttribute("data-content-search-unit-key") ?? "");
    return `${turn}:a${unit?.[1] ?? ""}`;
  }
  var FINAL = "[data-local-conversation-final-assistant]";
  var WORK_LOG = "[data-local-conversation-item-target-ids]";
  function isMessage(el, role) {
    if (role !== "assistant") return true;
    if (el.closest(FINAL)) return true;
    if (el.closest(WORK_LOG)) return false;
    return !el.closest("[data-turn-key]")?.querySelector(FINAL);
  }
  function fileCardName(el) {
    if (el.tagName !== "BUTTON") return null;
    const spans = el.querySelectorAll("span[title]");
    if (spans.length !== 1) return null;
    const name = spans[0].getAttribute("title")?.trim() ?? "";
    return /^[^\s/\\]{1,120}\.[A-Za-z0-9]{1,10}$/.test(name) ? name : null;
  }
  function codeLanguage(el) {
    const lang = el.querySelector(".cm-content[data-language]")?.getAttribute("data-language") ?? el.querySelector('[data-markdown-copy="exclude"] .truncate, [data-markdown-copy="exclude"] > div')?.textContent?.trim() ?? "";
    return /^[A-Za-z0-9+#.-]{1,20}$/.test(lang) ? lang.toLowerCase() : "";
  }
  function codeWidget(el) {
    let raw = el.getAttribute("data-chatgpt-copy-code");
    if (raw == null && el.getAttribute("data-code-block") === "true") {
      raw = (el.querySelector("[data-code-block-source] code") ?? el.querySelector("code"))?.textContent ?? null;
    }
    if (raw == null) return null;
    return `

${fencedCode(raw.replace(/\n$/, ""), codeLanguage(el))}

`;
  }
  var chatgpt = defineAdapter({
    service: "chatgpt",
    siteNames: ["ChatGPT"],
    // `/c/local-chatgpt:<uuid>` is a transient id right after the first send: wait for the real one.
    // Temporary chats are meant to disappear, so gitchat never saves them.
    chatId: (url) => url.searchParams.get("temporary-chat") === "true" ? null : idFromPath(url, /\/c\/([0-9a-f]{8}-[0-9a-f-]{27,})/i),
    // The page names its conversation even when the URL has not caught up (a branch, or another account).
    pageChatId(doc) {
      const panes = doc.querySelectorAll(".thread-scroll-container");
      const pane = panes.length ? visiblePane(doc) : doc.documentElement;
      if (!pane) return null;
      const raw = conversationAttr(pane);
      if (!raw) return null;
      const id = raw.replace(/^local-chatgpt:/i, "").trim();
      return id ? id.toLowerCase() : null;
    },
    root: transcript,
    // ~11 turns in the DOM at a time
    virtualized: true,
    // Work-mode turns flicker complete → in progress → complete at the end (gap of 1.9 s observed)
    doneQuietMs: 3e3,
    watchAttributes: ["data-talvt-turn-state", "data-response-starting"],
    // older turns arrive in batches; reported gaps run up to about 6s, so the quiet window is longer
    topQuietMs: 7e3,
    selectors: {
      user: ['[data-chatgpt-search-unit-key$=":user"], [data-content-search-unit-key$=":user"]', '[data-message-author-role="user"]'],
      assistant: ['[data-chatgpt-search-unit-key$=":assistant"], [data-content-search-unit-key$=":assistant"]', '[data-message-author-role="assistant"]'],
      userBody: ["[data-user-message-bubble]", ".whitespace-pre-wrap"],
      assistantBody: [
        '[data-markdown-text-style="assistant-message"]:not([data-markdown-text-tone])',
        "[data-dil-response]",
        ".markdown"
      ],
      generating: ['[data-response-starting][role="status"]', '[data-talvt-turn-state="in_progress"]', '[data-testid="stop-button"]'],
      composer: ['.ProseMirror[contenteditable="true"]', "#prompt-textarea"],
      scroller: [".thread-scroll-container"],
      dark: ['html[data-theme="dark"]', "html.dark"]
    },
    idOf: messageId,
    keep: isMessage,
    cardOf: (target) => {
      const button = target.closest("button");
      return button && fileCardName(button) ? button : null;
    },
    cardTitle: (card) => fileCardName(card) ?? "",
    // the turn being answered: remembered so that unmounting it (virtualization) is not "done"
    activeTurnId(doc) {
      const pane = transcript(doc);
      const busy = Array.from(pane.querySelectorAll(`${IN_PROGRESS}, [data-response-starting][role="status"]`)).find(isShown);
      if (!busy) return null;
      return busy.closest("[data-turn-key]")?.getAttribute("data-turn-key") ?? Array.from(pane.querySelectorAll("[data-turn-key]")).pop()?.getAttribute("data-turn-key") ?? null;
    },
    hasTurn: (doc, id) => !!transcript(doc).querySelector(`[data-turn-key="${CSS.escape(id)}"]`),
    aiPhase(doc) {
      if (anyShown(doc, '[data-response-starting][role="status"]')) return "thinking";
      if (anyShown(doc, '[data-talvt-turn-state="in_progress"]')) {
        const pane = transcript(doc);
        const runs = pane.querySelectorAll('[data-talvt-turn-state="in_progress"] [data-d-stream-run], [data-talvt-turn-state="in_progress"] [data-markdown-text-style="assistant-message"]:not([data-markdown-text-tone]) p');
        return runs.length ? "streaming" : "thinking";
      }
      if (anyShown(doc, '[data-testid="stop-button"]')) {
        const last2 = Array.from(doc.querySelectorAll("[data-message-author-role]")).pop();
        return last2?.getAttribute("data-message-author-role") === "assistant" && (last2.textContent ?? "").trim() ? "streaming" : "thinking";
      }
      return "idle";
    },
    async artifacts(doc, ctx) {
      const pane = transcript(doc);
      const requests = [];
      const seen = /* @__PURE__ */ new Map();
      for (const frame of Array.from(pane.querySelectorAll(VIZ_FRAME))) {
        if (frame.closest(RIGHT_PANEL)) continue;
        const messageId2 = ctx.ownerId(frame);
        const n = (seen.get(messageId2 ?? "") ?? 0) + 1;
        seen.set(messageId2 ?? "", n);
        const key = `${messageId2 ?? "viz"}:viz${n}`;
        if (!frame.contentWindow || ctx.skip(key)) continue;
        requests.push({ key, messageId: messageId2, title: (frame.getAttribute("title") ?? "").trim() || "Visualization", win: frame.contentWindow });
      }
      for (const frame of Array.from(doc.querySelectorAll(`${RIGHT_PANEL} ${VIZ_FRAME}`))) {
        const name = (frame.getAttribute("title") ?? "").trim();
        if (!name || !frame.contentWindow) continue;
        const opened = ctx.opened();
        const messageId2 = opened?.title === name ? opened.messageId : null;
        if (!messageId2) continue;
        const key = `${messageId2}:file:${name}`;
        if (!ctx.skip(key)) requests.push({ key, messageId: messageId2, title: name, win: frame.contentWindow });
      }
      return serializeFrames(requests);
    },
    markdown: {
      ignore: [
        "button",
        '[role="button"]',
        ".sr-only",
        "h4[data-conversation-role]",
        '[data-markdown-copy="exclude"]',
        "[data-markdown-text-tone]",
        "[data-code-block-controls]",
        ".katex-html"
      ],
      // `##` renders as <h3 data-d-component="title"> in the new UI
      headingLevel: (el) => el.hasAttribute("data-d-component") ? Number(el.tagName[1]) - 1 : Number(el.tagName[1]),
      math(el) {
        if (el.getAttribute("data-d-component") !== "math") return null;
        const tex2 = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
        return tex2 ? { tex: tex2.trim(), display: el.hasAttribute("data-d-block") } : null;
      },
      render(el, children, kind) {
        if (el.hasAttribute("data-chatgpt-copy-code") || el.getAttribute("data-code-block") === "true") {
          const code = codeWidget(el);
          if (code != null) kind("code");
          return code;
        }
        if (el.getAttribute("data-markdown-copy") === "inline-code") return inlineCode(el.textContent ?? "");
        const file = fileCardName(el);
        if (file) return `

> **File:** ${file}

`;
        if (el.getAttribute("data-d-component") === "divider") return "\n\n---\n\n";
        if (el.hasAttribute("data-d-default-strong")) return `**${children(el).trim()}**`;
        if (el.getAttribute("data-d-font-style") === "italic") return `*${children(el).trim()}*`;
        if (el.getAttribute("data-d-component") === "popover-trigger") {
          const name = (el.textContent ?? "").replace(/\s*\+\d+\s*$/, "").trim();
          return name ? ` [${name}]` : "";
        }
        if (el.tagName === "IFRAME" && (el.getAttribute("src") ?? "").includes("web-sandbox.oaiusercontent.com")) {
          kind("viz");
          return `

> **Artifact:** ${(el.getAttribute("title") ?? "").trim() || "Visualization"}

`;
        }
        return null;
      }
    }
  });

  // src/content/adapters/claude.ts
  var CARD = '[data-testid="frame-card-open"], .artifact-block-cell';
  var ASSISTANT = ['div[data-is-streaming], .font-claude-response, [data-testid="assistant-message"]'];
  var STREAMING = ['div[data-is-streaming="true"]', '[data-testid="assistant-message"][data-is-streaming="true"]'];
  var PANEL = 'iframe[src*="/code/artifact/"]';
  var cardTitle = (card) => (card.textContent ?? "").trim() || "Artifact";
  var isCard = (el) => el.matches(CARD);
  function frameURL(frame) {
    try {
      const raw = frame.getAttribute("src") || frame.src || "";
      if (!raw) return null;
      return new URL(raw, "https://claude.ai");
    } catch {
      return null;
    }
  }
  function hostIs(url, host) {
    return url.hostname === host || url.hostname.endsWith(`.${host}`);
  }
  function frameWindow(frame) {
    try {
      return frame.contentWindow;
    } catch {
      return null;
    }
  }
  function frameDocument(frame) {
    try {
      return frame.contentDocument;
    } catch {
      return null;
    }
  }
  function childFrames(root) {
    try {
      return Array.from(root.querySelectorAll("iframe")).filter((el) => el.tagName.toUpperCase() === "IFRAME");
    } catch {
      return [];
    }
  }
  function userContentWindow(outer) {
    const seen = /* @__PURE__ */ new Set();
    const walk = (root) => {
      if (seen.has(root)) return null;
      seen.add(root);
      const frames = childFrames(root);
      for (const frame of frames) {
        const url = frameURL(frame);
        if (!url || !hostIs(url, "claudeusercontent.com")) continue;
        const win = frameWindow(frame);
        if (win) return win;
      }
      for (const frame of frames) {
        const url = frameURL(frame);
        if (url && !hostIs(url, "claude.ai")) continue;
        const child = frameDocument(frame);
        if (!child || child === root) continue;
        const win = walk(child);
        if (win) return win;
      }
      return null;
    };
    try {
      const doc = frameDocument(outer);
      return doc ? walk(doc) : null;
    } catch {
      return null;
    }
  }
  function answerBody(node) {
    const box = node.el.ownerDocument.createElement("div");
    const parts = node.el.querySelectorAll(`.standard-markdown, ${CARD}`);
    for (const part of Array.from(parts)) {
      if (part.parentElement?.closest(".standard-markdown")) continue;
      box.appendChild(part.cloneNode(true));
    }
    return parts.length ? box : node.el;
  }
  var claude = defineAdapter({
    service: "claude",
    siteNames: ["Claude"],
    // Incognito is a temporary chat: the URL keeps `?incognito=` (empty value counts). No
    // language-independent DOM flag is present here, so a `/chat/<uuid>` without that query is saved.
    chatId: (url) => url.searchParams.has("incognito") ? null : idFromPath(url, /^\/chat\/([0-9a-f-]{36})/i),
    // ~20 rows in the DOM at a time
    virtualized: true,
    selectors: {
      user: ['[data-testid="user-message"]'],
      assistant: ASSISTANT,
      generating: ['[data-testid="chat-input-stop"]', ...STREAMING],
      composer: ['[data-testid="chat-input"]', 'div[contenteditable="true"].ProseMirror'],
      scroller: ["[data-autoscroll-container]"],
      // the first *loaded* row (positions are rebased after each batch): a hint, never proof of the start
      start: ['[data-testid="transcript-row"] [role="article"][aria-posinset="1"]'],
      dark: ['html[data-mode="dark"]']
    },
    // user: data-turn-key=<turn uuid>, assistant: <turn uuid>-hub-reply — stable across reloads
    idOf: (el) => el.getAttribute("data-turn-key") ?? el.closest("[data-turn-key]")?.getAttribute("data-turn-key") ?? null,
    bodyOf: (node) => node.role === "assistant" ? answerBody(node) : null,
    // each message is one transcript row with its position among all loaded rows
    positionOf(el) {
      const n = Number(el.closest("[aria-posinset]")?.getAttribute("aria-posinset") ?? el.querySelector("[aria-posinset]")?.getAttribute("aria-posinset"));
      return Number.isInteger(n) && n > 0 ? n : null;
    },
    rowPositions: (doc) => Array.from(doc.querySelectorAll('[data-testid="transcript-row"] [aria-posinset]')).map((el) => Number(el.getAttribute("aria-posinset"))).filter((n) => Number.isInteger(n) && n > 0),
    cardOf: (target) => target.closest(CARD),
    cardTitle,
    loadedCount(doc) {
      const n = Number(doc.querySelector('[data-testid="transcript-row"] [role="article"][aria-setsize]')?.getAttribute("aria-setsize"));
      return Number.isFinite(n) && n > 0 ? n : null;
    },
    // The open artifact is a cross-origin frame on <uuid>.frame.claudeusercontent.com. The viewer is
    // same-origin and may nest another same-origin document (claude.ai/code/frame/) before that frame.
    // The card of the open artifact carries aria-current="true", which ties the panel to its message.
    async artifacts(doc, ctx) {
      const requests = [];
      const current = Array.from(doc.querySelectorAll(CARD)).filter((c) => c.getAttribute("aria-current") === "true").pop();
      const ownerOf = (panelTitle) => {
        if (current) {
          const messageId2 = ctx.ownerId(current);
          return messageId2 ? { messageId: messageId2, title: cardTitle(current) } : null;
        }
        const opened = ctx.opened();
        return opened?.messageId && opened.title === panelTitle ? { messageId: opened.messageId, title: opened.title } : null;
      };
      for (const outer of Array.from(doc.querySelectorAll(PANEL))) {
        try {
          const id = /\/code\/artifact\/([^/?#]+)/.exec(outer.getAttribute("src") ?? "")?.[1];
          if (!id) continue;
          const owner = ownerOf((outer.getAttribute("title") ?? "").trim());
          if (!owner) continue;
          const key = `artifact:${id}`;
          if (ctx.skip(key)) continue;
          const win = userContentWindow(outer);
          if (!win) continue;
          requests.push({ key, messageId: owner.messageId, title: owner.title, win });
        } catch {
        }
      }
      return serializeFrames(requests);
    },
    // The streaming answer's turn. The observer keeps it, so unmounting that row is not "done".
    activeTurnId(doc) {
      const streaming = Array.from(doc.querySelectorAll(STREAMING.join(", "))).pop();
      return streaming?.closest("[data-turn-key]")?.getAttribute("data-turn-key") ?? null;
    },
    hasTurn: (doc, id) => !!doc.querySelector(`[data-turn-key="${CSS.escape(id)}"]`),
    aiPhase(doc) {
      if (doc.querySelector(STREAMING.join(", "))) return "streaming";
      if (doc.querySelector('[data-testid="chat-input-stop"]')) return "thinking";
      return "idle";
    },
    markdown: {
      ignore: [
        "button",
        '[data-testid="message-actions"]',
        '[data-testid="code-block-copy"]',
        "[data-find-omitted]",
        '[data-testid="TurnStatusClayMark"]',
        ".katex-html"
      ],
      // `##` renders as <h3>: the site shifts headings down one level
      headingLevel: (el) => Number(el.tagName[1]) - 1,
      render(el, _children, kind) {
        if (!isCard(el)) return null;
        kind("viz");
        return `

> **Artifact:** ${cardTitle(el)}

`;
      },
      // citation pills read "Source title +3": keep the title only
      linkLabel(a) {
        if (!(a.getAttribute("class") ?? "").includes("group/tag")) return null;
        const first = Array.from(a.childNodes).find((n) => (n.textContent ?? "").trim());
        return (first?.textContent ?? a.textContent ?? "").replace(/\s*\+\d+\s*$/, "").trim() || null;
      }
    }
  });

  // src/content/adapters/gemini.ts
  var turnOf = (el) => el.closest(".conversation-container");
  function codeLanguage2(pre) {
    const label = pre.closest("code-block")?.querySelector(".code-block-decoration span")?.textContent?.trim() ?? "";
    if (!label || !/^[A-Za-z0-9+#.\- ]{1,20}$/.test(label) || /\s/.test(label)) return null;
    const map = { "c++": "cpp", "c#": "csharp", "objective-c": "objectivec", shell: "bash" };
    const id = label.toLowerCase();
    return map[id] ?? id;
  }
  function canvasIndex(chip) {
    const turn = turnOf(chip);
    const chips = turn ? Array.from(turn.querySelectorAll("immersive-entry-chip")) : [chip];
    return chips.indexOf(chip) + 1;
  }
  function canvasTitle(chip) {
    const n = canvasIndex(chip);
    return n > 1 ? `Canvas ${n}` : "Canvas";
  }
  var THOUGHTS = "model-thoughts, .thoughts-container, .thoughts-content";
  var ASSISTANT_BODY = ["message-content .markdown-main-panel", "message-content .markdown", "message-content"];
  function assistantProse(root) {
    for (const sel of ASSISTANT_BODY) {
      for (const el of Array.from(root.querySelectorAll(sel))) {
        if (!el.closest(THOUGHTS)) return el;
      }
    }
    if (!root.querySelector(THOUGHTS)) return null;
    const copy = root.cloneNode(true);
    for (const el of Array.from(copy.querySelectorAll(THOUGHTS))) el.remove();
    return copy;
  }
  var gemini = defineAdapter({
    service: "gemini",
    siteNames: ["Google Gemini", "Gemini"],
    // A second signed-in Google account adds /u/<n> in front: /u/1/app/<id>
    chatId: (url) => idFromPath(url, /^(?:\/u\/\d+)?\/app\/([0-9a-f]{12,})/i, /^(?:\/u\/\d+)?\/gem\/[^/]+\/([0-9a-f]{12,})/i),
    // The slot is this profile's sign-in order, and the query is account/language chrome. Neither belongs in a saved link.
    canonicalUrl(url) {
      const path = url.pathname.replace(/^\/u\/\d+/, "") || "/";
      return `${url.origin}${path}`;
    },
    // loaded turns stay in the DOM (off-screen ones use content-visibility:auto)
    virtualized: false,
    selectors: {
      user: ["user-query"],
      assistant: ["model-response"],
      // bodyOf applies these outside the thinking panel; pick() alone would take the expanded one
      assistantBody: ASSISTANT_BODY,
      generating: ["pending-request", 'model-response .markdown[aria-busy="true"]'],
      composer: ["rich-textarea .ql-editor", 'rich-textarea [contenteditable="true"]'],
      scroller: ["infinite-scroller.chat-history", "infinite-scroller"],
      loadingOlder: [".loading-content-spinner-container"],
      dark: ["body.dark-theme"]
    },
    idOf: (el, role) => {
      const id = turnOf(el)?.id;
      return id ? `${id}:${role === "user" ? "u" : "a"}` : null;
    },
    bodyOf: (node) => {
      if (node.role !== "user") return assistantProse(node.el);
      const box = node.el.ownerDocument.createElement("div");
      for (const p of Array.from(node.el.querySelectorAll("p.query-text-line"))) box.appendChild(p.cloneNode(true));
      return box.childElementCount ? box : null;
    },
    aiPhase(doc) {
      if (doc.querySelector("pending-request")) return "thinking";
      const busy = doc.querySelectorAll('model-response .markdown[aria-busy="true"]');
      const last2 = busy[busy.length - 1];
      if (!last2) return "idle";
      return (last2.textContent ?? "").trim() ? "streaming" : "thinking";
    },
    async artifacts(doc, ctx) {
      const requests = [];
      for (const chip of Array.from(doc.querySelectorAll("immersive-entry-chip"))) {
        const frame = chip.querySelector('iframe[src*="usercontent.goog"]');
        const turn = turnOf(chip)?.id;
        const key = `${turn ?? "canvas"}:canvas${canvasIndex(chip)}`;
        if (!frame?.contentWindow || ctx.skip(key)) continue;
        requests.push({ key, messageId: ctx.ownerId(chip), title: canvasTitle(chip), win: frame.contentWindow });
      }
      return serializeFrames(requests);
    },
    markdown: {
      ignore: [
        "button",
        '[role="button"]',
        "mat-icon",
        ".code-block-decoration",
        ".cdk-visually-hidden",
        "source-footnote",
        "thinking-overlay",
        "model-thoughts",
        ".thoughts-container",
        ".thoughts-content",
        "message-actions"
      ],
      codeLanguage: codeLanguage2,
      render(el, _children, kind) {
        if (el.tagName === "SOURCE-FOOTNOTE") {
          const marks = Array.from(el.querySelectorAll("[data-turn-source-index]")).map((sup) => {
            const shown = sup.textContent?.trim() ?? "";
            return /^\d{1,3}$/.test(shown) ? shown : sup.getAttribute("data-turn-source-index")?.trim() ?? "";
          }).filter((n) => /^\d{1,3}$/.test(n));
          return marks.map((n) => `[${n}]`).join("");
        }
        if (el.tagName !== "IMMERSIVE-ENTRY-CHIP") return null;
        kind("viz");
        return `

> **Artifact:** ${canvasTitle(el)}

`;
      }
    }
  });

  // src/content/adapters/grok.ts
  var ROW = '[id^="response-"]';
  var GATEWAY = '[data-plane-row^="gateway:"]';
  var INLINE_CODE = 'span[class~="!font-mono"]';
  var STOP = 'form button:has(g[id="name=player-stop"])';
  var CODE_CARD = "[data-code-card]";
  var rowId = (el) => el.closest(ROW)?.id.slice("response-".length) || null;
  function stableMessage(el) {
    const doc = el.ownerDocument;
    const newest = doc.querySelector(".action-buttons.last-response")?.closest(ROW);
    if (!newest?.querySelector('[data-testid="assistant-message"]')) return true;
    const rid = new URL(doc.location.href).searchParams.get("rid");
    if (rid === rowId(newest)) return true;
    const row = el.closest(GATEWAY);
    const answer = newest.closest(GATEWAY);
    return row !== answer && !(el.matches('[data-testid="user-message"]') && row === answer?.previousElementSibling);
  }
  function codeLanguage3(pre) {
    const label = pre.closest(CODE_CARD)?.querySelector(":scope > div:first-child span")?.textContent?.trim() ?? "";
    if (!label || !/^[A-Za-z0-9+#.\-]{1,20}$/.test(label)) return null;
    const map = { "c++": "cpp", "c#": "csharp", "objective-c": "objectivec", shell: "bash", plaintext: "", text: "" };
    const id = label.toLowerCase();
    return id in map ? map[id] || null : id;
  }
  function tex(katex) {
    return katex.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim() || null;
  }
  function typedPrompt(body) {
    const copy = body.cloneNode(true);
    const doc = copy.ownerDocument;
    const swap = (el, text2) => el.replaceWith(doc.createTextNode(text2));
    for (const card of Array.from(copy.querySelectorAll('[data-testid="code-block"]'))) {
      const pre = card.querySelector("pre");
      if (!pre) continue;
      const fence = fencedCode((pre.textContent ?? "").replace(/\n$/, ""), codeLanguage3(pre) ?? "");
      const p = doc.createElement("p");
      p.textContent = fence;
      card.replaceWith(p);
    }
    for (const el of Array.from(copy.querySelectorAll(".katex-display"))) {
      const t2 = tex(el);
      if (t2) swap(el, `$$${t2}$$`);
    }
    for (const el of Array.from(copy.querySelectorAll(".katex"))) {
      const t2 = tex(el);
      if (t2) swap(el, `$${t2}$`);
    }
    for (const el of Array.from(copy.querySelectorAll(INLINE_CODE))) swap(el, inlineCode(el.textContent ?? ""));
    return copy;
  }
  function lastToolbarEmpty(doc) {
    const bar = doc.querySelector(".action-buttons.last-response");
    return !!bar && !bar.querySelector("button") && !!bar.closest(ROW)?.querySelector('[data-testid="assistant-message"]');
  }
  var grok = defineAdapter({
    service: "grok",
    siteNames: ["Grok"],
    // `?rid=` picks the branch shown; the conversation is the path uuid
    chatId: (url) => idFromPath(url, /^\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i),
    sameChatUrl(a, b) {
      const withoutBranch = (url) => {
        const copy = new URL(url.href);
        copy.searchParams.delete("rid");
        return copy.href;
      };
      return withoutBranch(a) === withoutBranch(b);
    },
    virtualized: true,
    doneQuietMs: 1e3,
    watchAttributes: ["data-sd-animate", "data-settled"],
    selectors: {
      user: ['[data-testid="user-message"]'],
      assistant: ['[data-testid="assistant-message"]'],
      userBody: [".response-content-markdown"],
      assistantBody: [".response-content-markdown"],
      generating: [STOP, '[data-testid="assistant-message"] [data-sd-animate]', '[data-testid="canvas-working-indicator"]:not([data-settled])'],
      composer: ['[data-testid="chat-input"] .ProseMirror', '[data-testid="chat-input"] [contenteditable="true"]'],
      scroller: ['[data-testid="chat-transcript-scroller"]'],
      loadingOlder: ['[data-plane-row="chat:earlier-turns"]'],
      title: ['[data-testid="drop-ui"] h1.sr-only'],
      dark: ["html.dark"]
    },
    idOf: (el) => rowId(el),
    keep: stableMessage,
    bodyOf: (node) => {
      const body = node.el.querySelector(".response-content-markdown");
      if (!body) return null;
      return node.role === "user" ? typedPrompt(body) : body;
    },
    // the top row is mounted and no older history is left to load below it
    atStart: (doc) => !!doc.querySelector('[data-plane-row="transcript:top-inset"]') && !doc.querySelector('[data-plane-row="chat:earlier-turns"]'),
    aiPhase(doc) {
      if (doc.querySelector('[data-testid="assistant-message"] [data-sd-animate]')) return "streaming";
      const working = doc.querySelector('[data-testid="canvas-working-indicator"]:not([data-settled])');
      const pending = doc.querySelector('[data-testid="assistant-message"] .grok-bot');
      if (working || pending || doc.querySelector(STOP) || lastToolbarEmpty(doc)) return "thinking";
      return "idle";
    },
    // The gateway key survives server id assignment and virtualized remounts.
    activeTurnId(doc) {
      const bar = doc.querySelector(".action-buttons.last-response");
      if (!bar || bar.querySelector("button")) return null;
      return bar.closest(GATEWAY)?.getAttribute("data-plane-row") ?? null;
    },
    hasTurn: (doc, id) => Array.from(doc.querySelectorAll(GATEWAY)).some((el) => el.getAttribute("data-plane-row") === id),
    markdown: {
      ignore: [
        "button",
        '[role="button"]',
        ".thinking-container",
        "[data-no-copy]",
        ".sr-only",
        ".katex-html",
        `${CODE_CARD} > div:first-child`,
        "section.inline-media-container:empty",
        ".action-buttons",
        "span[hidden]"
      ],
      codeLanguage: codeLanguage3,
      render(el) {
        if (el.matches(INLINE_CODE) && !el.closest("pre")) return inlineCode(el.textContent ?? "");
        return null;
      }
    }
  });

  // src/content/adapters/registry.ts
  var BY_HOST = {
    "chatgpt.com": chatgpt,
    "claude.ai": claude,
    "gemini.google.com": gemini,
    "grok.com": grok
  };
  var ADAPTER_HOSTS = Object.keys(BY_HOST);
  function adapterFor(hostname) {
    return BY_HOST[hostname] ?? null;
  }

  // src/shared/types.ts
  var chatKey = (service, chatId) => `${service}:${chatId}`;

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
  async function request(type, payload) {
    const env = { gitchat: 1, type, payload };
    const reply = await chrome.runtime.sendMessage(env);
    if (!reply) throw new GitchatError("No reply from the background worker", "no-reply");
    if (!reply.ok) throw new GitchatError(reply.error, reply.code);
    return reply.data;
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

  // src/shared/i18n.ts
  function t(key, substitutions) {
    try {
      const s = globalThis.chrome?.i18n?.getMessage(key, substitutions);
      if (s) return s;
    } catch {
    }
    return key;
  }

  // src/content/bridge.ts
  var emptyState = () => ({
    tracked: false,
    staged: [],
    commits: [],
    settings: { autoCommit: false, autoPush: false },
    phase: "idle",
    progress: 0,
    captureStage: "loading",
    captureCount: 0,
    path: "",
    webUrl: "",
    error: "",
    ai: "idle",
    stalled: false
  });
  var UiStore = class {
    constructor(actions) {
      this.actions = actions;
    }
    actions;
    state = emptyState();
    subs = /* @__PURE__ */ new Set();
    key = "";
    aheadTotal = 0;
    /** Set while init runs in this tab: the local progress wins over the background's copy. */
    capturingHere = false;
    /**
     * Why init failed in this tab. The background has already ended the init, so its status no longer
     * says so: the reason is kept (as phase 'error') until the user acts again or the chat changes.
     */
    initError = "";
    /** Commits waiting to be pushed (all chats — a push sends all of them). */
    get ahead() {
      return this.aheadTotal;
    }
    subscribe(fn) {
      this.subs.add(fn);
      return () => this.subs.delete(fn);
    }
    emit(type, detail = {}) {
      for (const fn of [...this.subs]) fn(type, detail, this.state);
    }
    // ---- actions called by the widgets
    // Commit and push first read the page again (it may show more than was last captured); the
    // controller answers with `nope()` when there turns out to be nothing to do.
    commit() {
      if (!this.state.tracked || this.state.phase === "capturing") return;
      this.actions.commit();
    }
    push() {
      if (this.state.phase === "pushing" || this.state.phase === "capturing") return;
      this.actions.push();
    }
    /** The action had nothing to do (the widget gives a small "no" shake). */
    nope(action) {
      this.emit("nope", { action });
    }
    init() {
      if (this.state.tracked || this.state.phase === "capturing") return;
      this.initError = "";
      this.actions.init();
    }
    cancelInit() {
      if (this.state.phase === "capturing") this.actions.cancelInit();
    }
    setAuto(key, value) {
      this.actions.setAuto(key, value);
    }
    /** Forward synchronously so the clipboard write still belongs to the trusted click. */
    copyMarkdown() {
      if (!this.state.tracked) return Promise.resolve(false);
      return this.actions.copyMarkdown();
    }
    // ---- updates from the controller
    /** A different chat (or no chat) is showing. */
    switchTo(key, status) {
      this.key = key;
      this.capturingHere = false;
      this.initError = "";
      const s = this.state;
      Object.assign(s, emptyState(), { settings: s.settings, ai: s.ai, stalled: s.stalled });
      if (status) this.copy(status);
      this.emit("reset");
    }
    applyStatus(status) {
      if (status.key !== this.key) return;
      const s = this.state;
      const prev = { tracked: s.tracked, phase: s.phase, staged: s.staged, commits: s.commits };
      this.copy(status);
      const prevIds = new Set(prev.staged.map((i) => i.id));
      const added = s.staged.filter((i) => !prevIds.has(i.id));
      const prevCommitIds = new Set(prev.commits.map((c) => c.id));
      const newCommit = s.commits.find((c) => !prevCommitIds.has(c.id) && !c.pushed);
      const nowPushed = s.commits.filter((c) => c.pushed && prev.commits.some((p) => p.id === c.id && !p.pushed));
      if (!prev.tracked && s.tracked) {
        this.emit("captured", { items: s.staged });
        return;
      }
      if (prev.phase === "capturing" && s.phase !== "capturing" && !s.tracked) this.emit("captureCancel");
      if (newCommit) this.emit("committed", { commit: newCommit });
      else if (added.length) {
        const user = added.filter((i) => i.role === "user");
        const ai = added.filter((i) => i.role === "assistant");
        if (user.length) this.emit("staged", { items: user, from: "input" });
        if (ai.length) this.emit("staged", { items: ai, from: "stream" });
      }
      if (prev.phase !== "pushing" && s.phase === "pushing") this.emit("pushStart", { commits: s.commits.filter((c) => !c.pushed) });
      if (nowPushed.length) this.emit("pushed", { commits: nowPushed });
      if (prev.phase !== "error" && s.phase === "error") this.emit("error", { action: "push" });
      if (prev.phase === "pushing" && s.phase !== "pushing") this.emit("pushEnd", { ok: s.phase !== "error", pushed: nowPushed.length });
      this.emit("status");
    }
    /** Unpushed commits across all chats changed (another tab committed or pushed). */
    setAhead(n) {
      if (n === this.aheadTotal) return;
      this.aheadTotal = n;
      this.emit("status");
    }
    /**
     * An action failed (init, or the fresh capture before a commit/push): show why. A commit/push
     * failure shows until the next status; an init failure until the user acts again (see initError).
     */
    fail(action, message) {
      const s = this.state;
      if (action === "init") this.initError = message;
      s.phase = "error";
      s.error = message;
      this.emit("error", { action, message });
      this.emit("status");
    }
    /** Init could not finish on an untracked chat. */
    initFailed(message) {
      if (!this.state.tracked) this.fail("init", message);
    }
    /** A rescan of a tracked chat ended (the tracked flag never changes, so say it explicitly). */
    captureDone(ok) {
      if (ok) this.emit("captured", { items: this.state.staged });
      else this.emit("captureCancel");
    }
    applySettings(settings) {
      const before = this.state.settings;
      const next = { autoCommit: settings.autoCommit, autoPush: settings.autoPush };
      this.state.settings = next;
      const changed = ["autoPush", "autoCommit"].filter((k) => before[k] !== next[k]);
      if (!changed.length) return;
      const key = changed.length === 2 ? next.autoPush ? "autoPush" : "autoCommit" : changed[0];
      const linked = changed.find((k) => k !== key) ?? null;
      this.emit("settings", { key, value: next[key], linked });
    }
    setAi(phase, ms) {
      if (this.state.ai === phase) return;
      this.state.ai = phase;
      this.emit("ai", { phase, ms });
    }
    setStalled(on) {
      if (this.state.stalled === on) return;
      this.state.stalled = on;
      this.emit("stalled", { on });
    }
    setCapture(p) {
      const s = this.state;
      if (!p) {
        this.capturingHere = false;
        return;
      }
      const starting = s.phase !== "capturing";
      this.capturingHere = true;
      this.initError = "";
      s.phase = "capturing";
      s.error = "";
      s.captureStage = p.stage;
      s.captureCount = p.count;
      s.progress = p.progress;
      if (starting) this.emit("captureStart");
      this.emit("progress", { p: p.progress, stage: p.stage, count: p.count });
    }
    copy(st) {
      const s = this.state;
      s.tracked = st.tracked;
      s.staged = st.staged;
      s.commits = st.commits;
      s.path = st.path ?? "";
      s.webUrl = st.webUrl ?? "";
      s.error = st.error ?? "";
      this.aheadTotal = st.aheadTotal;
      if (!this.capturingHere) {
        s.phase = st.phase;
        if (st.phase === "capturing" && st.progress != null) s.progress = st.progress;
      }
      if (st.tracked || st.phase !== "idle") this.initError = "";
      if (this.initError) {
        s.phase = "error";
        s.error = this.initError;
      }
    }
  };

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
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        const a = (-this.k * (this.value - this.target) - this.c * this.velocity) / this.m;
        this.velocity += a * h;
        this.value += this.velocity * h;
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
    for (const s of springs) if (Math.abs(s.velocity) > eps || Math.abs(s.value - s.target) > eps) return true;
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
  function lensMap(w, h, r, bezel) {
    const key = `${w}x${h}r${r}b${bezel}`;
    if (maps.has(key)) return maps.get(key);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const hw = w / 2;
    const hh = h / 2;
    r = Math.min(r, hw, hh);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = x + 0.5 - hw;
        const py = y + 0.5 - hh;
        const sd = sdRoundRect(px, py, hw, hh, r);
        let dx = 0;
        let dy = 0;
        if (sd < 0 && -sd < bezel) {
          const t2 = 1 + sd / bezel;
          const s = t2 * t2;
          const gx = sdRoundRect(px + 0.5, py, hw, hh, r) - sdRoundRect(px - 0.5, py, hw, hh, r);
          const gy = sdRoundRect(px, py + 0.5, hw, hh, r) - sdRoundRect(px, py - 0.5, hw, hh, r);
          const gl = Math.hypot(gx, gy) || 1;
          dx = -(gx / gl) * s;
          dy = -(gy / gl) * s;
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
  function applyLens(root, target, { w, h, r, bezel = 16, scale = 34, blur = 0.8, sat = 1.8, bright = 1.04 }) {
    w = Math.max(2, Math.round(w));
    h = Math.max(2, Math.round(h));
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
    im.setAttribute("href", lensMap(w, h, r, bezel));
    im.setAttribute("width", w);
    im.setAttribute("height", h);
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

  // src/content/ui/core/icons.js
  var P = {
    commit: '<circle cx="12" cy="12" r="3.6"/><path d="M3 12h5.4M15.6 12H21"/>',
    push: '<path d="M8 18.5H7a4.2 4.2 0 0 1-.4-8.38A5.6 5.6 0 0 1 17.4 10.5 4 4 0 0 1 17 18.5h-1"/><path d="M12 20.5v-8M9 15.3l3-3 3 3"/>',
    cloud: '<path d="M7 18.5h10a4 4 0 0 0 .5-7.97A5.6 5.6 0 0 0 6.6 10.1 4.2 4.2 0 0 0 7 18.5Z"/>',
    link: '<path d="M10 14a4.2 4.2 0 0 0 6 0l3-3a4.24 4.24 0 0 0-6-6l-1 1"/><path d="M14 10a4.2 4.2 0 0 0-6 0l-3 3a4.24 4.24 0 0 0 6 6l1-1"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="12" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6.5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2"/>',
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

  // src/content/ui/core/format.js
  function fmtAgo(t2, now = Date.now()) {
    const m = Math.round((now - t2) / 6e4);
    if (m < 1) return "now";
    if (m < 60) return `${m}m`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.round(h / 24)}d`;
  }

  // src/content/ui/core/html.js
  var policy = null;
  function setHTML(el, html) {
    try {
      el.innerHTML = html;
      return;
    } catch (e) {
      if (!(e instanceof TypeError) || !globalThis.trustedTypes?.createPolicy) throw e;
    }
    policy ??= globalThis.trustedTypes.createPolicy("gitchat", { createHTML: (s) => s });
    el.innerHTML = policy.createHTML(html);
  }

  // src/content/ui/core/gesture.js
  function isUserInput(event) {
    return event?.isTrusted === true;
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
  function rollText(el, text2) {
    if (el.textContent === text2) return;
    el.textContent = text2;
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
.panel.untracked .graph, .panel.untracked .ib.commit, .panel.untracked .ib.push, .panel.untracked .ib.link, .panel.untracked .ib.md { display: none; }
.panel .ib.fail { color: var(--err); }
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
  var ROW2 = 24;
  var MAX = 6;
  function createGraph(svg, store, isOpen) {
    setHTML(svg, `
    <g class="lines"><path class="ln pushed"/><path class="ln ahead"/><path class="ln work"/><path class="ln tail"/></g>
    <g class="rows"></g>
    <g class="origin"><line x1="${X - 6}" x2="${W}" y1="0" y2="0"/></g>`);
    const q = (s) => svg.querySelector(s);
    const ln = { pushed: q(".ln.pushed"), ahead: q(".ln.ahead"), work: q(".ln.work"), tail: q(".ln.tail") };
    const rowsG = q(".rows");
    const originG = q(".origin");
    const rows = /* @__PURE__ */ new Map();
    const height = new Spring(40, { stiffness: 420, damping: 40 });
    const originY = new Spring(0, { stiffness: 260, damping: 32 });
    const originO = new Spring(0, { stiffness: 400, damping: 40 });
    let hasTail = false;
    let top0 = TOP;
    const list2 = () => {
      const st = store.state;
      if (!st.tracked) return [];
      const cs = st.commits.slice(0, MAX).reverse().map((c) => ({ id: c.id, type: "commit", c }));
      return [...cs, { id: "work", type: "work" }];
    };
    function make(r, y0, snap) {
      const g = mk("g", { class: `row ${r.type}` }, rowsG);
      mk("rect", { class: "hl", x: -6, y: -ROW2 / 2 + 1, width: W + 4, height: ROW2 - 2, rx: 6 }, g);
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
      const rs = list2();
      const keep = /* @__PURE__ */ new Set();
      hasTail = store.state.commits.length > MAX;
      top0 = TOP + (hasTail ? 14 : 0);
      rs.forEach((r, i) => {
        const y = top0 + i * ROW2;
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
      const oy = top0 + ((firstAhead === -1 ? rs.length - 1 : firstAhead) - 0.5) * ROW2;
      originY.set(oy);
      originO.set(st.tracked && st.commits.some((c) => c.pushed) ? 1 : 0);
      const h = rs.length ? top0 + (rs.length - 1) * ROW2 + 12 : 30;
      height.set(h);
      if (snap) {
        originY.snap(oy);
        originO.snap(originO.target);
        height.snap(h);
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
        <button class="ib md" aria-label="Copy as Markdown" title="Copy as Markdown">${icon.copy}</button>
        <button class="ib gear" aria-label="Settings" title="Settings">${icon.gear}</button>
        <span class="sp"></span>
        <button class="sw" data-k="autoCommit" role="switch" aria-checked="false" aria-label="Auto commit" title="Auto commit">${icon.commit}<span class="tr"><span class="kn"></span></span></button>
        <button class="sw" data-k="autoPush" role="switch" aria-checked="false" aria-label="Auto push" title="Auto push">${icon.push}<span class="tr"><span class="kn"></span></span></button>
      </div>
    </div>`);
    root.appendChild(el);
    const $ = (s) => el.querySelector(s);
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
      const sw = switches.find((s) => s.dataset.k === k);
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
    btnCommit.addEventListener("click", (e) => {
      if (isUserInput(e)) store.commit();
    });
    btnPush.addEventListener("click", (e) => {
      if (isUserInput(e)) store.push();
    });
    for (const key of ["autoCommit", "autoPush"]) {
      const sw = switches.find((s) => s.dataset.k === key);
      sw.addEventListener("click", (e) => {
        if (!isUserInput(e)) return;
        store.setAuto(key, !store.state.settings[key]);
      });
    }
    $(".gear").addEventListener("click", () => {
      onRequestClose?.();
      openSettings?.();
    });
    if (!openSettings) $(".gear").hidden = true;
    for (const [sel, key] of [[".ib.commit", "commit"], [".ib.push", "push"], [".link", "copyLink"], [".ib.md", "copyMarkdown"], [".gear", "openSettings"], [".sw[data-k=autoCommit]", "autoCommit"], [".sw[data-k=autoPush]", "autoPush"]]) {
      const b = $(sel);
      const text2 = label(key);
      if (b && text2 !== key) {
        b.setAttribute("aria-label", text2);
        b.title = text2;
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
    let copying = false;
    $(".ib.md").addEventListener("click", async (e) => {
      if (!isUserInput(e) || copying || !store.copyMarkdown) return;
      const b = $(".ib.md");
      copying = true;
      const ok = await store.copyMarkdown().catch(() => false);
      copying = false;
      setHTML(b, ok ? icon.check : icon.alert);
      b.classList.add(ok ? "done" : "fail");
      setTimeout(() => {
        setHTML(b, icon.copy);
        b.classList.remove("done", "fail");
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
    function refreshLens(w, h) {
      const key = `${Math.round(w)}x${Math.round(h / 8)}`;
      if (key === lensKey || w < 50) return;
      lensKey = key;
      applyLens(root, glassB, { w: el.offsetWidth, h: el.offsetHeight, r: 16, bezel: 14, scale: 26, blur: 16, sat: 1.3, bright: 1.04 });
    }
    function place(p) {
      placement = p;
      el.style.right = `${p.right}px`;
      const h = el.offsetHeight;
      el.style.top = `${clamp(p.centerY - h / 2, 12, Math.max(12, innerHeight - h - 12))}px`;
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
    const make = (kind, glyph, extra = "") => {
      const b = document.createElement("button");
      b.className = `ab lg ${kind}`;
      const text2 = label(kind === "start" ? "track" : kind);
      b.setAttribute("aria-label", text2);
      b.title = text2;
      b.tabIndex = -1;
      setHTML(b, `<div class="lg-b"></div><div class="lg-h"></div>${glyph}${extra}`);
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
    const onUserClick = (fn) => (e) => {
      if (isUserInput(e)) fn();
    };
    buttons.start.addEventListener("click", onUserClick(() => store.init()));
    buttons.cancel.addEventListener("click", onUserClick(() => store.cancelInit?.()));
    buttons.commit.addEventListener("click", onUserClick(() => store.commit()));
    buttons.push.addEventListener("click", onUserClick(() => store.push()));
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
        const on = idx >= 0;
        const s = show[kind];
        s.set(on ? 1 : 0);
        s.step(dt);
        const k = clamp((at.reveal - (on ? idx : i) * 0.15) / 0.85, 0, 1) * clamp(s.value, 0, 1);
        if (!on && s.value < 0.01) {
          b.style.opacity = "0";
          b.style.pointerEvents = "none";
          continue;
        }
        const slot = on ? idx : 0;
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
        if (on) {
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
  var SCROLL_SPEED = 260;
  var SCROLL_LAG = 14;
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
    const $ = (s) => root.querySelector(s);
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
    let scrolledAt = -Infinity;
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
    let capCount = 0;
    let capStep = 0;
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
    const pick2 = (pool) => {
      const total = pool.reduce((s, [, w]) => s + w, 0);
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
        const s = Math.random() > 0.5 ? 1 : -1;
        bx.kick(110 * s);
        tilt.kick(-70 * s);
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
        const s = sats.find((x) => !x.dying);
        if (!s) return acts.glance();
        follow(() => ({ x: +s.el.getAttribute("cx"), y: +s.el.getAttribute("cy") }), 2300);
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
      const s = {
        el: mk2("circle", { class: "sat", r: 6.4 }, satsG),
        a: angle,
        w: (0.35 + Math.random() * 0.25) * (Math.random() > 0.5 ? 1 : -1),
        ph: Math.random() * 6,
        rad: new Spring(rad, { stiffness: 110, damping: 13 }).set(R0 + 15),
        dying: false
      };
      sats.push(s);
    }
    function syncSats() {
      const want = Math.min(shown, MAX_SATS);
      const alive = sats.filter((s) => !s.dying);
      while (alive.length < want) {
        addSat(Math.random() * Math.PI * 2, 0);
        alive.push(sats[sats.length - 1]);
      }
      while (alive.length > want) {
        const s = alive.pop();
        s.dying = true;
        s.rad.set(0);
      }
    }
    function absorbAll() {
      sats.forEach((s, i) => {
        s.dying = true;
        later(i * 40, () => s.rad.config(170, 22).set(0));
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
      const full = sats.filter((s) => !s.dying).length >= MAX_SATS;
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
    function captureBeat(d) {
      if (d.stage === "loading") {
        if (d.count <= capCount) return;
        capCount = d.count;
        sqy.kick(1.6);
        by.kick(-170);
        blink();
        return;
      }
      const step = Math.floor((d.p - 0.25) / 0.75 * 5);
      if (step <= capStep) return;
      capStep = step;
      sqy.kick(-0.7);
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
        capCount = 0;
        capStep = 0;
      } else if (type === "progress" && !motion.reduced) {
        captureBeat(d);
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
        sats.splice(0).forEach((s) => s.el.remove());
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
      scrolledAt = performance.now();
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
      const capturing = st.phase === "capturing" && !motion.reduced;
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
        by.set(HY + (capturing ? st.captureStage === "loading" ? -7 : 3 : 0));
      }
      if (scrollImpulse) {
        by.velocity = clamp(by.velocity + clamp(scrollImpulse, -220, 220), -SCROLL_SPEED, SCROLL_SPEED);
        scrollImpulse = 0;
      }
      bx.step(dt);
      by.step(dt);
      if (!dragging && now - scrolledAt < 700 && Math.abs(by.value - by.target) > SCROLL_LAG) {
        by.value = by.target + Math.sign(by.value - by.target) * SCROLL_LAG;
        by.velocity = 0;
      }
      sqx.step(dt);
      sqy.step(dt);
      const thinking = aiPhase === "thinking" && !sleeping;
      const streaming = aiPhase === "streaming" && !sleeping;
      const still = motion.reduced;
      tilt.set(thinking && !still ? Math.sin(t2 * 0.5) * 5 : 0);
      const tug = capturing && st.captureStage === "loading";
      poseX.set(tug ? 0.9 : thinking ? 0.97 : 1);
      poseY.set(tug ? 1.13 : thinking ? 1.04 : 1);
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
        const s = sats[i];
        s.rad.step(dt);
        if (s.dying && s.rad.value < 3) {
          s.el.remove();
          sats.splice(i, 1);
          continue;
        }
        if (!still) s.a += dt * s.w;
        const r = Math.max(0, s.rad.value + (still ? 0 : Math.sin(t2 * 1.9 + s.ph) * 3.5));
        s.el.setAttribute("cx", (cx + Math.cos(s.a) * r).toFixed(2));
        s.el.setAttribute("cy", (cy + Math.sin(s.a) * r * 0.9).toFixed(2));
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
          acts[pick2([["glance", 34], ["blink2", 14], ["sigh", 10], ["shift", 10], ["stretch", 7], ["watchDroplet", sats.length ? 16 : 0], ["hop", 3]])]();
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
      let h = 1;
      if (m === "content") h = 0.3;
      else if (m === "error") h = 0.45;
      else if (m === "focus") h = 1.1;
      else if (m === "peek") h = 0.35;
      else if (m === "sleep" || m === "closed") h = 0;
      if (m === "idle" || m === "content") h *= clamp(lidCap.value, 0, 1);
      if (thinking && now - aiT0 > 5e3 && m === "idle") h *= 0.6;
      const open = clamp(lid.value, 0, 1) * h;
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
            if (sats.filter((s) => !s.dying).length < MAX_SATS) landed(a2);
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

  // src/content/ui/variants/line.js
  var BW = 150;
  var BH = 420;
  var MARGIN = 7;
  var MAXR = 9;
  var W_C = 8;
  var W_E = 24;
  var G_C = 11;
  var G_E = 20;
  var NS4 = "http://www.w3.org/2000/svg";
  var mk3 = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS4, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  var css2 = `
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
    setHTML(root, `<style>${glassCSS}${panelCSS}${actionsCSS}${css2}</style>
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
    const $ = (s) => root.querySelector(s);
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
          const g = mk3("g", { class: `bd ${r.type}` }, beadsG);
          const shape = r.type === "work" ? mk3("circle", { class: "wk", r: 2.6 }, g) : mk3("circle", { class: "dt", r: 2 }, g);
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
      if (!isUserInput(e)) return;
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
    const release = (e) => {
      if (!pressed) return;
      pressed = null;
      if (dragging) {
        dragging = false;
        box.classList.remove("drag");
        return;
      }
      if (!isUserInput(e) || e.type !== "pointerup") return;
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
        const s = 1 + e * 0.3 + lens(y) * 0.9;
        b.g.setAttribute("transform", `translate(${cx.toFixed(2)} ${y.toFixed(2)}) scale(${s.toFixed(3)})`);
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

  // src/content/ui/variants/dot.js
  var S = 40;
  var R = S / 2;
  var EDGE = 18;
  var RING = 13.5;
  var STEP = 24;
  var NS5 = "http://www.w3.org/2000/svg";
  var mk4 = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS5, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  var css3 = `
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
    setHTML(root, `<style>${glassCSS}${panelCSS}${actionsCSS}${css3}</style>
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
    const $ = (s) => root.querySelector(s);
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
        const t2 = { el: mk4("circle", { class: "tick", r: 1.8 }, ticksG), a: new Spring(-90, { stiffness: 260, damping: 30 }), o: new Spring(0, { stiffness: 400, damping: 40 }).set(1), dying: false };
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
    function render2() {
      const st = store.state;
      orb.dataset.s = stateName();
      arc.setAttribute("stroke-dashoffset", st.phase === "capturing" ? String(1 - st.progress) : "0");
      const capText = st.captureStage === "reading" ? String(Math.round((st.progress - 0.25) / 0.75 * 100)) : String(st.captureCount ?? 0);
      rollText(num, st.phase === "capturing" ? capText : st.tracked && st.staged.length ? String(st.staged.length) : "");
      syncTicks();
    }
    const unsub = store.subscribe((type) => {
      if (type === "pushed") collectTicks();
      render2();
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
    render2();
    return {
      destroy() {
        stop();
        unsub();
        actions.destroy();
        panel.destroy();
      }
    };
  }

  // src/content/widget.ts
  var MOUNT = {
    creature: mountCreature,
    line: mountLine,
    dot: mountDot
  };
  var Widget = class {
    constructor(store, openSettings) {
      this.store = store;
      this.openSettings = openSettings;
    }
    store;
    openSettings;
    host = null;
    mounted = null;
    style = null;
    keepAlive = 0;
    show(style, theme) {
      if (this.host && this.style === style) {
        this.setTheme(theme);
        return;
      }
      this.hide();
      const host = document.createElement("gitchat-ui");
      host.dataset.theme = theme;
      document.documentElement.appendChild(host);
      this.host = host;
      this.style = style;
      this.mounted = MOUNT[style](host, this.store, { label: (k) => t(k), openSettings: this.openSettings });
      this.keepAlive = window.setInterval(() => {
        if (this.host && !this.host.isConnected) document.documentElement.appendChild(this.host);
      }, 2e3);
    }
    setTheme(theme) {
      if (this.host && this.host.dataset.theme !== theme) this.host.dataset.theme = theme;
    }
    hide() {
      clearInterval(this.keepAlive);
      this.mounted?.destroy();
      this.host?.remove();
      this.mounted = null;
      this.host = null;
      this.style = null;
    }
    get visible() {
      return !!this.host;
    }
  };

  // src/content/capture/observer.ts
  var DONE_QUIET_MS = 700;
  var STALL_MS = 10 * 6e4;
  var MAX_SETTLE_MS = 2e4;
  var WATCHED = ["data-is-streaming", "disabled", "aria-busy", "data-state"];
  var AiObserver = class {
    constructor(adapter, doc, on, opts = {}) {
      this.adapter = adapter;
      this.doc = doc;
      this.on = on;
      this.stallMs = opts.stallMs ?? STALL_MS;
      this.maxSettleMs = opts.maxSettleMs ?? MAX_SETTLE_MS;
    }
    adapter;
    doc;
    on;
    phase = "idle";
    mo = null;
    timer = 0;
    poll = 0;
    idleSince = 0;
    lastLen = 0;
    stopped = false;
    /** Last change inside the transcript (not elsewhere on the page). */
    lastChange = 0;
    /** Turn the AI was last seen working on (see Adapter.activeTurnId). */
    latched = null;
    /** Set when a busy phase stalled; busy signals are ignored until the transcript changes again. */
    stalledAt = 0;
    /** A turn started and has not reported its answer yet (also while stalled). */
    outstanding = false;
    /** Counts turns: +1 each time the AI starts working (each "sent"). */
    turns = 0;
    stallMs;
    maxSettleMs;
    /** What the widget shows (a stalled turn shows as idle). */
    get current() {
      return this.phase;
    }
    /** True only when no turn is in progress — a stalled turn is not finished. */
    get settled() {
      return !this.outstanding;
    }
    get stalled() {
      return this.stalledAt > 0;
    }
    /** Identity of the current/last turn: changes whenever the AI starts working again. */
    get turn() {
      return this.turns;
    }
    /** True between start() and stop(). */
    get running() {
      return this.mo !== null;
    }
    /** Starts watching (again after stop()); does nothing while already running. */
    start() {
      if (this.mo) return;
      this.stopped = false;
      this.lastChange = performance.now();
      this.mo = new MutationObserver((records) => this.onMutations(records));
      this.mo.observe(this.doc.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: [.../* @__PURE__ */ new Set([...WATCHED, ...this.adapter.watchAttributes ?? []])]
      });
      this.poll = window.setInterval(() => this.tick(), 1e3);
      this.tick();
    }
    /** Stops watching: no observer, no timers (start() resumes). */
    stop() {
      this.stopped = true;
      this.mo?.disconnect();
      this.mo = null;
      clearTimeout(this.timer);
      this.timer = 0;
      clearInterval(this.poll);
      this.poll = 0;
    }
    /** Forget the current phase (call after switching to another chat). */
    reset() {
      this.lastLen = 0;
      this.idleSince = 0;
      this.latched = null;
      this.stalledAt = 0;
      this.outstanding = false;
      this.turns++;
      this.lastChange = performance.now();
      this.phase = "idle";
    }
    root = { el: null, at: -Infinity };
    onMutations(records) {
      const now = performance.now();
      if (now - this.root.at > 1e3 || !this.root.el?.isConnected) this.root = { el: this.adapter.scrollContainer(this.doc), at: now };
      const root = this.root.el;
      if (!root || records.some((r) => root.contains(r.target))) this.lastChange = now;
      this.schedule();
    }
    schedule() {
      if (this.timer || this.stopped) return;
      this.timer = window.setTimeout(() => {
        this.timer = 0;
        this.tick();
      }, 120);
    }
    tick() {
      if (this.stopped) return;
      const now = performance.now();
      const next = this.adapter.aiPhase(this.doc) ?? this.guess();
      if (next !== "idle") {
        if (this.stalledAt) {
          if (this.lastChange <= this.stalledAt) return;
          this.stalledAt = 0;
          this.on.stalled?.(false);
          this.set(next);
          return;
        }
        this.idleSince = 0;
        this.latched = this.adapter.activeTurnId?.(this.doc) ?? this.latched;
        const wasIdle = !this.outstanding;
        this.set(next);
        if (wasIdle) {
          this.outstanding = true;
          this.turns++;
          this.lastChange = now;
          this.on.sent();
          return;
        }
        this.checkStall(now);
        return;
      }
      if (!this.outstanding) return;
      if (this.latched && this.adapter.hasTurn && !this.adapter.hasTurn(this.doc, this.latched)) {
        this.idleSince = 0;
        this.checkStall(now);
        return;
      }
      if (!this.idleSince) this.idleSince = now;
      const quietFor = now - Math.max(this.idleSince, this.lastChange);
      if (quietFor < (this.adapter.doneQuietMs ?? DONE_QUIET_MS) && now - this.idleSince < this.maxSettleMs) {
        this.schedule();
        return;
      }
      this.idleSince = 0;
      this.latched = null;
      this.outstanding = false;
      if (this.stalledAt) {
        this.stalledAt = 0;
        this.on.stalled?.(false);
      }
      this.set("idle");
      this.on.answered();
    }
    /** No progress in the transcript for a long time: stop showing "thinking", keep the turn open. */
    checkStall(now) {
      if (!this.outstanding || this.stalledAt || now - this.lastChange < this.stallMs) return;
      this.stalledAt = now;
      this.set("idle");
      this.on.stalled?.(true);
    }
    guess() {
      if (!this.adapter.isGenerating(this.doc)) return "idle";
      const msgs = this.adapter.messages(this.doc);
      const last2 = msgs[msgs.length - 1];
      if (!last2 || last2.role !== "assistant") return "thinking";
      const len = (this.adapter.body(last2).textContent ?? "").length;
      const growing = len > 0 && len !== this.lastLen;
      this.lastLen = len;
      return growing || this.phase === "streaming" && len > 0 ? "streaming" : "thinking";
    }
    set(p) {
      if (p === this.phase) return;
      const prev = this.phase;
      this.phase = p;
      this.on.phase(p, prev);
    }
  };

  // src/content/capture/snapshot.ts
  function fingerprint(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }
  var BLOCKS = /* @__PURE__ */ new Set(["P", "DIV", "LI", "PRE", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5", "H6", "TR", "SECTION", "ARTICLE"]);
  function userText(body) {
    let out = "";
    const walk = (n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        out += n.textContent ?? "";
        return;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      const el = n;
      if (el.tagName === "BR") {
        out += "\n";
        return;
      }
      if (el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === "BUTTON" || el.classList.contains("sr-only")) return;
      const block2 = BLOCKS.has(el.tagName);
      if (block2 && out && !out.endsWith("\n")) out += "\n";
      for (const c of Array.from(el.childNodes)) walk(c);
      if (block2 && !out.endsWith("\n")) out += "\n";
    };
    walk(body);
    return out.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[ \t]+$/g, "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function captureMessage(adapter, node) {
    const body = adapter.body(node);
    if (node.role === "user") return { id: node.id, role: "user", markdown: userText(body), kinds: [] };
    const { markdown, kinds } = toMarkdown(body, adapter.markdown);
    return { id: node.id, role: "assistant", markdown, kinds };
  }
  function assignIds(list2, prior = []) {
    const taken = new Set(prior.map((m) => m.id));
    if (!prior.length) return stampFresh(list2, taken);
    const offset = alignOffset(prior, list2);
    const out = [];
    for (let i = 0; i < list2.length; i++) {
      const m = list2[i];
      if (m.id) {
        out.push(m);
        taken.add(m.id);
        continue;
      }
      const aligned = prior[offset + i];
      if (aligned && sameRow(aligned, m) && !out.some((x) => x.id === aligned.id)) {
        out.push({ ...m, id: aligned.id });
        taken.add(aligned.id);
        continue;
      }
      const id = freshId(m, taken);
      taken.add(id);
      out.push({ ...m, id });
    }
    return out;
  }
  function alignOffset(prior, list2) {
    let bestOff = prior.length;
    let bestScore = 0;
    let tied = false;
    for (let off = 0; off < prior.length; off++) {
      let stable = 0;
      let exact = 0;
      let conflict = false;
      for (let i = 0; i < list2.length; i++) {
        const p = prior[off + i];
        const m = list2[i];
        if (!p) continue;
        if (m.id) {
          if (m.id !== p.id || m.role !== p.role) {
            conflict = true;
            break;
          }
          stable++;
        } else if (m.role === p.role && m.markdown === p.markdown) exact++;
      }
      if (conflict || !stable && exact < 2) continue;
      const score = stable * (list2.length + 1) + exact;
      if (score > bestScore) {
        bestScore = score;
        bestOff = off;
        tied = false;
      } else if (score === bestScore) tied = true;
    }
    return tied ? prior.length : bestOff;
  }
  function sameRow(prior, m) {
    if (m.id && m.id !== prior.id) return false;
    if (prior.role !== m.role) return false;
    if (prior.markdown === m.markdown) return true;
    const short = prior.markdown.length <= m.markdown.length ? prior.markdown : m.markdown;
    const long = short === prior.markdown ? m.markdown : prior.markdown;
    return short.length > 0 && long.startsWith(short);
  }
  function stampFresh(list2, taken) {
    return list2.map((m) => {
      if (m.id) {
        taken.add(m.id);
        return m;
      }
      const id = freshId(m, taken);
      taken.add(id);
      return { ...m, id };
    });
  }
  function freshId(m, taken) {
    const base = `${m.role[0]}-${fingerprint(`${m.role}
${m.markdown}`)}`;
    let n = 0;
    let id = base;
    while (taken.has(id)) {
      n += 1;
      id = `${base}-${n}`;
    }
    return id;
  }
  function captureVisible(adapter, doc, nodes = adapter.messages(doc)) {
    return assignIds(nodes.map((n) => captureMessage(adapter, n)).filter((m) => m.markdown || m.kinds?.length));
  }
  function canonicalPageUrl(adapter, href) {
    try {
      const url = new URL(href);
      return adapter.canonicalUrl?.(url) ?? `${url.origin}${url.pathname}`;
    } catch {
      return href.split("#")[0] ?? href;
    }
  }
  function readPage(adapter, doc) {
    const nodes = adapter.messages(doc);
    return {
      messages: captureVisible(adapter, doc, nodes),
      serviceIds: nodes.flatMap((n) => n.id ? [n.id] : []),
      url: canonicalPageUrl(adapter, location.href),
      title: adapter.title(doc),
      capturedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  function scrollReversed(_adapter, el) {
    if (!el) return false;
    try {
      const dir = getComputedStyle(el).flexDirection;
      return dir === "column-reverse";
    } catch {
      return false;
    }
  }
  function isAtEnd(adapter, doc) {
    if (!adapter.virtualized) return true;
    const sc = adapter.scrollContainer(doc);
    if (!sc) return false;
    const slack = Math.max(40, sc.clientHeight * 0.5);
    if (scrollReversed(adapter, sc)) return -Math.min(0, sc.scrollTop) <= slack;
    const remaining = sc.scrollHeight - sc.scrollTop - sc.clientHeight;
    return remaining <= slack;
  }
  function artifactAssetName(art) {
    return `${assetSlug(art.title)}-${fingerprint(art.key)}.html`;
  }
  var escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function linkMarker(md, title, name) {
    const re = new RegExp(`^(> \\*\\*(?:Artifact|File):\\*\\* )${escapeRe(title)}[ \\t]*$`, "m");
    if (!re.test(md)) return null;
    const label = title.replace(/[[\]]/g, "\\$&");
    return md.replace(re, (_m, prefix) => `${prefix}[${label}](gitchat-asset:${name})`);
  }
  function attachArtifacts(messages, artifacts) {
    if (!artifacts.length) return messages;
    const out = messages.map((m) => ({ ...m, assets: [...m.assets ?? []] }));
    const byId = new Map(out.map((m) => [m.id, m]));
    for (const art of artifacts) {
      const name = artifactAssetName(art);
      const owner = art.messageId ? byId.get(art.messageId) : [...out].reverse().find((m) => m.role === "assistant" && linkMarker(m.markdown, art.title, name) !== null);
      if (!owner) continue;
      const linked = linkMarker(owner.markdown, art.title, name);
      if (linked === null) continue;
      owner.markdown = linked;
      owner.assets = owner.assets.filter((a) => a.name !== name);
      owner.assets.push({ name, mime: "text/html", data: art.html, encoding: "utf8" });
      owner.kinds = [.../* @__PURE__ */ new Set([...owner.kinds ?? [], "viz"])];
    }
    return out;
  }
  function makeSnapshot(adapter, chatId, read, messages, complete, atEnd = false, view, startConfirmed = false) {
    return {
      service: adapter.service,
      chatId,
      url: read.url,
      title: read.title,
      messages,
      capturedAt: read.capturedAt,
      complete,
      ...complete ? {} : { atEnd },
      ...complete && startConfirmed ? { startConfirmed: true } : {},
      ...view ? { view } : {}
    };
  }

  // src/content/capture/init.ts
  var SMALL_CHAT_MESSAGES = 8;
  var InitIncompleteError = class extends Error {
    /**
     * `stale`: the page still showed the previous chat's messages (the new one had not rendered).
     * `stalled`: reading stopped making progress (the list would not scroll further).
     */
    constructor(reason) {
      super(`init incomplete: ${reason}`);
      this.reason = reason;
      this.name = "InitIncompleteError";
    }
    reason;
  };
  var aborted = () => new DOMException("Cancelled", "AbortError");
  var sleep = (ms, signal) => new Promise((resolve, reject) => {
    if (signal.aborted) return reject(aborted());
    const onAbort = () => {
      clearTimeout(t2);
      reject(aborted());
    };
    const t2 = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  function settle(root, quietMs, maxMs, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(aborted());
      let quiet = 0;
      const finish = (err) => {
        mo.disconnect();
        clearTimeout(quiet);
        clearTimeout(cap);
        signal.removeEventListener("abort", onAbort);
        if (err) reject(err);
        else resolve();
      };
      const onAbort = () => finish(aborted());
      const mo = new MutationObserver(() => {
        clearTimeout(quiet);
        quiet = window.setTimeout(() => finish(), quietMs);
      });
      mo.observe(root, { subtree: true, childList: true });
      quiet = window.setTimeout(() => finish(), quietMs);
      const cap = window.setTimeout(() => finish(), maxMs);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
  function scrollTowardOldest(el, reversed) {
    el.scrollTop = reversed ? Math.min(0, el.clientHeight - el.scrollHeight) : 0;
    el.dispatchEvent(new Event("scroll"));
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: -800, bubbles: true }));
  }
  function fitsOnScreen(el, messages) {
    return messages > 0 && el.scrollHeight <= el.clientHeight + 4;
  }
  function oldestScroll(el, reversed) {
    return reversed ? Math.min(0, el.clientHeight - el.scrollHeight) : 0;
  }
  function newestScroll(el, reversed) {
    return reversed ? 0 : Math.max(0, el.scrollHeight - el.clientHeight);
  }
  function atOldest(el, reversed) {
    return reversed ? el.scrollTop <= oldestScroll(el, true) + 2 : el.scrollTop <= 2;
  }
  function atNewest(el, reversed) {
    return reversed ? el.scrollTop >= -2 : el.scrollTop >= newestScroll(el, false) - 2;
  }
  function clampScroll(el, reversed, y) {
    return reversed ? Math.max(oldestScroll(el, true), Math.min(0, y)) : Math.max(0, Math.min(newestScroll(el, false), y));
  }
  function walkProgress(el, reversed) {
    if (reversed) {
      const span = -oldestScroll(el, true);
      return span > 0 ? (el.scrollTop - oldestScroll(el, true)) / span : 1;
    }
    const max = el.scrollHeight - el.clientHeight;
    return max > 0 ? el.scrollTop / max : 1;
  }
  function anchorKey(node) {
    if (node.id) return node.id;
    const text2 = (node.el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    return text2 ? `${node.role}
${text2}` : null;
  }
  function measureAnchor(adapter, doc, scroller) {
    const fromBottom = scroller.scrollHeight - scroller.scrollTop;
    const blank = { key: null, viewportOffset: 0, scrollTop: scroller.scrollTop, fromBottom, placed: false };
    const box = scroller.getBoundingClientRect();
    if (box.height <= 0) return blank;
    for (const n of adapter.messages(doc)) {
      const r = n.el.getBoundingClientRect();
      if (r.height <= 0 || r.bottom <= box.top + 1 || r.top >= box.bottom - 1) continue;
      const key = anchorKey(n);
      if (!key) continue;
      return { key, viewportOffset: r.top - box.top, scrollTop: scroller.scrollTop, fromBottom, placed: true };
    }
    return blank;
  }
  function restoreAnchor(adapter, doc, scroller, anchor) {
    if (!anchor.placed || !anchor.key) return false;
    const el = adapter.messages(doc).find((n) => anchorKey(n) === anchor.key)?.el;
    if (!(el instanceof HTMLElement)) return false;
    const box = scroller.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (box.height <= 0 || r.height <= 0) return false;
    scroller.scrollTop = scroller.scrollTop + (r.top - box.top - anchor.viewportOffset);
    return true;
  }
  var OrderedMessages = class {
    order = [];
    byId = /* @__PURE__ */ new Map();
    pos = /* @__PURE__ */ new Map();
    posStale = false;
    /**
     * Adds one window. While walking, the longest rendering of a row wins (it may have been half
     * rendered before); a `settled` read (after the AI finished) replaces whatever was seen before.
     */
    add(batch, opts = {}) {
      let anchor = null;
      let before = [];
      for (const m of batch) {
        let at = this.indexOf(m.id);
        if (at >= 0) {
          const prev = this.byId.get(m.id);
          if (opts.settled || !prev || m.markdown.length >= prev.markdown.length) this.byId.set(m.id, m);
          if (anchor === null && before.length) {
            this.insert(at, before);
            at += before.length;
            before = [];
          }
          anchor = at;
        } else if (anchor === null) {
          before.push(m);
        } else {
          this.insert(anchor + 1, [m]);
          anchor++;
        }
      }
      if (before.length) this.insert(this.order.length, before);
    }
    get size() {
      return this.order.length;
    }
    has(id) {
      return this.byId.has(id);
    }
    /** Reorders by a known position per message (only when every message has one). */
    sortBy(pos) {
      if (!this.order.every((id) => pos.has(id))) return;
      this.order.sort((a, b) => pos.get(a) - pos.get(b));
      this.posStale = true;
    }
    list() {
      return this.order.map((id) => this.byId.get(id)).filter(Boolean);
    }
    indexOf(id) {
      if (!this.byId.has(id)) return -1;
      if (this.posStale) {
        this.pos = new Map(this.order.map((x, i) => [x, i]));
        this.posStale = false;
      }
      return this.pos.get(id) ?? -1;
    }
    insert(at, msgs) {
      const append = at === this.order.length;
      this.order.splice(at, 0, ...msgs.map((m) => m.id));
      for (const [i, m] of msgs.entries()) {
        this.byId.set(m.id, m);
        if (append && !this.posStale) this.pos.set(m.id, at + i);
      }
      if (!append) this.posStale = true;
    }
  };
  function readStep(clientHeight) {
    return Math.max(1, Math.min(clientHeight - 24, Math.round(clientHeight * 0.7)));
  }
  function rowsInView(adapter, doc, scroller) {
    if (!scroller.isConnected) return false;
    const box = scroller.getBoundingClientRect();
    if (box.height <= 0) return true;
    return adapter.messages(doc).some((n) => {
      const r = n.el.getBoundingClientRect();
      return r.height > 0 && r.bottom > box.top && r.top < box.bottom;
    });
  }
  async function waitForRows(adapter, doc, scroller, signal, maxMs) {
    await settle(scroller, 120, 1200, signal);
    const start = performance.now();
    while (!rowsInView(adapter, doc, scroller) && performance.now() - start < maxMs) await settle(scroller, 80, 400, signal);
  }
  function missingRanges(seen, total) {
    const out = [];
    for (let p = 1; p <= total; p++) {
      if (seen.has(p)) continue;
      const last2 = out[out.length - 1];
      if (last2 && last2[1] === p - 1) last2[1] = p;
      else out.push([p, p]);
    }
    return out;
  }
  async function captureFullHistory(adapter, doc, opts) {
    const { signal, onProgress } = opts;
    signal.throwIfAborted();
    const found = adapter.scrollContainer(doc);
    if (!found?.isConnected) throw new InitIncompleteError("no-scroller");
    let scroller = found;
    let anchor = measureAnchor(adapter, doc, scroller);
    const retarget = () => {
      if (!scroller.isConnected) throw new InitIncompleteError("no-scroller");
      const next = adapter.scrollContainer(doc);
      if (!next?.isConnected) throw new InitIncompleteError("no-scroller");
      if (next === scroller) return;
      scroller = next;
      anchor = measureAnchor(adapter, doc, scroller);
    };
    const maxLoadMs = opts.maxLoadMs ?? 10 * 6e4;
    const rowWaitMs = opts.rowWaitMs ?? 3e3;
    const stallMs = opts.stallMs ?? 25e3;
    const acc = new OrderedMessages();
    const arts = /* @__PURE__ */ new Map();
    const readPos = /* @__PURE__ */ new Set();
    const otherPos = /* @__PURE__ */ new Set();
    const emptyPos = /* @__PURE__ */ new Set();
    const emptyAt = /* @__PURE__ */ new Map();
    const readIds = /* @__PURE__ */ new Set();
    const posById = /* @__PURE__ */ new Map();
    let readAt = (/* @__PURE__ */ new Date()).toISOString();
    let lastWindow = null;
    const hasContent = (m) => !!(m.markdown || m.kinds?.length);
    const covered = () => /* @__PURE__ */ new Set([...readPos, ...[...otherPos].filter((p) => !emptyPos.has(p))]);
    const unread = () => [...emptyAt.keys()].filter((id) => !readIds.has(id));
    const read = () => {
      const rows = adapter.messages(doc).map((node) => ({ node, msg: captureMessage(adapter, node), pos: adapter.positionOf?.(node) ?? null }));
      const messagePos = /* @__PURE__ */ new Set();
      for (const r of rows) {
        if (r.pos) messagePos.add(r.pos);
        if (hasContent(r.msg)) {
          if (r.pos) {
            readPos.add(r.pos);
            emptyPos.delete(r.pos);
          }
          if (r.node.id) readIds.add(r.node.id);
        } else {
          if (r.pos && !readPos.has(r.pos)) emptyPos.add(r.pos);
          if (r.node.id && !emptyAt.has(r.node.id)) emptyAt.set(r.node.id, scroller.scrollTop);
        }
      }
      for (const p of adapter.rowPositions?.(doc) ?? []) if (!messagePos.has(p)) otherPos.add(p);
      const kept = rows.filter((r) => hasContent(r.msg));
      const msgs = assignIds(
        kept.map((r) => r.msg),
        acc.list()
      );
      kept.forEach((r, i) => {
        if (r.pos) posById.set(msgs[i].id, r.pos);
      });
      return msgs;
    };
    const harvest = (settled = false) => {
      const batch = read();
      const overlaps = !lastWindow || !lastWindow.size || !batch.length || batch.some((m) => lastWindow.has(m.id));
      if (batch.length) lastWindow = new Set(batch.map((m) => m.id));
      acc.add(batch, { settled });
      readAt = (/* @__PURE__ */ new Date()).toISOString();
      return overlaps;
    };
    const collectArtifacts = async (fresh = false) => {
      if (!opts.artifacts) return;
      for (const a of await opts.artifacts(fresh ? /* @__PURE__ */ new Set() : new Set(arts.keys()))) if (fresh || !arts.has(a.key)) arts.set(a.key, a);
    };
    const scrollTo = async (y) => {
      if (!scroller.isConnected) throw new InitIncompleteError("no-scroller");
      scroller.scrollTop = clampScroll(scroller, scrollReversed(adapter, scroller), y);
      scroller.dispatchEvent(new Event("scroll"));
      await waitForRows(adapter, doc, scroller, signal, rowWaitMs);
    };
    const walk = async (step, report) => {
      let gapless = true;
      lastWindow = null;
      const reversed = scrollReversed(adapter, scroller);
      await scrollTo(oldestScroll(scroller, reversed));
      let furthest = -Infinity;
      let known = -1;
      let movedAt = performance.now();
      for (; ; ) {
        signal.throwIfAborted();
        if (!harvest()) gapless = false;
        await collectArtifacts();
        const axis = scrollReversed(adapter, scroller);
        if (report) onProgress({ stage: "reading", count: acc.size, progress: 0.25 + 0.75 * walkProgress(scroller, axis) });
        if (atNewest(scroller, axis)) return gapless;
        if (scroller.scrollTop > furthest + 1 || acc.size > known) {
          furthest = Math.max(furthest, scroller.scrollTop);
          known = acc.size;
          movedAt = performance.now();
        } else if (performance.now() - movedAt >= stallMs) {
          throw new InitIncompleteError("stalled");
        }
        await scrollTo(scroller.scrollTop + step);
      }
    };
    const revisit = async () => {
      await sleep(rowWaitMs, signal);
      harvest();
      await collectArtifacts();
    };
    const revisitUnread = async () => {
      for (let round = 0; round < 2 && unread().length; round++) {
        if (!adapter.virtualized) {
          await revisit();
          continue;
        }
        for (const y of new Set(unread().map((id) => emptyAt.get(id)))) {
          await scrollTo(y);
          await revisit();
        }
      }
    };
    try {
      const loadStart = performance.now();
      const topQuietMs = adapter.topQuietMs ?? 2500;
      let quietSince = 0;
      let stable = 0;
      let lastCount = -1;
      let lastHeight = -1;
      for (; ; ) {
        if (performance.now() - loadStart >= maxLoadMs) throw new InitIncompleteError("timeout");
        retarget();
        scrollTowardOldest(scroller, scrollReversed(adapter, scroller));
        await settle(scroller, 450, 4e3, signal);
        const count = adapter.loadedCount(doc) ?? adapter.messages(doc).length;
        const height = scroller.scrollHeight;
        const unchanged = count === lastCount && height === lastHeight && atOldest(scroller, scrollReversed(adapter, scroller));
        stable = unchanged && !adapter.isLoadingOlder(doc) ? stable + 1 : 0;
        if (stable === 1) quietSince = performance.now();
        lastCount = count;
        lastHeight = height;
        onProgress({ stage: "loading", count, progress: 0.25 * (1 - Math.exp(-count / 400)) });
        if (stable >= 1 && fitsOnScreen(scroller, count)) break;
        if (stable >= 2 && performance.now() - quietSince >= topQuietMs) break;
      }
      retarget();
      const startConfirmed = fitsOnScreen(scroller, adapter.messages(doc).length);
      if (adapter.virtualized) {
        const step = readStep(scroller.clientHeight);
        const gapless = await walk(step, true);
        if (adapter.positionOf) {
          for (let attempt = 0; ; attempt++) {
            const total = adapter.loadedCount(doc);
            const missing = total ? missingRanges(covered(), total) : [];
            if (!missing.length) break;
            if (attempt >= 3) {
              const seen = (p) => readPos.has(p) || otherPos.has(p) || emptyPos.has(p);
              if (missing.some(([from, to]) => Array.from({ length: to - from + 1 }, (_, i) => from + i).some((p) => !seen(p)))) {
                throw new InitIncompleteError("coverage");
              }
              break;
            }
            for (const [from, to] of missing) {
              const at = (p) => (p - 1) / total * scroller.scrollHeight;
              for (let y = at(from) - scroller.clientHeight / 2; y <= at(to) + scroller.clientHeight / 2; y += step) {
                await scrollTo(y);
                harvest();
                await collectArtifacts();
              }
            }
          }
          await revisitUnread();
          acc.sortBy(posById);
        } else {
          if (!gapless && !await walk(Math.max(1, Math.round(step / 2)), false)) throw new InitIncompleteError("coverage");
          await revisitUnread();
        }
      } else {
        await waitForRows(adapter, doc, scroller, signal, rowWaitMs);
        harvest();
        await revisitUnread();
        onProgress({ stage: "reading", count: acc.size, progress: 0.9 });
      }
      if (opts.busy?.()) {
        const since = performance.now();
        const maxWait = opts.maxBusyWaitMs ?? 10 * 6e4;
        while (opts.busy()) {
          if (performance.now() - since > maxWait) throw new InitIncompleteError("busy");
          await sleep(400, signal);
        }
      }
      if (adapter.virtualized) await scrollTo(newestScroll(scroller, scrollReversed(adapter, scroller)));
      retarget();
      if (!rowsInView(adapter, doc, scroller)) throw new InitIncompleteError("coverage");
      harvest(true);
      await collectArtifacts(true);
      onProgress({ stage: "reading", count: acc.size, progress: 1 });
      const whole = startConfirmed || acc.size <= SMALL_CHAT_MESSAGES;
      return { messages: acc.list(), artifacts: [...arts.values()], readAt, startConfirmed: whole };
    } finally {
      if (scroller.isConnected && (opts.owns?.() ?? true) && !restoreAnchor(adapter, doc, scroller, anchor)) {
        if (scrollReversed(adapter, scroller)) scroller.scrollTop = anchor.scrollTop;
        else {
          scroller.scrollTop = Math.max(0, scroller.scrollHeight - anchor.fromBottom);
          if (Math.abs(scroller.scrollTop - anchor.scrollTop) < 4) scroller.scrollTop = anchor.scrollTop;
        }
      }
    }
  }

  // src/content/controller.ts
  var STREAM_PACE_MS = 8e3;
  var READY_TIMEOUT_MS = 2e4;
  var SAMPLE_MS = 1500;
  var OWN_PAGE_WAIT_MS = 1e4;
  var AUTO_RESCAN_MS = 6e4;
  var SAME_CHAT_WATCH_MS = 4e3;
  var COPY_REFRESH_MS = 1500;
  var NAVIGATED = "gitchat:navigated";
  var STRENGTH = { manual: 0, sent: 1, answered: 2 };
  var stronger = (a, b) => a && STRENGTH[a] >= STRENGTH[b] ? a : b;
  var isAbort = (e) => e instanceof DOMException && e.name === "AbortError";
  var wait = (ms) => new Promise((r) => setTimeout(r, ms));
  var newView = () => ({ id: crypto.randomUUID(), since: Date.now() });
  var byUser = (signal) => !(signal.reason instanceof DOMException && signal.reason.message === NAVIGATED);
  var Controller = class {
    constructor(adapter) {
      this.adapter = adapter;
      this.store = new UiStore({
        commit: () => void this.call("chat/commit"),
        push: () => void this.call("chat/push"),
        init: () => void this.init(),
        cancelInit: () => this.abort?.abort(),
        setAuto: (key, value) => void this.setAuto(key, value),
        copyMarkdown: () => this.copyMarkdown()
      });
      this.widget = new Widget(this.store, () => void request("app/open-settings", {}).catch(() => {
      }));
      this.observer = new AiObserver(adapter, document, {
        phase: (p) => this.store.setAi(p, p === "streaming" ? STREAM_PACE_MS : void 0),
        sent: () => void this.snapshot("sent"),
        answered: () => void this.snapshot("answered"),
        stalled: (on) => this.store.setStalled(on)
      });
    }
    adapter;
    settings;
    store;
    widget;
    observer;
    port = null;
    key = null;
    chatId = null;
    /** Changes whenever the conversation shown in this tab changes. */
    gen = 0;
    lastUrl = "";
    abort = null;
    lastProgressSent = 0;
    /** Captures run strictly one after another (see the file comment). */
    chain = Promise.resolve();
    /** The strongest capture request that arrived while init was running; replayed afterwards. */
    suppressed = null;
    /** Route generation of a running "read the chat once it is ready" job. */
    reconciling = -1;
    /** This tab's visit to the current chat, sent with every capture (see ChatSnapshot.view). */
    view = newView();
    /** Service message ids last seen on the page while the current chat was shown. */
    sample = null;
    /** Every service message id seen on this visit (a virtualized window is only the latest sample). */
    visitIds = null;
    /** The page shows a transcript that shares no message with this visit: do not write it into the chat. */
    foreign = false;
    /** Same-id URL change whose transcript has not been judged yet (see SAME_CHAT_WATCH_MS). */
    hrefWatch = false;
    watchUntil = 0;
    /** The previous chat's ids, until a message of the new chat is on the page. */
    stale = null;
    /** The chat shown before this one in the tab, for the page-named-id check. */
    prevChatId = null;
    /** Interval timers, cleared when the extension goes away under this script. */
    timers = [];
    watching = false;
    /** The last automatic full read: route generation and time. */
    autoRescan = { gen: -1, at: -Infinity };
    async start() {
      this.settings = await request("settings/get", {});
      this.store.applySettings(this.settings);
      this.connect();
      this.listenToPopup();
      this.timers.push(
        window.setInterval(() => {
          if (this.orphaned()) return;
          void this.checkRoute();
        }, 400),
        window.setInterval(() => {
          if (this.chatId) this.widget.setTheme(this.widgetTheme());
        }, 1500)
      );
      await this.checkRoute(true);
    }
    /** Watch the AI and the page only while a chat is shown (the route poll keeps running). */
    setWatching(on) {
      if (on === this.watching) return;
      this.watching = on;
      if (on) {
        this.adapter.watch?.(document);
        this.observer.start();
      } else {
        this.observer.stop();
      }
    }
    /**
     * The extension was reloaded or removed: this script can no longer reach it. Stop all work and
     * take the widget off the page (the tab needs a reload to get the new version).
     */
    orphaned() {
      if (chrome.runtime?.id) return false;
      for (const t2 of this.timers) clearInterval(t2);
      this.timers = [];
      this.setWatching(false);
      this.abort?.abort(new DOMException(NAVIGATED, "AbortError"));
      this.widget.hide();
      return true;
    }
    // ---- background connection
    connect() {
      try {
        this.port = chrome.runtime.connect({ name: EVENTS_PORT });
      } catch {
        return;
      }
      this.port.onMessage.addListener((ev) => this.onEvent(ev));
      this.port.onDisconnect.addListener(() => {
        this.port = null;
        window.setTimeout(() => {
          if (this.orphaned()) return;
          this.connect();
          void this.checkRoute(true);
        }, 1e3);
      });
    }
    /** Chosen Light/Dark wins over the chat site; Auto keeps following the site. */
    widgetTheme() {
      const theme = this.settings.theme;
      return theme === "light" || theme === "dark" ? theme : this.adapter.theme(document);
    }
    onEvent(ev) {
      if (ev.type === "status") {
        const was = this.store.state.tracked;
        this.store.applyStatus(ev.status);
        const route = this.route();
        if (!was && this.store.state.tracked && route && ev.status.key === route.key && !this.abort) void this.reconcile(route);
      } else if (ev.type === "sync") {
        this.store.setAhead(ev.sync.pending);
      } else if (ev.type === "settings") {
        const prev = this.settings;
        this.settings = ev.settings;
        this.store.applySettings(ev.settings);
        const widgetChanged = prev.widget !== ev.settings.widget;
        const serviceChanged = prev.services[this.adapter.service] !== ev.settings.services[this.adapter.service];
        if (widgetChanged || serviceChanged) {
          this.widget.hide();
          void this.checkRoute(true);
        } else if (prev.theme !== ev.settings.theme && this.chatId) {
          this.widget.setTheme(this.widgetTheme());
        }
      }
    }
    listenToPopup() {
      chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
        if (!msg || msg.gitchat !== 1) return;
        if (msg.type === "content/current") {
          const current = {
            service: this.adapter.service,
            chatId: this.chatId,
            title: this.adapter.title(document),
            status: this.key ? this.statusSnapshot() : null
          };
          reply(current);
        } else if (msg.type === "content/init") {
          void this.init();
          reply(null);
        } else if (msg.type === "content/rescan") {
          void this.init({ rescan: true });
          reply(null);
        } else if (msg.type === "content/refresh") {
          void this.refresh().then(
            (r) => reply(r),
            () => reply({ ok: false, error: t("errCaptureFailed") })
          );
          return true;
        }
      });
    }
    statusSnapshot() {
      if (!this.key || !this.chatId) return null;
      const s = this.store.state;
      const error = s.phase === "error" && s.error ? { error: s.error } : {};
      return {
        ...error,
        key: this.key,
        service: this.adapter.service,
        chatId: this.chatId,
        tracked: s.tracked,
        path: s.path || void 0,
        staged: s.staged,
        commits: s.commits,
        aheadTotal: this.store.ahead,
        phase: s.phase,
        progress: s.progress,
        webUrl: s.webUrl || void 0
      };
    }
    // ---- navigation
    route() {
      return this.key && this.chatId ? { gen: this.gen, key: this.key, chatId: this.chatId } : null;
    }
    /** The route is still the one shown in this tab. */
    live(r) {
      return r.gen === this.gen && this.key === r.key;
    }
    /** The page's URL still belongs to the route (the route itself is only polled every 400 ms). */
    onPage(r) {
      return this.adapter.chatId(new URL(location.href)) === r.chatId;
    }
    async checkRoute(force = false) {
      const href = location.href;
      const hrefChanged = href !== this.lastUrl;
      if (!force && !hrefChanged) {
        this.guardOtherChat();
        if (this.foreign || this.hrefWatch) this.confirmSameChat();
        else this.sampleIds();
        return;
      }
      const previousUrl = this.lastUrl;
      this.lastUrl = href;
      const chatId = this.settings.services[this.adapter.service] ? this.adapter.chatId(new URL(href)) : null;
      if (chatId === this.chatId) {
        if (chatId && hrefChanged && !this.adapter.sameChatUrl?.(new URL(previousUrl), new URL(href))) {
          this.hrefWatch = true;
          this.watchUntil = performance.now() + SAME_CHAT_WATCH_MS;
          this.confirmSameChat();
          this.guardOtherChat();
        }
        if (!force || this.foreign || this.namesOtherChat()) return;
      }
      if (chatId !== this.chatId) {
        this.gen++;
        this.view = newView();
        this.foreign = false;
        this.hrefWatch = false;
        this.watchUntil = 0;
        this.visitIds = null;
        const prev = this.chatId && this.sample?.chatId === this.chatId ? this.sample.ids : null;
        this.prevChatId = this.chatId;
        this.stale = prev && chatId ? { ids: prev } : null;
        this.sample = null;
        this.abort?.abort(new DOMException(NAVIGATED, "AbortError"));
        this.abort = null;
        this.suppressed = null;
        this.observer.reset();
        this.store.setAi("idle");
        this.store.setStalled(false);
        this.store.switchTo(chatId ? chatKey(this.adapter.service, chatId) : "", null);
      }
      this.chatId = chatId;
      this.setWatching(!!chatId);
      if (!chatId) {
        this.key = null;
        this.store.switchTo("", null);
        this.widget.hide();
        return;
      }
      const key = chatKey(this.adapter.service, chatId);
      this.key = key;
      const route = { gen: this.gen, key, chatId };
      this.widget.show(this.settings.widget, this.widgetTheme());
      try {
        const status = await request("chat/open", { service: this.adapter.service, chatId, url: canonicalPageUrl(this.adapter, href), title: this.adapter.title(document) });
        if (!this.live(route)) return;
        if (this.abort) this.store.applyStatus(status);
        else this.store.switchTo(key, status);
        if (status.tracked && !this.abort) void this.reconcile(route);
      } catch (e) {
        log.warn("could not open chat", e);
        if (this.live(route)) this.store.switchTo(key, null);
      }
    }
    /** The service's own ids of the messages on the page (content-derived ids could repeat across chats). */
    pageIds() {
      return this.adapter.messages(document).flatMap((n) => n.id ? [n.id] : []);
    }
    /** Conversation id the page reports, compared case-insensitively with the URL id. Missing means unknown. */
    pageConversationId() {
      const raw = this.adapter.pageChatId?.(document);
      if (!raw) return null;
      const id = raw.trim().toLowerCase();
      return id || null;
    }
    /** The page names the chat in the URL, so copied message ids are still this chat's. */
    namesThisChat() {
      const page = this.pageConversationId();
      return !!this.chatId && page === this.chatId.toLowerCase();
    }
    /**
     * The page still names the chat this tab showed before. Only that is a disagreement: right after a
     * chat is created the page's id may lag behind the URL, and a missing id says nothing.
     */
    namesOtherChat() {
      const page = this.pageConversationId();
      const prev = this.prevChatId?.toLowerCase();
      return !!this.chatId && !!page && !!prev && page === prev && page !== this.chatId.toLowerCase();
    }
    /** Stop writing into the open chat: another conversation is on the page, or this visit shares no message. */
    refuseCapture() {
      return this.foreign || this.namesOtherChat();
    }
    /** A running init must not finish into this chat once the page names a different one. */
    guardOtherChat() {
      if (!this.namesOtherChat() || !this.abort) return;
      this.suppressed = null;
      this.abort.abort(new DOMException(NAVIGATED, "AbortError"));
      this.abort = null;
    }
    /**
     * Same chat id, new href. Overlap with this visit (or the page naming this chat) carries on.
     * A non-empty sample that shares nothing is another transcript under the same id: refuse until
     * the ids overlap again or the route changes. An empty read decides nothing.
     */
    confirmSameChat() {
      const visible = this.pageIds();
      if (this.namesThisChat()) {
        this.foreign = false;
        if (visible.length) {
          this.hrefWatch = false;
          this.watchUntil = 0;
          this.sampleIds(visible);
        } else if (performance.now() >= this.watchUntil) this.hrefWatch = false;
        return;
      }
      const known = this.visitIds;
      if (!known?.size || !visible.length) {
        if (performance.now() >= this.watchUntil) this.hrefWatch = false;
        return;
      }
      if (visible.some((id) => known.has(id))) {
        this.foreign = false;
        this.hrefWatch = false;
        this.watchUntil = 0;
        this.sampleIds(visible);
        return;
      }
      if (this.foreign) return;
      this.foreign = true;
      this.hrefWatch = false;
      this.watchUntil = 0;
      this.suppressed = null;
      this.abort?.abort(new DOMException(NAVIGATED, "AbortError"));
      this.abort = null;
    }
    /** Notes which messages the current chat shows (at most every SAMPLE_MS), for after a navigation. */
    sampleIds(ids) {
      const chatId = this.chatId;
      if (!chatId || this.foreign || this.namesOtherChat()) return;
      const now = performance.now();
      if (!ids && this.sample?.chatId === chatId && now - this.sample.at < SAMPLE_MS) return;
      const list2 = ids ?? this.pageIds();
      if (list2.length && !this.showsPrevious(list2)) {
        this.sample = { chatId, ids: new Set(list2), at: now };
        this.visitIds ??= /* @__PURE__ */ new Set();
        for (const id of list2) this.visitIds.add(id);
      }
    }
    /**
     * True while the page may still show the previous chat: every message id read belongs to it (or
     * nothing could be identified). The guard ends with the first read that holds a message of the new
     * chat — a chat branched from the previous one shares its first ids, so one new id is enough — or
     * when the page itself names this chat. There is no time limit: an old page never turns into the
     * new chat by waiting. A page that names a different chat stays blocked without forgetting the guard.
     */
    showsPrevious(ids) {
      if (this.namesOtherChat()) return true;
      if (this.namesThisChat()) {
        this.stale = null;
        return false;
      }
      const st = this.stale;
      if (!st) return false;
      if (ids.some((id) => !st.ids.has(id))) {
        this.stale = null;
        return false;
      }
      return true;
    }
    /** Waits (up to `maxMs`) until the page shows the route's own chat rather than the previous one. */
    async ownPage(route, maxMs) {
      const start = performance.now();
      for (; ; ) {
        if (!this.live(route) || this.refuseCapture()) return false;
        if (!this.showsPrevious(this.pageIds())) return true;
        if (performance.now() - start >= maxMs) return false;
        await wait(250);
      }
    }
    /** The site's "AI is working" signal right now (the observer only looks every so often). */
    aiBusy() {
      const phase = this.adapter.aiPhase(document);
      return phase ? phase !== "idle" : this.adapter.isGenerating(document);
    }
    // ---- staging
    /**
     * Queue a capture; resolves once it (and every capture before it) has been handled. The job is
     * bound to the chat and the AI turn current now: it is dropped if the chat changes, and an
     * "answered" job is dropped if the AI has started on another turn by the time it runs (the next
     * turn's own captures include the finished answer).
     */
    snapshot(reason) {
      if (this.refuseCapture()) return Promise.resolve({ ok: true });
      if (this.abort) {
        this.suppressed = stronger(this.suppressed, reason);
        return Promise.resolve({ ok: true });
      }
      const ticket = { gen: this.gen, turn: this.observer.turn };
      const job = this.chain.then(() => this.runSnapshot(reason, ticket));
      this.chain = job.catch((e) => log.warn("snapshot failed", e));
      return job.then(
        () => ({ ok: true }),
        (e) => ({ ok: false, error: captureError(e) })
      );
    }
    async runSnapshot(reason, ticket) {
      if (ticket.gen !== this.gen) return;
      if (reason === "answered" && (ticket.turn !== this.observer.turn || !this.observer.settled)) return;
      const route = this.route();
      if (!route || !this.store.state.tracked || this.abort || this.refuseCapture()) return;
      if (!this.onPage(route)) {
        void this.checkRoute();
        return;
      }
      const busy = this.aiBusy();
      if (reason === "answered" && busy) return;
      const read = readPage(this.adapter, document);
      if (!read.messages.length || this.showsPrevious(read.serviceIds ?? [])) return;
      const view = this.view;
      const atEnd = reason !== "sent" && !busy && this.observer.settled && isAtEnd(this.adapter, document);
      const messages = await this.withArtifacts(read.messages);
      if (!this.live(route) || this.abort || this.refuseCapture()) return;
      const { fullRead, ...status } = await request("chat/snapshot", { snapshot: makeSnapshot(this.adapter, route.chatId, read, messages, false, atEnd, view), reason });
      if (!this.live(route)) return;
      this.store.applyStatus(status);
      if (fullRead) this.readAgain(route);
    }
    /**
     * The background could not place a capture safely (e.g. the first question was edited, so no
     * message is shared with what was saved): read the whole chat again. At most once a minute per visit;
     * if it fails, the error shows and "Read the whole chat again" in the popup stays available.
     */
    readAgain(route) {
      const now = performance.now();
      if (this.abort || !this.live(route) || this.refuseCapture() || this.autoRescan.gen === route.gen && now - this.autoRescan.at < AUTO_RESCAN_MS) return;
      this.autoRescan = { gen: route.gen, at: now };
      void this.init({ rescan: true });
    }
    /** Read a freshly opened tracked chat once it has settled, so answers missed while away are staged. */
    async reconcile(route) {
      if (this.reconciling === route.gen) return;
      this.reconciling = route.gen;
      try {
        if (await this.whenReady(route, READY_TIMEOUT_MS)) await this.snapshot("manual");
      } finally {
        if (this.reconciling === route.gen) this.reconciling = -1;
      }
    }
    /** True once messages are shown, the AI is idle and the list has not changed for `stableMs`. */
    async whenReady(route, maxMs, stableMs = 1e3) {
      const start = performance.now();
      let sig = "";
      let since = start;
      while (performance.now() - start < maxMs) {
        if (!this.live(route) || !this.onPage(route) || this.abort || this.refuseCapture()) return false;
        const msgs = this.adapter.messages(document);
        const ids = msgs.flatMap((n) => n.id ? [n.id] : []);
        const own = !this.showsPrevious(ids);
        if (own) this.sampleIds(ids);
        const last2 = msgs[msgs.length - 1];
        const now = msgs.length && own ? `${msgs.length}:${last2 ? (this.adapter.body(last2).textContent ?? "").length : 0}` : "";
        if (now !== sig) {
          sig = now;
          since = performance.now();
        } else if (now && this.observer.settled && performance.now() - since >= stableMs) {
          return true;
        }
        await wait(250);
      }
      return false;
    }
    /**
     * Stage what the page shows right now, if it can be read now (tracked, no turn in progress,
     * messages shown). `ok: false` only when reading or staging failed — then nothing may be
     * committed or pushed on top of it.
     */
    async refresh() {
      const route = this.route();
      if (!route || !this.store.state.tracked || this.abort || !this.observer.settled) return { ok: true };
      if (!this.adapter.messages(document).length) return { ok: true };
      const r = await this.snapshot("manual");
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    }
    // ---- init (whole history)
    /** Capture the whole history: starts tracking an untracked chat, or (rescan) re-reads a tracked one. */
    async init(opts = {}) {
      const route = this.route();
      const rescan = !!opts.rescan;
      if (!route || this.abort || rescan !== this.store.state.tracked || !this.onPage(route) || this.refuseCapture()) return;
      const abort = new AbortController();
      this.abort = abort;
      let heartbeat = 0;
      let initId = null;
      let lastProgress = 0;
      const progress = (p) => {
        if (!this.live(route)) return;
        lastProgress = p.progress;
        this.store.setCapture(p);
        const now = performance.now();
        if (initId && now - this.lastProgressSent > 500) {
          this.lastProgressSent = now;
          void request("chat/init/progress", { key: route.key, initId, progress: p.progress }).catch(() => {
          });
        }
      };
      try {
        progress({ stage: "loading", count: 0, progress: 0 });
        if (!await this.ownPage(route, OWN_PAGE_WAIT_MS)) {
          if (!this.live(route) || this.refuseCapture()) throw new DOMException(NAVIGATED, "AbortError");
          throw new InitIncompleteError("stale");
        }
        if (this.refuseCapture()) throw new DOMException(NAVIGATED, "AbortError");
        const artifacts = this.settings.saveVisualizations ? this.adapter.artifacts?.bind(this.adapter) : void 0;
        const capture = captureFullHistory(this.adapter, document, {
          signal: abort.signal,
          onProgress: progress,
          ...artifacts ? { artifacts: (skip) => artifacts(document, { skip }).catch(() => []) } : {},
          // a stalled turn is not finished: only a settled observer counts as done
          busy: () => !this.observer.settled,
          // restore the scroll only while this chat still owns the page
          owns: () => this.live(route) && this.onPage(route)
        });
        capture.catch(() => {
        });
        let started;
        try {
          started = await request("chat/init/start", { key: route.key });
        } catch (e) {
          abort.abort(new DOMException(NAVIGATED, "AbortError"));
          await capture.catch(() => {
          });
          throw e;
        }
        initId = started.initId;
        heartbeat = window.setInterval(() => {
          if (initId && this.live(route)) void request("chat/init/progress", { key: route.key, initId, progress: lastProgress }).catch(() => {
          });
        }, 2e4);
        if (!this.live(route)) throw new DOMException("Cancelled", "AbortError");
        this.store.applyStatus(started.status);
        const result = await capture;
        abort.signal.throwIfAborted();
        if (!this.live(route) || !this.onPage(route)) throw new DOMException("Cancelled", "AbortError");
        const messages = attachArtifacts(result.messages, result.artifacts);
        if (!messages.length) throw new InitIncompleteError("empty");
        if (!messages.some((m) => m.role === "assistant")) throw new InitIncompleteError("one-sided");
        if (this.refuseCapture()) throw new DOMException(NAVIGATED, "AbortError");
        if (this.showsPrevious(this.pageIds())) throw new InitIncompleteError("stale");
        const read = { messages, url: canonicalPageUrl(this.adapter, location.href), title: this.adapter.title(document), capturedAt: result.readAt };
        const snapshot = makeSnapshot(this.adapter, route.chatId, read, messages, true, false, this.view, result.startConfirmed);
        const id = initId;
        let cancelling = null;
        const forward = () => {
          if (byUser(abort.signal)) cancelling = request("chat/init/cancel", { key: route.key, initId: id }).catch(() => null);
        };
        abort.signal.addEventListener("abort", forward, { once: true });
        let status = null;
        let saved = false;
        try {
          status = await request("chat/init/done", { snapshot, initId: id });
          saved = true;
        } catch (e) {
          if (!cancelling) throw e;
        } finally {
          abort.signal.removeEventListener("abort", forward);
        }
        if (cancelling) status = await cancelling ?? status;
        if (this.live(route)) {
          this.store.setCapture(null);
          if (status) this.store.applyStatus(status);
          if (rescan) this.store.captureDone(saved);
        }
      } catch (e) {
        const here = this.live(route);
        if (here) this.store.setCapture(null);
        const cancelled = isAbort(e);
        if (!cancelled) log.warn("init failed", e);
        if (initId) {
          try {
            const status = await request("chat/init/cancel", { key: route.key, initId });
            if (this.live(route)) this.store.applyStatus(status);
          } catch {
          }
        }
        if (this.live(route)) {
          if (rescan) this.store.captureDone(false);
          if (!cancelled) this.store.fail("init", initError(e));
        }
      } finally {
        clearInterval(heartbeat);
        if (this.abort === abort) this.abort = null;
        const replay = this.suppressed;
        this.suppressed = null;
        if (replay && this.live(route) && this.store.state.tracked) void this.snapshot(replay);
      }
    }
    async withArtifacts(messages) {
      if (!this.settings.saveVisualizations || !this.adapter.artifacts || !messages.length) return messages;
      try {
        return attachArtifacts(messages, await this.adapter.artifacts(document));
      } catch {
        return messages;
      }
    }
    // ---- actions
    async call(type) {
      const route = this.route();
      if (!route) return;
      const fresh = await this.refresh();
      if (!this.live(route)) return;
      if (!fresh.ok) return this.store.fail(type === "chat/commit" ? "commit" : "push", fresh.error ?? t("errCaptureFailed"));
      const s = this.store.state;
      if (type === "chat/commit" && !s.staged.length) return this.store.nope("commit");
      if (type === "chat/push" && !s.staged.length && !this.store.ahead && s.phase !== "error") return this.store.nope("push");
      try {
        const status = await request(type, { key: route.key });
        if (status && this.live(route)) this.store.applyStatus(status);
      } catch (e) {
        log.warn(`${type} failed`, e);
      }
    }
    /**
     * Copies the tracked chat as Markdown. The text comes from the background's working copy, so no
     * scroll through the history is needed; what the page shows now is staged first, but only for a
     * moment. Start the clipboard write in the click's task, before waiting for any text.
     */
    async copyMarkdown() {
      const route = this.route();
      if (!route || !this.store.state.tracked || this.abort || !this.onPage(route)) return false;
      const check = () => {
        if (!this.live(route) || !this.onPage(route)) throw new DOMException("Navigated", "AbortError");
      };
      const text2 = async () => {
        await Promise.race([this.refresh(), new Promise((r) => setTimeout(r, COPY_REFRESH_MS))]);
        check();
        const { markdown } = await request("chat/markdown", { key: route.key });
        check();
        return markdown;
      };
      try {
        if (typeof ClipboardItem !== "undefined") {
          const blob = text2().then((markdown) => {
            check();
            return new Blob([markdown], { type: "text/plain" });
          });
          void blob.catch(() => {
          });
          check();
          await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
        } else {
          const markdown = await text2();
          check();
          await navigator.clipboard.writeText(markdown);
        }
        check();
        return true;
      } catch (e) {
        log.warn("copy failed", e);
        return false;
      }
    }
    async setAuto(key, value) {
      try {
        this.settings = await request("settings/set", { patch: { [key]: value } });
        this.store.applySettings(this.settings);
      } catch (e) {
        log.warn("could not save settings", e);
      }
    }
  };
  function captureError(e) {
    log.warn("capture failed", e);
    return t("errCaptureFailed");
  }
  function initError(e) {
    if (e instanceof InitIncompleteError) {
      if (e.reason === "busy") return t("errInitBusy");
      if (e.reason === "empty" || e.reason === "one-sided") return t("errInitEmpty");
      if (e.reason === "coverage") return t("errInitCoverage");
      if (e.reason === "stalled") return t("errInitStalled");
      if (e.reason === "stale") return t("errInitPrevChat");
      return t("errInitIncomplete");
    }
    const code = typeof e === "object" && e && "code" in e ? String(e.code) : "";
    if (code === "busy") return t("errInitOtherTab");
    if (code === "stale-init") return t("errInitStale");
    return e instanceof Error && e.message ? e.message : t("errGeneric");
  }

  // src/content/index.ts
  function isPrerendering(doc) {
    return doc.prerendering === true;
  }
  function boot() {
    const adapter = adapterFor(location.hostname);
    if (!adapter || window.top !== window) return;
    const go = () => {
      new Controller(adapter).start().catch((e) => log.error("failed to start", e));
    };
    if (isPrerendering(document)) {
      document.addEventListener("prerenderingchange", go, { once: true });
      return;
    }
    go();
  }
  boot();
})();
