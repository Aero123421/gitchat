# gitchat

[日本語](README.ja.md)

**gitchat** is an open-source Chrome extension that saves your conversations from ChatGPT, Claude, and Gemini to your own GitHub repository as Markdown files — one file per conversation, organized in `chatgpt/`, `claude/`, and `gemini/`. It is built for handing a complete conversation to another chat or to an AI coding agent such as Claude Code without copy-pasting, using GitHub as a durable place to keep and share your history. New messages in a tracked chat stage automatically when the AI finishes answering, and you commit and push when ready (or turn on auto-commit and auto-push).

## Features

- **One chat, one Markdown file**: each conversation is saved to `<service>/<date>-<title-slug>--<id8>.md` with YAML front matter (`gitchat`, `service`, `id`, `url`, `title`, `created`, `captured`, `messages`) followed by `## User` and `## Assistant` sections. The file name is fixed once created.
- **Selective tracking ("init")**: conversations are untracked until you choose to save them. Starting tracking scrolls to the top of the conversation, waits while the site loads older messages, reads the full history from top to bottom, and restores your scroll position. Progress is shown as a loaded message count and then a reading percentage, and can be cancelled at any time. Temporary chats (ChatGPT temporary chat) are never saved.
- **Fidelity for technical chats**: preserves headings, lists, links, blockquotes, tables (with column alignment where the site keeps it), fenced code blocks with language identifiers, and math restored to its original TeX (`$...$` and `$$...$$`).
- **Interactive visualizations**: Claude artifacts, ChatGPT inline visualizations, and Gemini Canvas previews that are on screen at capture time are saved as rendered HTML files next to the chat (`<chat>.assets/<name>.html`) and linked from the Markdown.
- **Git-like workflow**: answers stage automatically when finished. Commit locally (stored in IndexedDB) and push to GitHub on demand, or enable **Auto commit** and **Auto push**. Pressing **Push** commits any staged messages in the current chat first so work is never left behind.
- **Multi-device sync without manual conflict resolution**: pushes are always fast-forward (`force: false`). If another computer pushed first, gitchat replays local commits on top of the remote branch; if the same chat changed on two devices, the changes from both are merged message by message (the newer capture wins only where both changed the same message).
- **Three on-page widget styles**: choose between **Creature** (default), **Line**, and **Dot**, or use the toolbar popup. Hovering the widget reveals action buttons; clicking opens a panel with the commit graph, a one-click button to copy the GitHub file URL, auto switches, and settings.
- **Direct to your repository**: gitchat has no servers of its own, no analytics, and no telemetry. Chat content travels only from the chat page in your browser to your GitHub repository through the GitHub API.

## Install

gitchat requires Chrome 120 or later. It is not on the Chrome Web Store yet; install it from a release archive or build it from source.

### From GitHub Releases

