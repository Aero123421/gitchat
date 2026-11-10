# Site adapters

ChatGPT, Claude, Gemini, and Grok update their front-end HTML frequently. To keep site-specific knowledge isolated and easy to maintain, all DOM knowledge for each service lives in a single adapter file under `src/content/adapters/`:

- [`src/content/adapters/chatgpt.ts`](../src/content/adapters/chatgpt.ts) — `chatgpt.com` (new app shell, classic UI, and Work mode)
- [`src/content/adapters/claude.ts`](../src/content/adapters/claude.ts) — `claude.ai`
- [`src/content/adapters/gemini.ts`](../src/content/adapters/gemini.ts) — `gemini.google.com` (standard chats and Gems). A second Google account adds `/u/<n>` in front of the path; the chat id and the saved link omit that slot.

Shared helpers live in [`src/content/adapters/define.ts`](../src/content/adapters/define.ts), [`src/content/adapters/dom.ts`](../src/content/adapters/dom.ts), and [`src/content/adapters/types.ts`](../src/content/adapters/types.ts).

## Design rules

1. **Adapters are mostly data (ranked selector candidates)**:
   Each selector concept (`user`, `assistant`, `userBody`, `assistantBody`, `generating`, `composer`, `scroller`, `loadingOlder`, `start`, `title`, `dark`) is an ordered array of CSS selector strings (`SelectorPack`). `pick()` and `pickAll()` in `src/content/adapters/dom.ts` try candidates in order and return the first selector that matches at least one element. When a site rolls out a new UI, put the new selector first and keep the previous selector behind it so gradual rollouts and classic views keep working.
2. **Never match localized text**:
   All three sites translate `aria-label` attributes, button captions, tooltips, and placeholder labels into the user's interface language. Never match on human-readable text; match on structural custom elements (`user-query`, `model-response`), `data-testid`, or non-localized `data-*` attributes.
3. **Never match generated or hashed class names**:
   Avoid build-generated classes such as Angular's `ng-tns-*` and `_ngcontent-*` or hashed CSS module names that change on every deploy.
4. **Never write HTML into the host page**:
   Gemini enforces Trusted Types on the main document. Content capture only reads from the page DOM, and the widget renders inside an isolated `<gitchat-ui>` Shadow DOM.
5. **Account for virtualized lists, hidden panes, and `content-visibility: auto`**:
   - **ChatGPT** can leave a stale `0×0` copy of `.thread-scroll-container` in the DOM after navigation; `transcript()` reads only the visible pane (`getBoundingClientRect().height > 0`), and nothing at all while panes exist but none is visible. The controller adds a site-independent guard: after a navigation, a read whose message ids all belong to the previous chat is not a read of the new chat (a chat branched from it is recognized by its first message of its own). ChatGPT also names the open conversation in the DOM; when that id matches the URL, the guard ends even if every message id was copied, and while it still names the previous chat, captures stop (any other mismatch is ignored: the id can lag behind the URL right after a chat is created). A URL change that keeps the chat id (an account slot or a query) is checked the same way: if the visible message ids share nothing with this visit, captures stop until they overlap again.
   - **Gemini** uses `content-visibility: auto` on off-screen turns, which causes `element.innerText` to return an empty string. Always read text through `textContent` and structural DOM walks (`userText()` in `src/content/capture/snapshot.ts` and `toMarkdown()` in `src/content/capture/markdown.ts`).
   - **ChatGPT** `fallback-turn-N` keys are window-relative in virtualized lists and shift as the user scrolls; the adapter never uses them as message identity (it falls back to a content fingerprint instead).
6. **Validate captures before staging**:
   `mergeSnapshot()` (`src/background/stage.ts`) refuses empty complete captures (`complete: true`) and treats live captures (`complete: false`) as upserts by message ID so a broken selector or unloaded virtualized rows never overwrite previously captured messages. A live capture that cannot be placed safely is refused and answered with `fullRead`, and the tab reads the whole chat again. That includes a branch captured away from the bottom: an unknown id after a known one, where the saved chat continues with a different message. A capture taken mid-answer does not ask for that full read.
7. **Tie a preview to its message only on evidence**:
   A preview panel (Claude artifact, ChatGPT file preview) belongs to the card that is marked current (`aria-current="true"` on Claude) or to the card the user clicked (`ctx.opened()`). A title match is not enough on a virtualized list: the owning card may be unmounted while another card with the same title is on screen. Without evidence the preview is skipped and the saved copy is kept.

## Current site hooks

Verified against the live sites (2026-11):

