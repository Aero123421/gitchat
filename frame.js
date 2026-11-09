"use strict";
(() => {
  // src/frame/index.ts
  var ALLOWED_PARENTS = /* @__PURE__ */ new Set(["https://claude.ai", "https://chatgpt.com", "https://gemini.google.com"]);
  if (typeof window !== "undefined") window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || d.gitchat !== 1 || d.type !== "frame/serialize" || typeof d.nonce !== "string") return;
    if (!ALLOWED_PARENTS.has(e.origin) || e.source !== window.top) return;
    const html = `<!doctype html>
${document.documentElement.outerHTML}`;
    e.source.postMessage({ gitchat: 1, type: "frame/html", nonce: d.nonce, html, title: document.title }, e.origin);
  });
})();
