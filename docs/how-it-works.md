# How it works

[日本語](how-it-works.ja.md)

gitchat turns conversations on ChatGPT, Claude, Gemini, and Grok into Markdown files in your own GitHub repository using a git-like workflow: **auto-stage → commit → push**.

## Architecture overview

gitchat is a Manifest V3 Chrome extension divided into isolated parts that communicate through a typed message protocol (`src/shared/protocol.ts`):

```text
chat page DOM ──adapter──► CapturedMessage[] ──► ChatSnapshot ──request('chat/snapshot')──► background
                                                                                    │
       widget ◄──BackgroundEvent{status}── EVENTS_PORT ◄── stage (diff vs. last commit) ┘
                                                    commit → local commit (IndexedDB)
                                                    push   → GitHub Git Data API (fast-forward only)
```

| Part | Runs in | Responsibility |
| --- | --- | --- |
| `src/content/` | Chat pages (`chatgpt.com`, `claude.ai`, `gemini.google.com`, `grok.com`) | Site adapters, DOM-to-Markdown conversion, AI-phase observer, full-history init, and the Shadow DOM widget host (`<gitchat-ui>`) |
| `src/frame/` | Visualization iframes (`*.claudeusercontent.com`, `*.web-sandbox.oaiusercontent.com`, `*.scf.usercontent.goog`) | Serializes rendered visualization HTML when requested by the top-level chat page |
| `src/background/` | Service worker | GitHub auth and Git Data API client, local database (IndexedDB), staging, local commits, multi-device sync engine, and Markdown file rendering |
| `src/popup/` | Toolbar popup | Current chat status, commit graph, and quick actions |
| `src/options/` | Settings page | Onboarding wizard and settings sections |
| `src/content/ui/` | Content script, settings preview, playground | Framework-free ES module UI kit (liquid-glass primitives, spring physics, the three widgets, and the panel) |

## Tracking a conversation ("init")

Not every conversation is saved. A chat starts as **untracked** until you click **Start saving this chat** under the widget (or in the toolbar popup), or until gitchat finds that another device has already saved the same conversation in your repository. Temporary chats (such as ChatGPT's `?temporary-chat=true` and Grok's private chats) have no persistent conversation ID and are never tracked.

Long conversations on all four services load older turns lazily and often virtualize the DOM:

- **ChatGPT**: virtualizes the transcript (~11 turns in the DOM at a time) and loads older turns in batches of 5, re-anchoring scroll position after each load.
- **Claude**: virtualizes the transcript (~20 rows in the DOM at a time) and loads older rows in batches of 32 when scrolled to the top, marking the first turn with `aria-posinset="1"`.
- **Gemini**: loads the last 10 turns first and fetches older turns in batches of 10 when `infinite-scroller.chat-history` reaches the top, applying `content-visibility: auto` to off-screen turns. A second signed-in Google account (`/u/<n>` in the path) is the same chat.
- **Grok**: virtualizes the transcript (~15 rows in the DOM, one per message) and shows about the newest 50 messages first; older ones load behind a loader row at the top. A private chat keeps the address at `grok.com/` and is never tracked.

When you start tracking a chat, **init** captures the full history in two stages:

1. **Loading older messages**: gitchat records your current scroll offset from the bottom, then scrolls the conversation container to the very top repeatedly until the message count, the list height and the scroll position stop changing, with no loading indicator, for a site-specific quiet window (`topQuietMs`). A start-of-chat marker alone is not trusted, because some sites renumber rows after each batch. Progress is shown as a growing message count (`↑ N`). If the history does not finish loading within 10 minutes, init stops with an error rather than saving part of the chat.
2. **Reading top to bottom**: gitchat steps down the scroll container from top to bottom, harvesting visible messages at each step and merging them in conversation order by message ID (`OrderedMessages`). Because messages are collected while scrolling, virtualized lists that remove off-screen rows are captured completely, and visualizations are saved at each step before they scroll out of the page. Gemini keeps every loaded message in the page, so it is read in one pass. Progress is reported from `0%` to `100%`.

If the AI is still answering when reading finishes, gitchat waits for the answer to finish and reads the end of the chat again, so a question is never saved without its answer. It then sends a complete snapshot (`complete: true`) to the background service worker; a capture without any answer is refused. Init can be cancelled at any time from the widget, and your scroll position is restored either way. Only one tab can run init for a chat at a time. Across 34–40-turn conversations verified on all three sites, init completes in roughly 4–11 seconds.

## Staging, committing, and pushing

### Staging

While a tracked chat is open, an `AiObserver` watches the page for AI activity (`idle` → `thinking` → `streaming` → `idle`):

