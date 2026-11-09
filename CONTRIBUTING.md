# Contributing to gitchat

Thank you for your interest in contributing to gitchat. Please read this guide along with [DESIGN.md](DESIGN.md) and our [Code of conduct](CODE_OF_CONDUCT.md) before opening a pull request.

## Ways to contribute

- **Site adapter updates**: ChatGPT, Claude, and Gemini update their DOM structures often. If a site change breaks message detection or Markdown conversion, see [docs/site-adapters.md](docs/site-adapters.md) for the fixture-driven workflow.
- **Bug fixes**: if you find a bug in staging, multi-device sync, Markdown rendering, or the UI, open an issue or submit a pull request with a regression test.
- **Documentation and localization**: English (`README.md`, `docs/*.md`, `src/_locales/en/messages.json`) and Japanese (`README.ja.md`, `docs/*.ja.md`, `src/_locales/ja/messages.json`) are maintained together and must convey the same facts.

For security vulnerabilities, do **not** open a public issue; follow [SECURITY.md](SECURITY.md) instead.

## Development setup

### Prerequisites

- **Node.js 22.12** or later
- **Google Chrome 120** or later
- **Python 3** (used only by `npm run playground` to serve the local widget playground)

### Commands

```sh
npm install          # install dependencies
npm run build        # bundle the extension into dist/ (unminified)
npm run dev          # watch src/ and rebuild dist/ on change
npm test             # run Vitest unit and adapter fixture tests
npm run test:watch   # run Vitest in watch mode
npm run typecheck    # run TypeScript type checking on src/ and tests/
npm run zip          # build and package dist/ into gitchat-<version>.zip
npm run playground   # serve http://localhost:5180/playground/ to work on the widgets
```

Releases: bump the version in `package.json`, attach the `npm run zip` archive to a GitHub release, and publish it. Publishing runs `.github/workflows/dist.yml`, which commits the built extension to the `dist` branch that users install and update with git (run that workflow by hand with a tag to republish one).

To test the extension in Chrome:

1. Run `npm run build` (or `npm run dev`).
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Click **Load unpacked** and select the `dist/` directory.

To work on the widgets (`creature`, `line`, `dot`) and commit-graph panel without reloading the extension, run `npm run playground` and open `http://localhost:5180/playground/`.

## Architecture rules

gitchat follows strict module boundaries documented in [DESIGN.md](DESIGN.md):

1. **Protocol boundary**: the parts (`src/background/`, `src/content/`, `src/popup/`, `src/options/`) communicate only through the typed request/response table and event port defined in `src/shared/protocol.ts`.
2. **Secret isolation**: GitHub tokens live only in `chrome.storage.local` and are accessed only inside `src/background/`. They must never be placed in `chrome.storage.sync`, passed to content scripts or frame scripts, or sent to any host other than `github.com` and `api.github.com`.
3. **Framework-free UI kit**: `src/content/ui/` is plain ES modules shared between the content script, the settings preview, and the standalone playground. It must not import from `src/background/`.
4. **Site knowledge stays in adapters**: keep all selector candidates and site-specific Markdown quirks inside `src/content/adapters/{chatgpt,claude,gemini}.ts`. Never match on localized UI strings (`aria-label`, button text) or build-generated class names (`ng-tns-*`, `_ngcontent-*`).
5. **Sanitized fixtures only**: DOM fixtures in `tests/fixtures/` must contain only structural HTML and synthetic test text — never personal conversations, real chat IDs, usernames, or tokens.
6. **Readable builds**: `scripts/build.mjs` bundles without minification (`minify: false`) so that users and Chrome Web Store reviewers can read the shipped code directly.

## Pull request checklist

- [ ] `npm test` passes (add or update tests in `tests/` for your change).
- [ ] `npm run typecheck` passes with no errors.
- [ ] `npm run build` succeeds cleanly.
- [ ] If you updated a site adapter, the fixture in `tests/fixtures/` is sanitized and contains no personal data.
- [ ] If you changed user-facing behavior, UI strings, or documentation, both the English and Japanese files are updated to match.

## License

By contributing to gitchat, you agree that your contributions will be licensed under the [MIT License](LICENSE).
