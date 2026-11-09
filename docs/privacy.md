# Privacy

[日本語](privacy.ja.md)

gitchat has no servers of its own, no analytics, and no telemetry. Your conversations travel only from the chat page in your browser to the GitHub repository you choose, through the GitHub API.

## Summary

- **No developer servers**: gitchat does not run any backend service, proxy, crash reporter, or analytics collector.
- **Selective capture**: conversations are untracked until you click **Start saving this chat** (or open a conversation that another one of your devices already saved in your repository). Temporary chats (such as ChatGPT temporary chat) are never read or saved.
- **Direct to GitHub**: the extension makes network requests only to `https://api.github.com` and `https://github.com`.
- **Device-local credentials**: your GitHub token is stored only in `chrome.storage.local` on that device, is never synced across devices, and never leaves the background service worker except in HTTPS requests to GitHub.

## Where data is stored

| Location | Synced across devices? | What is stored |
| --- | --- | --- |
| `chrome.storage.local` | No (this device only) | Your GitHub authentication state (`token`, GitHub `login`, auth `method`, token `scopes`, and `savedAt` timestamp). |
| `chrome.storage.session` | No (in-memory only) | Temporary OAuth device-flow state (`clientId`, `deviceCode`, polling `interval`, `expiresAt`) while waiting for you to approve a sign-in on GitHub. Cleared as soon as sign-in finishes or the browser closes. |
| `chrome.storage.sync` | Yes (via your Chrome account) | Non-secret preferences only: widget style (`creature`, `line`, `dot`), theme (`auto`, `light`, `dark`), `autoCommit`, `autoPush`, target repository (`owner`, `name`, `branch`), enabled services (`chatgpt`, `claude`, `gemini`), `saveVisualizations`, and optional custom `githubClientId`. Secrets are never stored here. |
| `IndexedDB` (`gitchat`) | No (this device only) | Tracked conversation records (`chats`), local commits (`commits`), and sync status metadata (`meta`). Once a local commit is pushed to GitHub, its full document payload (`doc`) is deleted from the commit record, and only the 12 most recent pushed commit summaries per chat are kept for the widget's commit graph. |
| Your GitHub repository | Stored on GitHub | One Markdown file per tracked chat (`chatgpt/`, `claude/`, `gemini/`), rendered HTML files of captured visualizations (`<chat>.assets/*.html`), and the initial `README.md`. |

## Network requests

gitchat only connects to two domains:

1. **`https://api.github.com/*`**
   - `GET /user`: verifies your token and reads your GitHub username when connecting.
   - `GET /user/repos`, `POST /user/repos`, `GET /repos/<owner>/<name>`, `PUT /repos/<owner>/<name>/topics`: lists, creates, or checks your chosen archive repository during setup.
   - `PUT /repos/<owner>/<name>/contents/README.md`: creates the initial commit when bootstrapping an empty repository.
   - `GET /repos/<owner>/<name>/git/...` and `POST /repos/<owner>/<name>/git/...` / `PATCH .../git/refs/...`: reads the repository tree and pushes commits using the GitHub Git Data API.
2. **`https://github.com/*`**
   - `POST https://github.com/login/device/code` and `POST https://github.com/login/oauth/access_token`: used only when signing in via the OAuth device flow.

No other network requests are made by the extension.

## Extension permissions explained

Every permission requested in [`src/manifest.json`](../src/manifest.json) has a single purpose:

| Permission / Match pattern | Why it is required |
| --- | --- |
| `storage` | Saves device-local authentication in `chrome.storage.local`, temporary device-flow state in `chrome.storage.session`, and non-secret preferences in `chrome.storage.sync`. |
| `alarms` | Schedules a wakeup alarm (`gitchat:push-retry`) to retry a failed automatic push after a transient network error or GitHub rate limit. |
| `https://api.github.com/*` | Communicates with the GitHub REST and Git Data APIs from the background service worker. |
| `https://github.com/*` | Exchanges OAuth device codes when using "Sign in with GitHub". |
| `https://chatgpt.com/*`, `https://claude.ai/*`, `https://gemini.google.com/*` | Runs `content.js` on the three supported chat sites to render the widget and read conversation messages into Markdown when you track a chat. |
| `https://*.claudeusercontent.com/*`, `https://*.scf.usercontent.goog/*`, `https://*.web-sandbox.oaiusercontent.com/*` | Runs `frame.js` (`all_frames: true`) inside the sandboxed iframes used for Claude artifacts, Gemini Canvas, and ChatGPT inline visualizations so their rendered HTML can be saved alongside the chat. |

### Isolation of scripts and secrets

- **Token isolation**: the GitHub token is read and used exclusively inside the background service worker (`src/background/`). Content scripts (`content.js`) and visualization frame scripts (`frame.js`) never receive the token.
- **Message validation**: the background service worker only accepts runtime messages and ports whose `sender.id` matches `chrome.runtime.id`.
- **Cross-frame visualization handshake**: `frame.js` never transmits data on its own. It responds only when `window.top` from an allowed parent origin (`https://claude.ai`, `https://chatgpt.com`, or `https://gemini.google.com`) sends a `frame/serialize` request with a one-time `nonce`, and posts the serialized HTML back only to that `e.origin`.

## Recommendations for keeping your chats private

1. **Use a private repository**: when gitchat creates a repository for you, **Private** is enabled by default. If you choose an existing public repository, gitchat warns you before continuing because anyone on the internet would be able to read your pushed conversations.
2. **Use a fine-grained personal access token scoped to one repository**: on GitHub's fine-grained token page, set **Repository access** to **Only select repositories**, pick only your chat archive repository, and grant only **Contents: Read and write** and **Metadata: Read**. That token cannot read or write any of your other repositories.
3. **Removing your data**:
   - To remove the token from your computer, open **Settings → Account** and click **Sign out** (or click **Reset settings** under **Settings → Advanced**).
   - To revoke access on GitHub, delete the token under [GitHub Settings → Personal access tokens](https://github.com/settings/tokens) or revoke the OAuth app authorization.
   - Uninstalling the extension removes its `chrome.storage.local` data and its `gitchat` IndexedDB database from your browser. Your GitHub repository remains under your control on GitHub.
