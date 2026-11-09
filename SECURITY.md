# Security policy

## Reporting a vulnerability

Please **do not** report security vulnerabilities through public GitHub issues, discussions, or pull requests.

Instead, report vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/Aero123421/gitchat/security/advisories/new) on the `Aero123421/gitchat` repository.

When reporting a vulnerability, please include:

- A clear description of the issue and the component affected (`src/background/`, `src/content/`, `src/frame/`, `src/options/`, `src/popup/`, or `src/manifest.json`).
- Step-by-step instructions or a minimal proof of concept to reproduce the behavior.
- The impact of the issue (for example, unauthorized access to a stored token, unintended repository writes, or cross-origin message spoofing).

We will review reports promptly, work with you on a fix in a private advisory workspace, and credit you in the advisory upon release if you wish.

## Scope

Security reports are particularly valuable in the following areas:

### 1. Token handling and credential isolation

- GitHub tokens (`AuthState.token`) must be stored exclusively in `chrome.storage.local` on the local device and must never be written to `chrome.storage.sync`, `localStorage`, or page-accessible storage.
- Tokens must remain inside the background service worker (`src/background/`) and must never be sent to content scripts, visualization frame scripts, or any host outside `https://api.github.com` and `https://github.com`.
- Runtime message and port handlers in `src/background/app.ts` must verify `sender.id === chrome.runtime.id` before processing any request.

### 2. Repository writes

- gitchat must only write to the repository explicitly chosen or created by the user in settings.
- When attaching to an existing repository (`useRepo` in `src/background/github/repo.ts`), gitchat must refuse non-empty repositories that do not carry gitchat's marker (`<!-- gitchat -->` in `README.md` or existing `chatgpt/`, `claude/`, `gemini/` Markdown files).
- Branch updates (`updateRef` in `src/background/github/git.ts`) must always use fast-forward pushes (`force: false`), never force-pushing over existing history.
- File paths generated for chats and assets (`src/background/paths.ts` and `src/background/render.ts`) must sanitize path segments and prevent path traversal outside the service directory and its `.assets/` folder.

### 3. Content capture and cross-frame communication

- Content scripts and the widget UI (`src/content/`) must not execute untrusted code from conversation pages or inject unsanitized HTML into the host page, and must keep the widget isolated inside its Shadow DOM (`<gitchat-ui>`).
- The visualization frame script (`src/frame/index.ts`) runs inside cross-origin sandboxed iframes (`*.claudeusercontent.com`, `*.web-sandbox.oaiusercontent.com`, `*.scf.usercontent.goog`). It must never send data unsolicited, and must only respond when `e.source === window.top`, `e.origin` is in the allowlist (`https://claude.ai`, `https://chatgpt.com`, `https://gemini.google.com`), and the message carries a valid `nonce`, replying strictly to `e.origin`.

## Out of scope

- Bugs where a chat provider changes its DOM selectors and capture fails without a security impact (please open a regular issue or see [docs/site-adapters.md](docs/site-adapters.md)).
- Issues requiring physical access to an unlocked device or an already-compromised browser profile.
- Vulnerabilities in third-party services (ChatGPT, Claude, Gemini, or GitHub) themselves.
