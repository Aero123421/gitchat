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
leave the background worker except to `api.github.com` / `github.com`. The background accepts a
content-script message only from the tab's top document. A prerender keeps a non-zero `frameId`
after activation, so that document is `sender.frameType === 'outermost_frame'` (falling back to
`frameId === 0` when the type is absent). A document still prerendering is rejected, and the
content script starts only after `prerenderingchange`.

## Data flow

```
chat page DOM ──adapter──► CapturedMessage[] ──► ChatSnapshot ──request('chat/snapshot')──► background
                                                                                    │
       widget ◄──BackgroundEvent{status}── EVENTS_PORT ◄── stage (diff vs. last commit) ┘
                                                    commit → local commit (IndexedDB)
                                                    push   → GitHub Git Data API (fast-forward only)
```

- **Staging**: the background keeps the last committed message list per chat. A snapshot is diffed by
  message `id` + content hash (the Markdown body plus the git blob SHA of each asset); new or changed
  messages are the `staged` items. Only tracked chats are staged. Live snapshots (`complete: false`)
  are an **upsert**: they may hold only the part of a long chat that is in the DOM, so absent messages
  are kept and new ids are added. A live snapshot with `atEnd: true` (the capture reaches the last
  message) that shows unknown ids after a known one is an edit or a regenerated answer: it is
  authoritative from its first known message, and the turns that vanished are dropped. A branch
  seen away from the end is not appended (see Ambiguous captures). Init
  snapshots (`complete: true`) are authoritative from their first message on; they replace the whole
  list only when the capture is known to start at the chat's first message (`startConfirmed`: the
  transcript fit on screen). Otherwise older saved messages stay (older history may not have loaded),
  and a capture that shares nothing with the saved chat is added next to it. An empty or answer-less
  complete snapshot is refused.
- **Page reads**: per message, the chat record keeps what this device last read on the page
  (`pageReads`: content hash, when it was first read, the page views that read it, and each of those
  views' own last reading). A message a page view still shows exactly as that view read it before
  keeps the stored version, which may hold another device's edit merged since; a view that never read
  it compares with the device's latest reading. Each live snapshot names its page view (`view`: a random id per tab document and
  visit of the chat, and when the visit started); it may only drop messages that view could have
  shown — read on this device before the visit started, or by the view itself. Messages from another
  device's copy, or read later by another tab, are never dropped by their absence.
- **Ambiguous captures**: a live snapshot that shares no message with a chat that has some (the first
  question was edited), that reaches the end but stops before messages its view read there (the
  end got shorter), or that shows a replaced turn before the end (an unknown id after a known one
  where the saved chat continues with a different message), is not applied. The reply carries
  `fullRead` and the tab reads the whole chat again (an automatic rescan, at most once a minute per
  visit), which settles it with a complete capture. A capture taken mid-answer (`sent`) does not.
- **Capture order**: `capturedAt` is the time the page was read (before any async enrichment). The
  content script sends captures in read order, and the background ignores one older than the last it
  applied for that chat.