1. Download the latest `gitchat-<version>.zip` from [Releases](https://github.com/Aero123421/gitchat/releases) and unzip it.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the unzipped folder.

### From source

Requires Node.js 22.12 or later:

```sh
git clone https://github.com/Aero123421/gitchat.git
cd gitchat
npm install
npm run build
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the `dist/` folder.

## Getting started

When you install gitchat, the setup wizard opens automatically:

1. **Connect GitHub**: sign in with GitHub (OAuth device flow, when an OAuth client ID is configured) or create a fine-grained personal access token scoped to your chat repository with **Contents: Read and write** and **Metadata: Read**.
2. **Choose a repository**: let gitchat create a new private repository (default name `ai-chats`), or pick an existing empty or gitchat-managed repository. gitchat refuses non-empty repositories it did not create.
3. **Pick how it looks and works**: choose a widget style (**Creature**, **Line**, or **Dot**) using the live preview on the right edge, and optionally turn on **Auto commit** and **Auto push**.
4. **Start saving a chat**: open a conversation on ChatGPT, Claude, or Gemini, hover the widget on the right edge of the page, and click **Start saving this chat**.

See [Getting started](docs/getting-started.md) for the complete setup guide and [Troubleshooting](docs/troubleshooting.md) if you run into an issue.

## How it works

1. **Stage**: when you track a chat, gitchat captures the full conversation. Afterwards, whenever the AI finishes an answer, gitchat diffs the messages against the last commit by message ID and content hash and stages any new or updated messages automatically.
2. **Commit**: clicking **Commit** (or enabling **Auto commit**) records a snapshot of the chat file and its assets as a local commit in IndexedDB. Auto-commit runs only after an answer finishes, so a question and its answer are never split across commits.
3. **Push**: clicking **Push** (or enabling **Auto push**) commits any staged changes for the current chat and writes all pending commits to your GitHub repository via the GitHub Git Data API. Turning **Auto push** on also turns **Auto commit** on; turning **Auto commit** off also turns **Auto push** off. When an automatic action is on, its manual button is hidden from the widget.

For details on the file format, multi-device conflict resolution, init on long virtualized chats, and the three widget styles, see [How it works](docs/how-it-works.md).

## Privacy

- **No middleman**: gitchat operates no servers, analytics, or telemetry. Conversations go directly from your browser to `api.github.com`.
- **Local token storage**: your GitHub token is stored only in `chrome.storage.local` on that device, is never synced across devices, never leaves the background service worker except in requests to `github.com` and `api.github.com`, and can be scoped to a single private repository using a fine-grained personal access token.
- **Synced preferences only**: non-secret settings (widget style, repository name, auto-commit/push switches, enabled services) sync through your Chrome profile (`chrome.storage.sync`).

For a full breakdown of storage locations and extension permissions, see [Privacy](docs/privacy.md).

## Supported sites

| Service | Host | What is captured | Known limits |
| --- | --- | --- | --- |
| ChatGPT | `chatgpt.com` (new UI, classic UI, Work mode) | Text, headings, lists, links, tables (with alignment), fenced code blocks with language, TeX math (`$...$`, `$$...$$`), inline visualizations (`*.web-sandbox.oaiusercontent.com`) as rendered HTML when on screen | Temporary chats are never saved. Web-search citation pills keep the source name only (URLs are not in the page DOM). Inline visualizations are saved as rendered HTML, not original source. Reasoning summaries are excluded. Only the currently shown branch of an edited chat is saved. |
| Claude | `claude.ai` | Text, headings, lists, links, tables (with alignment), fenced code blocks with language, TeX math (`$...$`, `$$...$$`), open artifacts (`*.claudeusercontent.com`) as rendered HTML when on screen | An artifact must be open in the side panel at capture time to save its HTML. Only the currently shown branch of an edited chat is saved. |
| Gemini | `gemini.google.com` (standard chats and Gems) | Text, headings, lists, links, tables (with alignment), fenced code blocks with language, TeX math (`$...$`, `$$...$$`), Canvas previews (`*.scf.usercontent.goog`) as rendered HTML when on screen | Web-search citations are not in the message DOM. Canvas previews are saved as rendered HTML, not original source, and must be on screen at capture time. Only the currently shown branch of an edited chat is saved. |

Verified on 34–40-turn conversations across all three services (full-history init completes in roughly 4–11 seconds).

## Development

Requires Node.js 22.12+ (and Python 3 for the widget playground).

| Command | Description |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run build` | Bundle the extension into `dist/` (bundled, unminified) |
| `npm run dev` | Watch `src/` and rebuild `dist/` on change |
| `npm test` | Run Vitest unit and adapter fixture tests |
| `npm run typecheck` | Type-check `src/` and `tests/` with TypeScript |
| `npm run zip` | Build and package `dist/` into `gitchat-<version>.zip` |
| `npm run playground` | Serve the widget playground at `http://localhost:5180/playground/` |

### Code layout

| Path | Role |
| --- | --- |
| `src/shared/` | Domain types, typed message protocol (`protocol.ts`), settings defaults, i18n |
| `src/background/` | Service worker: GitHub auth and Git Data API client, IndexedDB store, staging, local commits, multi-device sync engine, Markdown file rendering |
| `src/content/` | Content script: site adapters (`adapters/`), DOM-to-Markdown capture (`capture/`), AI state observer, full-history init, Shadow DOM widget host |
| `src/content/ui/` | Framework-free ES module UI kit: liquid-glass primitives, spring physics, the three widgets (`creature`, `line`, `dot`), and the commit-graph panel |
| `src/frame/` | Helper script running in visualization iframes to serialize rendered HTML on request |
| `src/popup/` | Toolbar popup showing current chat status, commit graph, and quick actions |
| `src/options/` | Settings page and first-run onboarding wizard |
| `tests/` | Vitest suite and sanitized live-site DOM fixtures (`tests/fixtures/`) |

See [DESIGN.md](DESIGN.md) for the internal architecture contract and [Site adapters](docs/site-adapters.md) for how to update selectors when a chat site changes its HTML.

## Contributing

Contributions, bug reports, and adapter updates are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md), [docs/site-adapters.md](docs/site-adapters.md), and our [Code of conduct](CODE_OF_CONDUCT.md). To report a security vulnerability, please follow [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