- **`sent` snapshot**: when the AI transitions from `idle` to `thinking` or `streaming` (right after you send a prompt), the content script captures the visible messages so your prompt appears as staged in the widget immediately.
- **`answered` snapshot**: when streaming ends and the page stays quiet for `doneQuietMs` (preventing false triggers when sites flicker status indicators at the end of a turn), the content script sends an `answered` snapshot.

Live snapshots (`complete: false`) are applied as an **upsert** over the messages already stored for that chat in IndexedDB: known message IDs are updated in place, new IDs are added in order, and messages that are only off-screen (unloaded by a virtualized list) are kept. When a capture reaches the end of the conversation and shows new message IDs after an already-known message, which is what an edited prompt or a regenerated answer looks like, the capture is taken as the truth from that message on and the turns that disappeared from the page are removed (only turns this browser tab could have shown; messages that came from another device, or that another tab read later, are kept). An edit or a regenerated answer captured away from the bottom is not appended after the old branch; gitchat reads the whole chat again. The URL saved with a chat is the adapter's canonical one: origin and path, with Gemini's `/u/<n>` account slot and any query left out. A message the page still shows exactly as gitchat read it before keeps the stored version, so re-reading an unchanged page never undoes an edit merged from another device. A capture that cannot be matched safely with what is saved — it shares no message with it (for example after editing the very first prompt), or the end of the chat got shorter — is not applied; instead gitchat reads the whole chat again on its own, the same way as when tracking starts. An init snapshot (`complete: true`) is the truth from its first message on. It replaces the entire message list only when gitchat knows the capture starts at the chat's first message (the whole conversation fit on screen); otherwise older saved messages are kept, because older history may simply not have loaded. An empty or answer-less complete capture is refused, so a broken page never overwrites saved messages. Captures are applied in the order the page was read; an older capture that arrives late is ignored.

When you open a tracked chat (or the extension reconnects), gitchat reads the page once it has settled, so answers that finished while nothing was watching, for example in a closed tab, are staged too. **Commit** and **Push** read the page again before they run.

To compute what is **staged**, the background diffs the chat's current message list against the last committed message list by message ID and a whitespace-normalized content hash.

### Committing

Committing takes the staged changes of a tracked chat and writes a `LocalCommit` record (`{id, key, seq, message, n, createdAt, doc, pushed: false}`) to IndexedDB:

- Commit messages follow the format `<service>: <chat title> (+<staged count>)`, for example `claude: State design (+2)`.
- Several local commits across one or more chats can accumulate before a push.
- When **Auto commit** is enabled, gitchat commits automatically on `answered` snapshots only — never on `sent` or mid-stream — so a user prompt and its assistant reply are always committed together.

### Pushing

Pushing sends all unpushed local commits (across all tracked chats, in sequence order) to GitHub using the Git Data API:

1. If the current chat has uncommitted staged messages, pressing **Push** commits them first so work is never left behind.
2. For each pending commit, gitchat writes blobs for the chat Markdown file and any attached asset files, creates a new Git tree on top of the current branch tree, and creates a Git commit.
3. Finally, it updates the branch reference (`refs/heads/<branch>`) with `force: false`.

### Auto-commit and auto-push rules