| Concept | ChatGPT (new app shell + classic) | Claude | Gemini | Grok |
| --- | --- | --- | --- | --- |
| Message hook | `[data-chatgpt-search-unit-key$=":user"/":assistant"]` or `data-content-search-unit-key` (classic: `data-message-author-role`) | `[data-testid=user-message/assistant-message]` | `user-query` / `model-response` | `[data-testid=user-message/assistant-message]` |
| Stable id | `data-chatgpt-search-message-ids` (classic: `data-message-id`) | `data-turn-key` | `.conversation-container#<16hex>` (`<id>:u` / `<id>:a`) | `#response-<uuid>` (one row per message; temporary for ~0.5 s after sending) |
| Thinking / streaming | `[data-response-starting]` / `[data-talvt-turn-state=in_progress]` (classic: `[data-testid="stop-button"]`) | `[data-testid="chat-input-stop"]` / `data-is-streaming=true`. The streaming row's `data-turn-key` is remembered, so an answer that finishes while that row is unmounted is staged when the row is back | `pending-request` / `.markdown[aria-busy=true]` | `[data-testid=canvas-working-indicator]` without `data-settled`, the stop icon (`g[id="name=player-stop"]`) or an empty `.action-buttons.last-response` / `[data-sd-animate]`. The busy row's id is remembered like Claude's |
| Long chats | Virtualized (~11 turns), +5 turns per load | Virtualized (~20 rows), +32 rows per load | +10 turns per load, `content-visibility:auto` | Virtualized (~15 rows), ~50 messages on load, the rest behind `[data-plane-row="chat:earlier-turns"]` |
| Start of chat | None (stability: `topQuietMs: 3500`) | None (stability; `aria-posinset="1"` marks only the first loaded row) | None (stability: default `topQuietMs: 2500`) | `transcript:top-inset` row without the loader row (`atStart`) |
| Visualization frames | `*.web-sandbox.oaiusercontent.com` | `*.claudeusercontent.com` (inside `iframe[src*="/code/artifact/"]`) | `*.scf.usercontent.goog` (inside `immersive-entry-chip`) | None |
| Code / inline code | `[data-code-block="true"]` box: language label in its `[data-markdown-copy="exclude"]` bar, source in `[data-code-block-source] code` (earlier: raw source in `data-chatgpt-copy-code`); inline code is `span[data-markdown-copy="inline-code"]` | `pre > code` with `language-*` | `code-block` with a language label | `[data-code-card]` with a language label; inline code is `span.!font-mono`. The prompt is rendered as Markdown too, so it is turned back into the typed text |

ChatGPT also marks copy roles on its markup (`data-markdown-copy="exclude" / "code-block" / "inline-code" / "contents"`): these are the most stable hooks it has, and the adapter relies on them. Citation links (`a[data-testid="chatgpt-citation"]`) carry a favicon `<img>`; the converter drops images inside links that have text, so the label is the source name.

## Adapter specification reference

An adapter is created with `defineAdapter(spec)` (`src/content/adapters/define.ts`).

### `AdapterSpec` fields

| Field | Type | Purpose |
| --- | --- | --- |
| `service` | `'chatgpt' \| 'claude' \| 'gemini' \| 'grok'` | Service identifier used in chat keys and repository folder names. |
| `siteNames` | `string[]` | Suffixes stripped from `document.title` when deriving the conversation title. |
| `chatId(url)` | `(url: URL) => string \| null` | Extracts the conversation ID from the page URL, or returns `null` on non-chat pages and temporary chats. Ids are lowercased (hex / UUID); the chat key is unchanged. Gemini accepts an optional `/u/<n>` prefix and does not put it in the id. |
| `canonicalUrl?(url)` | `(url: URL) => string` | URL stored and sent for the chat. Default is origin + pathname (no query, no hash). Gemini also drops a leading `/u/<n>`. Not the chat key. |
| `pageChatId?(doc)` | `(doc: Document) => string \| null` | Conversation id the page itself reports. Null (or omitted) keeps the URL-only behaviour. ChatGPT reads `data-chatgpt-conversation-selection-target` / `data-chatgpt-selection-conversation-id` on the visible pane. |
| `root?(doc)` | `(doc: Document) => ParentNode` | Optional root container when the page keeps duplicate hidden transcripts in the DOM (used on ChatGPT). |
| `virtualized` | `boolean` | `true` when the site removes off-screen messages from the DOM (ChatGPT, Claude, Grok). Init then harvests while scrolling and serializes visualizations at each step; `false` (Gemini) reads the loaded transcript in one pass. |
| `doneQuietMs?` | `number` | Quiet period (ms) after streaming stops before an answer counts as finished (default `700`; `3000` on ChatGPT, longer than the 1.9 s false-completion gap measured in Work mode). The timer restarts while the answer text keeps changing. |
| `topQuietMs?` | `number` | Quiet period (ms) at the top of the scroller before `init` concludes no older turns remain (default `2500`; `3500` on ChatGPT). Every site needs this full period: a start-of-chat marker such as Claude's `aria-posinset="1"` only marks the first *loaded* row. |
| `selectors` | `SelectorPack` | Ranked CSS selector candidates for `user`, `assistant`, `userBody`, `assistantBody`, `generating`, `composer`, `scroller`, `loadingOlder`, `start`, `title`, and `dark`. |
| `idOf?(el, role)` | `(el: Element, role: Role) => string \| null` | Returns the service's stable message ID when exposed in the DOM; falls back to a deterministic content fingerprint (`assignIds`). |
| `bodyOf?(node)` | `(node: MessageNode) => Element \| null` | Builds or selects a custom content element when a message's prose is split across multiple sub-elements (e.g. Claude's `.standard-markdown` segments around tool-use blocks, or Gemini's `p.query-text-line`). |
| `atStart?(doc)` | `(doc: Document) => boolean` | True when the very start of the conversation is rendered, for a site where one `start` selector cannot say it (Grok: the top row is mounted and no loader row follows). Overrides `selectors.start`. |
| `loadedCount?(doc)` | `(doc: Document) => number \| null` | Total messages loaded so far when the site exposes a count (e.g. `aria-setsize` on Claude). |
| `aiPhase?(doc)` | `(doc: Document) => 'idle' \| 'thinking' \| 'streaming' \| null` | Precise AI state from site-specific attributes; returning `null` falls back to `AiObserver`'s generic heuristic. |
| `artifacts?(doc, ctx)` | `(doc: Document, ctx: { skip }) => Promise<CapturedArtifact[]>` | Requests rendered HTML from open visualization iframes via `requestFrameHtml()`. Each artifact has a stable `key` (the site's artifact id, or the owning message id plus the frame's position) and its owning `messageId`; the key names the saved file. `skip` lists keys already collected during init. |
| `markdown?` | `MarkdownHooks` | Site-specific hooks passed to `toMarkdown()`. |

