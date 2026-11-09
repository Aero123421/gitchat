# Troubleshooting

[日本語](troubleshooting.ja.md)

This page covers common questions and error messages when setting up or using gitchat.

## GitHub connection and sign-in

### Clicking "Sign in with GitHub" switches to the personal access token screen

If the build you installed does not include a built-in OAuth client ID (or if Device Flow is not enabled on the configured OAuth app), gitchat automatically switches to the **Personal access token** form.

- **Recommended fix**: click **Create a token on GitHub** to create a fine-grained personal access token scoped to your chat archive repository with **Contents: Read and write** and **Metadata: Read**, then paste the token into gitchat.
- **Alternative (for forks or self-managed apps)**: create your own GitHub App or OAuth App, enable **Device Flow** in its settings on GitHub, and paste its Client ID into **Settings → Advanced → GitHub OAuth client ID**.

### "GitHub didn't accept this token" or "This account can't write to that repository"

Check the following on [GitHub's personal access tokens page](https://github.com/settings/tokens):

1. The token has not expired or been revoked.
2. **Resource owner** matches the account or organization that owns the archive repository.
3. Under **Repository access**, the archive repository is included.
4. Under **Repository permissions**, **Contents** is set to **Read and write** and **Metadata** is set to **Read**.

You can go back and use a different token without removing the extension: **Wrong token? Use a different one** on the repository step, or **Use a different token** on the GitHub step.

### "The code expired. Try again."

OAuth device codes expire after 15 minutes. Start the sign-in again and approve the new code on GitHub before the countdown finishes.

## Choosing a repository

### "This repository already has files that gitchat did not create"

To protect your existing projects, gitchat refuses to use a non-empty repository unless it recognizes the repository as a gitchat archive (either its `README.md` contains `<!-- gitchat -->` or it already has `.md` files inside `chatgpt/`, `claude/`, or `gemini/`).

Choose an empty repository, or let gitchat create a new private repository for you.

### Creating a new repository fails when using a fine-grained token

A fine-grained personal access token that is restricted to **Only select repositories** cannot create new repositories through the GitHub API. To use a single-repository token:

1. Create a new empty private repository on GitHub (gitchat's **Create a repository on GitHub** button opens the form pre-filled; leave README, `.gitignore` and license unchecked).
2. Create a fine-grained token scoped to that repository with **Contents: Read and write** and **Metadata: Read**.
3. In gitchat's repository step, choose **Existing repository** (gitchat opens it first when you connected with a token) and pick the repository you created.

### My repository does not appear in the list

gitchat lists the repositories your sign-in can push to. If a repository is missing:

- Type its full name (`owner/name`) in the search box, click **Look up owner/name**, then **Use**.
- Verify that your fine-grained token includes that repository under **Repository access** and grants **Contents: Read and write**.
- Push permission is required; read-only repositories are filtered out.

## Widget and chat detection

### The widget does not appear on a chat page

Check these four conditions:

1. **The conversation has a permanent URL**:
   - On a blank "New chat" screen before the first message is sent, there is no conversation ID yet.
   - On ChatGPT right after sending the first prompt, the URL briefly uses a transient `/c/local-chatgpt:<uuid>` path; gitchat waits until ChatGPT assigns the permanent `/c/<uuid>` URL.
   - Supported URL paths are `chatgpt.com/c/<uuid>`, `claude.ai/chat/<uuid>`, and `gemini.google.com/app/<id>` (or `/gem/<gem>/<id>`).
2. **Not a temporary chat**: ChatGPT temporary chats (`?temporary-chat=true`) are meant to disappear, so gitchat never shows the widget or saves them.
3. **Service is enabled in settings**: open **Settings → Behavior → Services** and confirm that **ChatGPT**, **Claude**, or **Gemini** is switched on.
4. **Tab was already open before installing or reloading the extension**: Chrome does not inject new content scripts into tabs that were already open before the extension was loaded. Reload the chat tab once.

### The Commit or Push button is missing from the widget

When an action is automated, its manual button is hidden:

- Turning **Auto commit** on hides the **Commit** button.
- Turning **Auto push** on hides both the **Commit** and **Push** buttons (if a push fails, the **Push** button reappears in red so you can retry).

You can toggle **Auto commit** and **Auto push** in the widget panel (click the widget) or under **Settings → Behavior**.

## Capturing and full-history init

### Starting tracking (init) takes a long time on a long conversation

ChatGPT, Claude, and Gemini all load older turns lazily in batches (5 turns per batch on ChatGPT, 32 rows on Claude, 10 turns on Gemini) and re-anchor the scroll container after each batch. During **init**, gitchat scrolls to the top repeatedly until the site stops adding older turns, then walks from top to bottom so virtualized lists are read in full.

- Keep the chat tab active while the counter (`↑ N`) and reading percentage (`0–100%`) progress.
- On 34–40-turn conversations, init typically takes 4–11 seconds; conversations with hundreds of turns take longer because the site must fetch each batch from its server.
- You can click **Cancel** under the widget at any time to stop init.

### "The capture found no messages, so nothing was changed"

gitchat validates every capture before updating your stored conversation. If the page had not finished rendering or the chat site changed its DOM structure so no messages matched, gitchat refuses the empty capture rather than overwriting your data.

1. Reload the chat page and wait for the conversation to finish rendering, then try again.
2. If a site update changed its HTML structure, see [Site adapters](site-adapters.md) for how selector candidates are updated, or open an issue on GitHub.

### "Couldn't load the whole chat, so nothing was saved"

Init only saves a chat once it has loaded the whole history. This message means the site kept loading older messages for more than 10 minutes, or never settled. Keep the tab open and visible, check your connection, and start again; a very long chat on a slow connection may need a second try.

### "Some messages could not be read, so nothing was saved"

On long chats the site only keeps part of the conversation on the page and draws the rest as you scroll. gitchat checks that it saw every message (on Claude, every numbered row) before saving. This message means some rows never appeared while it scrolled, usually because the page was slow to draw them. Keep the tab visible and start again.

### "Couldn't read the latest messages, so nothing was committed or pushed"

Commit and Push read the page once more before they run, so they include the newest answer. When that read fails, they stop instead of saving an older state. Wait until the page has finished loading and try again; reloading the tab also helps.

### "Reading the chat stopped moving, so it was not saved"

While reading a long chat, gitchat scrolls through it and stops if the page neither scrolls nor shows new messages for 25 seconds. Scroll the chat a little (or reload the tab) and start again.

### "The page still showed the previous chat, so nothing was saved"

Right after you switch chats, the page can still show the previous conversation for a moment. gitchat never saves those messages under the new chat; it waits up to 10 seconds for the new one and then stops. Wait until the chat has loaded and start again.

### "The answer is still running. Start saving again when it has finished."

Init waits for an answer that is still being written, so the saved chat never ends with a question alone. If the answer does not finish within 10 minutes, init stops with this message. Start again once the answer is done.

### "No answers were found in this chat, so nothing was saved"

The page showed your messages but no answers. Usually the page had not finished rendering; reload it and try again. If it keeps happening, the site may have changed its HTML: please open an issue (see [Site adapters](site-adapters.md)).

### An interactive visualization (Artifact, Canvas, or inline chart) was not saved as an HTML file

For gitchat to save a visualization into `<chat>.assets/<name>.html`:

1. **Save visualizations** must be enabled under **Settings → Behavior → Capture** (enabled by default).
2. The visualization iframe (`*.claudeusercontent.com`, `*.web-sandbox.oaiusercontent.com`, or `*.scf.usercontent.goog`) must be **open and rendered on screen** when the capture happens. On Claude, make sure the artifact side panel is open when the answer finishes or when you start tracking the chat.

Note that Gemini Canvas and ChatGPT inline visualizations are saved as their rendered HTML output, not their original source code.

### Web-search citations on ChatGPT or Gemini have no URLs

ChatGPT and Gemini do not put web-search citation URLs into the message DOM (they are only loaded when you hover or click the citation pill). gitchat preserves the source name in brackets (for example, `[Source]`).

### Edited messages or regenerated answers

When a conversation has multiple branches from editing a message or regenerating a response, only the branch currently displayed on screen is captured. Edits and regenerated answers are picked up automatically, and when the page no longer matches what was saved (for example after editing the very first prompt), gitchat reads the whole chat again on its own (the widget shows progress). If the saved copy still looks wrong after switching branches, click **Read the whole chat again** (↻) in the toolbar popup.

## Pushing and multi-device sync

### Push failed due to a network error or GitHub rate limit

Your local commits remain stored in IndexedDB on your device; no captured messages are lost.

- Click **Push** in the widget or toolbar popup to retry manually.
- If **Auto push** is enabled, gitchat automatically schedules a background retry via `chrome.alarms` using exponential backoff (up to 30 minutes, or waiting until GitHub's rate-limit reset timestamp). The wait survives restarts of the extension's background worker; pressing **Push** yourself retries right away.

### "gitchat's background stopped responding. Try again."

Chrome periodically suspends idle Manifest V3 service workers, or the extension may have just been updated or reloaded. Try the action again, or reload the chat tab if the content script was disconnected by an extension reload.

### A commit made on one computer was skipped after pushing from another computer

When two devices change the same chat, gitchat merges the changes from both, message by message, against the version it last synced. If the copy in the repository already contains everything a local commit would add, that commit has nothing left to send and is skipped ("superseded"). Your messages are in the file; earlier versions remain in your repository's `git log`.