- Turning **Auto push** on automatically turns **Auto commit** on (a push can only send commits that exist).
- Turning **Auto commit** off automatically turns **Auto push** off.
- When **Auto commit** is on, the manual **Commit** button disappears from the widget and popup.
- When **Auto push** is on, the manual **Push** button disappears from the widget and popup unless the last push failed, in which case it reappears in red so you can retry immediately.
- Automatic pushes wait briefly (3 seconds) to batch rapid commits, and if a push fails due to a transient network error or GitHub rate limit, gitchat schedules a background retry via `chrome.alarms` with exponential backoff (up to 30 minutes, or using GitHub's rate-limit reset time). The wait is stored, so it also holds after Chrome restarts the extension's background worker; pressing **Push** yourself does not wait.

## Repository layout and file format

gitchat writes files into three service folders at the root of your repository:

```text
README.md
chatgpt/2026-11-09-state-design--a1b2c3d4.md
claude/2026-11-09-react-hooks--9f8e7d6c.md
claude/2026-11-09-react-hooks--9f8e7d6c.assets/viz-1.html
gemini/2026-11-09-query-planner--7c6b5a4d.md
```

### File naming

Each chat file path has the form:

```text
<service>/<YYYY-MM-DD>-<title-slug>--<id8>.md
```

- `<service>`: `chatgpt`, `claude`, or `gemini`.
- `<YYYY-MM-DD>`: date of the first capture in the device's local time zone.
- `<title-slug>`: lowercase NFKC-normalized slug of the conversation title (letters, marks, and digits of any script are preserved, up to 48 characters; falls back to `chat`).
- `<id8>`: first 8 file-name-safe characters of the service's chat ID (more characters if another chat in the folder already uses those 8).

Once a chat file is created, its file name is **fixed**: renaming the conversation later updates the `title` in the YAML front matter and the `# Heading` inside the file, without renaming or moving the file. Other devices find an existing file for the same conversation by its `--<id8>.md` suffix inside `<service>/`, and confirm the service and chat ID in its front matter before using it.

### Markdown format

```markdown
---
gitchat: 1
service: claude
id: "9f8e7d6c-1234-5678-9abc-def012345678"
url: "https://claude.ai/chat/9f8e7d6c-1234-5678-9abc-def012345678"
title: "State design"
created: 2026-11-09T09:12:00.000Z
captured: 2026-11-09T10:40:00.000Z
messages: 14
---

# State design

## User
<!-- gitchat:message id="..." length="..." -->

How should we structure the state transitions?

## Assistant
<!-- gitchat:message id="..." length="..." -->

Here is a clean transition table...
```

The `<!-- gitchat:message -->` HTML comment under each role heading records the stable message ID, so another device can parse the file from GitHub and continue staging only new or changed messages, and the body's length, so a message that itself quotes a gitchat file (or contains `## Assistant` in a code block) is read back as one message.

## What is captured

### Markdown conversion

Chat applications render Markdown into complex HTML. gitchat converts the rendered DOM back into clean, readable Markdown (`src/content/capture/markdown.ts`):

- **Text and inline formatting**: paragraphs, line breaks, bold (`**...**`), italic (`*...*`), strikethrough (`~~...~~`), inline code (automatically expanding backtick fences when the code itself contains backticks), `<sup>`, and `<sub>`.
- **Headings**: `<h1>`–`<h6>`, normalized when a service shifts heading levels in its DOM (for example, ChatGPT's new UI and Claude render `##` as `<h3>`).
- **Lists and blockquotes**: ordered (`1.`) and unordered (`-`) lists with nested indentation, loose-list spacing, and `>` blockquotes.
- **Tables**: converted to GitHub Flavored Markdown tables, preserving column alignment (`:---:`, `---:`, `---`) when the site keeps alignment attributes or styles.
- **Code blocks**: fenced code blocks with language identifiers (read from CodeMirror `data-language`, `language-*` classes, or header labels) and the raw source where the page keeps it (ChatGPT's code boxes keep it in a separate source pane, which is read as is). Inline code is kept as code spans, including ChatGPT's inline-code spans.
- **Math as original TeX**: inline math (`$...$`) and display math (`$$...$$`) extracted from KaTeX `<annotation encoding="application/x-tex">`, MathJax `<mjx-container>`, MathML `alttext`, or site math attributes (`data-math`, `data-latex`, `data-tex`).
- **Collapsible blocks**: `<details>` and `<summary>` blocks where present in the message body.

### Interactive visualizations

Claude artifacts (`*.claudeusercontent.com`), ChatGPT inline visualizations (`*.web-sandbox.oaiusercontent.com`), and Gemini Canvas previews (`*.scf.usercontent.goog`) run inside cross-origin sandboxed iframes.

When **Save visualizations** is enabled (the default) and a visualization is open on screen at capture time (a preview panel is only saved when it is clear which message it belongs to: the card you clicked, or on Claude the card marked as current):

1. The content script sends a `{gitchat: 1, type: 'frame/serialize', nonce}` request to the iframe.
2. `src/frame/index.ts` inside the iframe verifies that the request comes from `window.top` on an allowed origin (`https://claude.ai`, `https://chatgpt.com`, `https://gemini.google.com`, or `https://grok.com`) and replies with `<!doctype html>\n` + `document.documentElement.outerHTML`.
3. The background writes the HTML file to `<chat-file-without-md>.assets/<slug>.html` and rewrites the artifact reference in the Markdown to a relative link (`> **Artifact:** [Title](<chat>.assets/<slug>.html)`).

### Known limits

- **Web-search citations**: ChatGPT and Gemini do not place citation URLs in the page DOM (URLs are only fetched or shown on popover interaction). gitchat keeps what the page shows: ChatGPT's source names in brackets (`[Source]`) and Gemini's numbered markers (`[1]`).
- **Rendered HTML vs. original source**: Gemini Canvas and ChatGPT inline visualizations expose their rendered HTML document in the sandbox iframe rather than the underlying source files, so gitchat saves the rendered HTML snapshot.
- **On-screen requirement for visualizations**: a visualization or artifact can only be serialized if its iframe is mounted and rendered on screen when capture runs.
- **Conversation branches**: when you edit an earlier prompt or regenerate an answer, chat sites only render the currently selected branch in the DOM; gitchat saves that active branch. Edits and regenerated answers are picked up automatically; when the page no longer matches what was saved (for example after editing the very first prompt), gitchat reads the whole chat again on its own. If something still looks wrong after switching branches, click **Read the whole chat again** (↻) in the toolbar popup.

## Multi-device synchronization

gitchat is designed to be used across several computers connected to the same GitHub repository without manual conflict resolution:

- **Remote branch is the source of truth**: pushes are always fast-forward (`force: false`) and never overwrite history.
- **Automatic rebase on non-fast-forward**: if Device A pushes while Device B has pending local commits, Device B's push is rejected as non-fast-forward. gitchat automatically re-reads the remote `HEAD`, replays Device B's commits on top of the new tree, and retries (up to 4 attempts).
- **Same-chat changes on two devices (merged per message)**: if the remote copy of a chat file changed since Device B last synced it, gitchat merges the two against that last synced version, message by message. A message only one device changed keeps that change; a message both changed takes the newer capture (`captured` in the YAML front matter, then the `messages` count); messages only one side added are kept. If the remote copy already contains everything a local commit adds, that commit is skipped as superseded. Device B then continues from the merged copy, keeping commits it made during the push, so a later push cannot delete messages that only Device A had. Earlier versions stay in git history.
- **Automatic adoption on other devices**: when you open a conversation on Device B that Device A already pushed to the repository, gitchat looks up `--<id8>.md` in the remote tree, checks the chat ID in its front matter, parses the Markdown file (`adoptRemote`), and marks the chat as tracked on Device B from that commit forward. Its visualization files are downloaded too; if a download fails, the chat is adopted on a later visit rather than without them. Starting to track a chat whose file already exists works the same way: the newer of the two captures wins, and saved visualizations are kept when the newer capture only shows a closed card.
- **Changing repositories**: commits, file paths and sync state belong to one repository. When you switch to another repository, commits that were not pushed to the old one are dropped (the conversations themselves are unaffected), and every tracked chat, including its visualization files, is staged in full for the new repository. A push in progress finishes first.
- **No shared index files**: each conversation writes only to its own `<service>/<file>.md` (and `<file>.assets/`), so commits to different conversations never conflict.

## On-page widgets and panel

The on-page widget mounts inside an isolated Shadow DOM under a `<gitchat-ui>` element on the right edge of the page. With **Theme** set to **Auto** (the default) it follows the page's light or dark theme; **Light** or **Dark** pins it. It can be dragged vertically to any comfortable position. The settings page and the popup follow the system theme unless Light or Dark is chosen. The toolbar icon itself cannot change with the theme, because Chrome allows one icon.

| Style | Visual language |
| --- | --- |
| **Creature** (default) | A frosted-glass creature whose orbiting droplets represent uncommitted staged messages and whose internal blue dots represent unpushed commits. It looks toward the composer while you type, lags with weight when you scroll, tilts its head while the AI thinks, grows a new droplet on its edge while an answer streams, swallows droplets on commit, and releases its blue dots upward on push. |
| **Line** | A slender glass capsule along the right edge showing the commit graph vertically in conversation order: oldest commits at the top, newest at the bottom, and a hollow ring below them for uncommitted work. A horizontal hairline marks the remote `origin` (everything above the line is on GitHub). Hovering widens the capsule and magnifies dots under the cursor; clicking the hollow ring commits, clicking the origin hairline pushes, and clicking elsewhere opens the panel. |
| **Dot** | A compact circular glass dial. The number in the center shows uncommitted messages (or a subtle center dot when clean), and blue ticks around the ring represent unpushed commits starting at 12 o'clock. On push, the ticks sweep back to 12 o'clock and fade. |

Hovering any widget reveals circular action buttons underneath (**Start saving this chat** when untracked, **Cancel** during init, or **Commit** and **Push** when tracked). Clicking a tracked widget opens the glass panel containing the commit graph, action bar (Commit, Push, Copy GitHub link, Open settings), and the **Auto commit** and **Auto push** switches.

The widget works from the keyboard as well: <kbd>Tab</kbd> to it to reveal its buttons, <kbd>Enter</kbd> opens the panel, <kbd>Esc</kbd> closes it. It draws only while something moves (the creature breathes at a low frame rate when idle), and when the system asks for less motion (macOS **Reduce motion**, Windows **Animation effects** off) it stays still apart from state changes.