- **Right chat, right turn**: after a navigation, a read whose site message ids all belong to the
  previous chat (or that has none) is ignored: the page, or a hidden copy of it, still shows the old
  chat. One id the old chat did not have marks the new one, so a chat branched from the old one is
  accepted. Where the page names its conversation (ChatGPT's selection attribute), that id clears
  the guard when it matches the URL, so a branch opened as a new chat is saved before a message of
  its own appears, and a page that still names the previous chat is not captured. A URL change that keeps
  the chat id is checked against the message ids of this visit; a transcript that shares none of
  them is not written into the open chat. There is no time limit; init waits up to 10 s for the new chat and then fails. An `answered` capture re-checks the site's "AI is working" signal right before reading, so it
  never takes the next turn's beginning. Before Commit/Push, the popup needs the tab's explicit
  `{ok: true}` to its refresh (no reply, a timeout of 8 s or a malformed reply stop the action).
- **Snapshot reasons**: the content script sends `sent` when the AI starts working (the user's
  message appears in the widget right away), `answered` when the answer is finished, `manual`
  otherwise. Auto-commit runs only for `answered`, so a commit never splits a question from its answer.
- **Assets**: interactive visualizations (Claude artifacts, ChatGPT inline visualizations, Gemini
  Canvas) live in cross-origin iframes. `src/frame/` runs inside those frames and returns the rendered
  HTML when the chat page asks. Each artifact carries its owning message id and a stable key; its file
  name is `<title slug>-<key fingerprint>.html`, so recapturing one message never renames another's
  asset. Message Markdown links to them as `gitchat-asset:<name>`, which the background rewrites to
  `<file>.assets/<name>`. A later capture that cannot reach the frame (panel closed) keeps the saved
  link and file. A preview panel is only serialized when its owning message is known — the card
  marked current (Claude) or the card the user clicked — never by title alone, which is ambiguous on
  a virtualized list; otherwise it is skipped and the saved copy kept. ChatGPT Work-mode commentary
  (`[data-local-conversation-item-target-ids]`) is never a message; the final answer is.
- **Commit**: renders the chat file (front matter + messages) and stores a local commit for the
  current repository (`owner/name@branch`). The commit record, its sequence number and the chat's
  committed refs are written in one IndexedDB transaction; the document payload lives in its own
  store so status queries stay cheap. Several local commits can wait for one push.
- **Push**: pushes all local commits in order. If anything is staged for the current chat, it is
  committed first (pressing push never leaves work behind).
- **Auto**: auto-commit runs after the AI finishes an answer (never mid-answer): a chat is eligible
  only when its last applied capture was settled (`answered`, `manual`, a complete init or an
  adoption), never after `sent`. Auto-push needs auto-commit: turning auto-push on turns auto-commit on; turning
  auto-commit off turns auto-push off (and cancels a push that was about to run). Pending automatic
  work resumes whenever the service worker starts.

## Repository layout written by gitchat

```
README.md                          # created when the repo is empty ("managed by gitchat")
chatgpt/2026-11-09-state-design--a1b2c3d4.md
claude/2026-11-09-react-hooks--9f8e7d6c.md
claude/2026-11-09-react-hooks--9f8e7d6c.assets/viz-1.html
gemini/...
```

- File name: `<date of first capture>-<title slug>--<first 8 chars of the chat id>.md` (more id
  characters if another chat already uses those 8). The name is fixed once created (renaming a chat
  later does not move the file). Other devices find an existing file by its `--<id8>.md` suffix and
  confirm the service and chat id in its front matter.
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
<!-- gitchat:message id="..." length="123" -->

...markdown...

## Assistant
<!-- gitchat:message id="..." length="4567" -->

...markdown...
```

`length` is the body's length in characters, so a message that itself contains a gitchat file (or a
`## Assistant` heading in a code block) is read back correctly. Files without it are parsed by
headings outside code fences. The stored `url` is the adapter's canonical chat URL (origin and path;
Gemini also drops a leading `/u/<n>` account slot), not the raw address bar. The chat key stays
`service` + chat id. Chat ids are stored lowercase.

## Sync rules (multi-device, no manual conflicts)

- The remote branch is the source of truth. Pushes are fast-forward only (`force: false`), never
  force-pushed.
- On a non-fast-forward rejection: re-read the remote head and replay the local commits on top
  (rebase), then retry (bounded attempts).
- A `409 Conflict` on the ref update is treated like a non-fast-forward. Automatic pushes retry with
  backoff after the immediate attempts. The wait (rate-limit reset or backoff) and the attempt count
  are stored, so a restarted service worker does not push early; a manual push does not wait, and a
  successful push clears them. Choosing or changing the repository clears the previous sync error and
  pushes waiting commits when auto-push is on.
- If the remote copy of a chat file changed since our base, the two are merged **three-way** per
  message id against the base (`baseRefs`: the message hashes of the file as of our last push or
  adoption): a message only one side changed takes that side's version; a message both changed takes
  the newer capture (`captured`, then message count); a message only one side added is kept; a
  message one side deleted and the other left unchanged is deleted. Without a known base nothing is
  dropped. A local commit whose content the remote copy already has is skipped ("superseded"). The
  chat is then rebased on the result, with the pushed batch as the base, so commits made during the
  push and unstaged work survive, and a later push cannot delete what only the other device had.
- A live capture can only prune messages its page view could have shown (see Page reads); messages
  that arrived by merge or adoption stay until a capture on this device has read them.
