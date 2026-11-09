# gitchat — design notes (for contributors)

gitchat is a Manifest V3 Chrome extension that saves ChatGPT, Claude and Gemini conversations to the
user's own GitHub repository as Markdown, with a git-like flow: **auto-stage → commit → push**.

This file is the contract between the parts of the codebase. User-facing docs live in `README.md` and
`docs/`.

## Parts

| Part | Path | Runs in | Owns |
| --- | --- | --- | --- |
| Shared types and protocol | `src/shared/` | everywhere | domain types, request/response table, settings defaults |
| Background | `src/background/` | service worker | GitHub auth and API, local store (IndexedDB), staging, commits, push/sync, Markdown rendering of files |
| Content | `src/content/` | chat pages | site adapters, DOM → Markdown capture, AI-state observer, init (full-history capture), on-page widget |
| Frame | `src/frame/` | artifact iframes | serializes visualization documents on request |
| Popup | `src/popup/` | toolbar popup | current chat status, quick actions, link to settings, onboarding entry |
| Options | `src/options/` | settings page | onboarding wizard, GitHub connection, repository, behavior, appearance, advanced |
| UI kit | `src/content/ui/` | content, options, playground | liquid-glass primitives, springs, the three widgets (creature, line, dot) and the panel |

Rules: parts talk only through `src/shared/protocol.ts`. The UI kit is framework-free ES modules and
must not import from `background/`. Secrets (tokens) live only in `chrome.storage.local` and never
leave the background worker except to `api.github.com` / `github.com`.

## Data flow

```
chat page DOM ──adapter──► CapturedMessage[] ──► ChatSnapshot ──request('chat/snapshot')──► background
                                                                                    │
       widget ◄──BackgroundEvent{status}── EVENTS_PORT ◄── stage (diff vs. last commit) ┘
                                                    commit → local commit (IndexedDB)
                                                    push   → GitHub Git Data API (fast-forward only)
```

- **Staging**: the background keeps the last committed message list per chat. A snapshot is diffed by
  message `id` + content hash; new or changed messages are the `staged` items. Only tracked chats are
  staged. Live snapshots (`complete: false`) are an **upsert**: they may hold only the part of a long
  chat that is in the DOM, so absent messages are kept and new ids are appended. Only init snapshots
  (`complete: true`) replace the whole list.
- **Snapshot reasons**: the content script sends `sent` when the AI starts working (the user's
  message appears in the widget right away), `answered` when the answer is finished, `manual`
  otherwise. Auto-commit runs only for `answered`, so a commit never splits a question from its answer.
- **Assets**: interactive visualizations (Claude artifacts, ChatGPT inline visualizations, Gemini
  Canvas) live in cross-origin iframes. `src/frame/` runs inside those frames and returns the rendered
  HTML when the chat page asks. Message Markdown links to them as `gitchat-asset:<name>`, which the
  background rewrites to `<file>.assets/<name>`.
- **Commit**: renders the chat file (front matter + messages) and stores a local commit
  `{id, key, path, files[], message, createdAt}`. Several local commits can wait for one push.
- **Push**: pushes all local commits in order. If anything is staged for the current chat, it is
  committed first (pressing push never leaves work behind).
- **Auto**: auto-commit runs after the AI finishes an answer (never mid-answer). Auto-push needs
  auto-commit: turning auto-push on turns auto-commit on; turning auto-commit off turns auto-push off.

## Repository layout written by gitchat

```
README.md                          # created when the repo is empty ("managed by gitchat")
chatgpt/2026-11-09-state-design--a1b2c3d4.md
claude/2026-11-09-react-hooks--9f8e7d6c.md
claude/2026-11-09-react-hooks--9f8e7d6c.assets/viz-1.html
gemini/...
```

- File name: `<date of first capture>-<title slug>--<first 8 chars of the chat id>.md`. The name is
  fixed once created (renaming a chat later does not move the file). Other devices find an existing
  file by its `--<id8>.md` suffix.
- File format:

```markdown
---
gitchat: 1
service: claude
id: <chat id>
url: https://claude.ai/chat/<chat id>
title: "State design"
created: 2026-11-09T09:12:00Z
captured: 2026-11-09T10:40:00Z
messages: 14
---

# State design

## User
<!-- gitchat:message id="..." -->

...markdown...

## Assistant
<!-- gitchat:message id="..." -->

...markdown...
```

## Sync rules (multi-device, no manual conflicts)

- The remote branch is the source of truth. Pushes are fast-forward only (`force: false`), never
  force-pushed.
- On a non-fast-forward rejection: re-read the remote head and replay the local commits on top
  (rebase), then retry (bounded attempts).
- If the remote copy of a chat file changed since our base, keep whichever capture is newer
  (`captured` in front matter, then message count). The chat service is the real source of truth, so
  the newer capture contains everything; the older content stays in git history.
- No shared index files, so different chats never conflict.

## Site adapters (durable by design)

What the sites look like (verified on the live sites, 2026-11; details in the adapter files):

| | ChatGPT (new app shell + classic) | Claude | Gemini |
| --- | --- | --- | --- |
| Message hook | `[data-chatgpt-search-unit-key$=":user"/":assistant"]` (classic: `data-message-author-role`) | `[data-testid=user-message/assistant-message]` | `user-query` / `model-response` |
| Stable id | `data-chatgpt-search-message-ids` | `data-turn-key` | `.conversation-container#<16hex>` |
| Thinking / streaming | `[data-response-starting]` / `[data-talvt-turn-state=in_progress]` | stop button / `data-is-streaming=true` | `pending-request` / `.markdown[aria-busy=true]` |
| Long chats | virtualized (~11 turns), +5 turns per load | virtualized (~20 rows), +32 rows per load | +10 turns per load, `content-visibility:auto` |
| Start of chat | none (stability) | `aria-posinset="1"` | none (stability) |
| Visualization frames | `*.web-sandbox.oaiusercontent.com` | `*.claudeusercontent.com` | `*.scf.usercontent.goog` |

Never match localized text (aria-labels, button captions): all three sites translate them.

Each service has an adapter = **data** (ranked selector candidates, JSON) + a few small code hooks.
When the primary selector stops matching, the next candidate is tried, then generic heuristics.
Captures are validated before staging (message count must not shrink unexpectedly, roles must make
sense); a failed check never overwrites good data and the widget shows an error state instead.
Selector sets are tested against sanitized DOM fixtures in `tests/fixtures/`.

## Init (tracking an existing chat)

Long chats load older messages lazily. Init scrolls the chat's scroll container to the very top,
waits for each batch to load (adapter signals + generic "no new messages and no spinner for N ms"),
then reads top to bottom, merging messages by id (works with virtualized lists), restores the scroll
position and sends one complete snapshot. Progress is reported as: loading older messages (count) →
reading (0–100%). It can be cancelled.