### `MarkdownHooks` fields

| Hook | Purpose |
| --- | --- |
| `ignore` | CSS selectors for chrome elements to drop completely (copy buttons, action bars, screen-reader-only labels, `.katex-html`, reasoning tone blocks). |
| `render(el, children, kind)` | Custom Markdown output for site-specific elements (such as ChatGPT's `[data-code-block]` boxes and inline-code spans, custom bold/italic spans, citation pills, file cards, or artifact cards). Runs before `ignore` and before built-in skipping (so a `<button>` can be a card); `kind('code')` records the content kind for the widget. |
| `headingLevel(el)` | Adjusts heading levels when a site shifts them (ChatGPT's `[data-d-component]` headings and Claude shift `##` to `<h3>`, so `Number(el.tagName[1]) - 1` restores level 2). |
| `linkLabel(a)` | Customizes link text (e.g. stripping `+3` counters from Claude citation pills). |
| `codeLanguage(pre)` | Extracts the language identifier when it is stored in a decorative header rather than a `language-*` class (used on Gemini and Grok). |
| `math(el)` | Extracts `{ tex, display }` when a site wraps math in custom attributes (such as ChatGPT's `[data-d-component="math"]`). |
| `iframe(el)` / `image(el)` | Custom rendering for `<iframe>` or `<img>` elements. |

## Workflow when a site changes its HTML

When ChatGPT, Claude, Gemini, or Grok updates its DOM and a selector stops matching, follow this workflow:

### 1. Inspect the live page

Open DevTools on the live conversation page and locate:

- The outer element for each user and assistant turn, and where the stable turn/message UUID is stored.
- The inner container holding the rendered Markdown prose (excluding thinking/reasoning summaries, toolbars, and copy buttons).
- The attributes or elements present while the model is thinking vs. streaming vs. idle.
- The scroll container element that scrolls the transcript.

Check that every attribute you pick is independent of UI language and build hashes.

### 2. Capture a sanitized DOM fixture

Create or update a fixture under `tests/fixtures/`:

- Keep **only** the structural HTML and attributes needed to exercise the adapter (message containers, prose elements, code blocks, math annotations, tables, citation pills, artifact cards, and streaming/thinking states).
- Replace all text content with short, synthetic test strings.
- **Never** commit personal conversations, real chat IDs, user names, email addresses, tokens, or signed URLs.

### 3. Add or update an adapter test first

Run the test suite in watch mode:

```sh
npm run test:watch
```

Add or update a test in `tests/` that loads the fixture into a DOM document and verifies:

- `adapter.messages(doc)` finds all user and assistant messages in order with stable IDs.
- `captureVisible(adapter, doc)` produces the expected Markdown (headings, formatting, fenced code with language, TeX math, tables, and artifact markers).
- `adapter.aiPhase(doc)` and `adapter.isGenerating(doc)` report the right state for idle, thinking, and streaming DOM states.

### 4. Update the adapter

Edit `src/content/adapters/<service>.ts`:

- Add the new selector at the **front** of the relevant array in `selectors` so it takes priority while keeping the previous selector as a fallback for accounts still on the older UI.
- If the site changed how it renders a specific Markdown construct (such as code blocks, math, or heading levels), update the `markdown` hooks in the same adapter file rather than adding site-specific branches to `src/content/capture/markdown.ts`.

### 5. Verify

1. Run the full test suite and type checker:
   ```sh
   npm test
   npm run typecheck
   ```
2. Build the extension and reload it in Chrome:
   ```sh
   npm run build
   ```
3. Verify on the live site:
   - Tracking a short chat (`init`), sending a new turn, committing, and pushing.
   - Capturing code blocks, inline and display math, tables, and an open visualization/artifact.
   - Running `init` on a long conversation (30+ turns) to confirm that lazy-loaded batches and scroll restoration work cleanly.