- Reading a chat file from the repository also downloads its asset files, so a chat always carries
  its visualizations and can move to another repository. Only a file the repository does not have
  loses its link; a failed download fails the read (adoption is tried again on the next visit, a push
  is retried), so a temporary GitHub error never removes a link.
- Starting to track (or rescanning) a chat whose file already exists reads that file: if it is
  newer, the two are combined; otherwise the new capture replaces it (removed messages show as staged
  removals). Either way a message keeps the other copy's saved visualization when the winning copy
  only has a plain card for it. Edits made while an init runs are kept over the older capture.
- An empty repository initialized by two devices at once: the loser continues from the winner's
  first commit.
- Commits, paths and baselines belong to one repository. Switching repository drops the old
  repository's unpushed commits (their content is still in the chats) and stages every tracked chat
  in full for the new one; it waits for a push in flight.
- No shared index files, so different chats never conflict.

## Site adapters (durable by design)

What the sites look like (verified on the live sites, 2026-11; details in the adapter files):

| | ChatGPT (new app shell + classic) | Claude | Gemini |
| --- | --- | --- | --- |
| Message hook | `[data-chatgpt-search-unit-key$=":user"/":assistant"]` or `data-content-search-unit-key` (classic: `data-message-author-role`) | `[data-testid=user-message/assistant-message]` | `user-query` / `model-response` |
| Stable id | `data-chatgpt-search-message-ids` | `data-turn-key` | `.conversation-container#<16hex>` |
| Thinking / streaming | `[data-response-starting]` / `[data-talvt-turn-state=in_progress]` | stop button / `data-is-streaming=true` | `pending-request` / `.markdown[aria-busy=true]` |
| Long chats | virtualized (~11 turns), +5 turns per load | virtualized (~20 rows), +32 rows per load | +10 turns per load, `content-visibility:auto` |
| Start of chat | none (stability) | `aria-posinset="1"` marks the first *loaded* row only: stability decides | none (stability) |
| Visualization frames | `*.web-sandbox.oaiusercontent.com` | `*.claudeusercontent.com` | `*.scf.usercontent.goog` |

Never match localized text (aria-labels, button captions): all three sites translate them.

Each service has an adapter = **data** (ranked selector candidates, JSON) + a few small code hooks.
When the primary selector stops matching, the next candidate is tried, then generic heuristics.
Captures are validated before staging (message count must not shrink unexpectedly, roles must make
sense); a failed check never overwrites good data and the widget shows an error state instead.
Selector sets are tested against sanitized DOM fixtures in `tests/fixtures/`.

## Init (tracking an existing chat)

Long chats load older messages lazily. Init scrolls the chat's scroll container to the very top,
waits for each batch to load (stable count, height and scroll position, no spinner, for the site's
quiet period), then reads top to bottom, merging messages by id (works with virtualized lists; on a
virtualized list visualizations are serialized at each step), restores the scroll position and sends
one complete snapshot. If loading never settles within 10 minutes, init fails instead of saving a
partial history. If the AI is still answering, init waits for the answer and re-reads the end.
Progress is reported as: loading older messages (count) → reading (0–100%). It can be cancelled.

- A message row counts as read only once its body has content; a row whose body renders late is
  visited again (twice at most) before it counts as an empty message. A row never seen fails the
  coverage check.
- Reading that makes no progress (no scrolling, no new messages) for 25 s fails as stalled.
- The snapshot says `startConfirmed` only when the whole transcript fit on screen once loading
  stopped, or the chat has at most 8 messages (no site loads so few in batches). The background then
  may replace everything; otherwise saved messages above the capture stay.
- A failure stays visible on the widget (its panel opens even for an untracked chat) and in the
  popup until the next action.
- The content script watches the page (AI observer, card clicks, theme) only while a chat of an
  enabled service is shown, and shuts itself down when the extension is reloaded or removed.

An init session is owned by one tab: `chat/init/start` returns an `initId` that progress, done and
cancel must carry. A second tab gets `busy`; a session whose tab goes away (port closed, or no
progress for 2 minutes) ends, and a late `done` gets `stale-init`. `done` does its network work
(looking for the chat's file in the repository) first; then the session check and the change are one
step in the chat queue, and cancel runs in the same queue, so whichever comes first wins and a
cancelled init can never be tracked or committed afterwards.
