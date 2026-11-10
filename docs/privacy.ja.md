# プライバシー

[English](privacy.md)

gitchat は開発者側のサーバーを一切持たず、アクセス解析やテレメトリも行いません。会話データは、お使いのブラウザで開いているチャットページから GitHub API を通じて、あなたが指定した GitHub リポジトリへ直接送られます。

## 概要

- **独自サーバーなし**: gitchat はバックエンドサーバー、中継プロキシ、クラッシュレポート送信、アクセス解析ツールを一切運用していません。
- **選択した会話のみを取り込み**: すべての会話は、あなたが **このチャットの保存を始める** を押す（または別の端末で自分のリポジトリに保存済みのチャットを開く）まで未追跡のままです。一時チャット（ChatGPT の一時チャットなど）が読み取られたり保存されたりすることはありません。
- **通信先は GitHub のみ**: 拡張機能がネットワーク通信を行う相手は `https://api.github.com` と `https://github.com` の 2 つだけです。
- **認証情報は端末内のみに保存**: GitHub のトークンはその端末の `chrome.storage.local` にのみ保存され、他の端末へ同期されることはありません。また、トークンがバックグラウンドの Service Worker の外に出ることはなく、GitHub への HTTPS リクエストにのみ使用されます。

## データの保存場所

| 保存場所 | 端末間の同期 | 保存される内容 |
| --- | --- | --- |
| `chrome.storage.local` | なし（この端末のみ） | GitHub の認証状態（`token`、GitHub の `login` 名、認証方式 `method`、トークンの `scopes`、保存日時 `savedAt`）。 |
| `chrome.storage.session` | なし（メモリ上のみ） | OAuth Device Flow で GitHub 上の承認を待っている間の一時データ（`clientId`, `deviceCode`, ポーリング間隔 `interval`, 有効期限 `expiresAt`）。サインイン完了時またはブラウザ終了時に消去されます。 |
| `chrome.storage.sync` | あり（Chrome アカウント経由） | 機密情報を含まない設定項目のみ: ウィジェットのスタイル（`creature`, `line`, `dot`）、テーマ（`auto`, `light`, `dark`）、`autoCommit`、`autoPush`、保存先リポジトリ（`owner`, `name`, `branch`）、有効なサービス（`chatgpt`, `claude`, `gemini`）、`saveVisualizations`、および任意のカスタム `githubClientId`。トークンなどの秘密情報がここに保存されることはありません。 |
| `IndexedDB`（`gitchat`） | なし（この端末のみ） | 追跡中のチャットレコード（`chats`）、ローカルコミット（`commits`）、同期状態のメタデータ（`meta`）。ローカルコミットが GitHub へプッシュされると、コミットレコード内の本文データ（`doc`）は削除され、ウィジェットのコミットグラフ表示用に各チャット最新 12 件のプッシュ済みコミット概要のみが保持されます。 |
| あなたの GitHub リポジトリ | GitHub 上に保存 | 追跡中のチャットごとの Markdown ファイル（`chatgpt/`, `claude/`, `gemini/`）、取り込まれた可視化の HTML ファイル（`<chat>.assets/*.html`）、および初回の `README.md`。 |

## ネットワーク通信

gitchat が通信を行うドメインは次の 2 つのみです。

1. **`https://api.github.com/*`**
   - `GET /user`: 接続時にトークンを検証し、GitHub のユーザー名を取得します。
   - `GET /user/repos`, `POST /user/repos`, `GET /repos/<owner>/<name>`, `PUT /repos/<owner>/<name>/topics`: セットアップ時に保存先リポジトリの一覧取得、新規作成、状態確認を行います。
   - `PUT /repos/<owner>/<name>/contents/README.md`: 空のリポジトリを初期化する際、最初のコミットとして `README.md` を作成します。
   - `GET /repos/<owner>/<name>/git/...` および `POST /repos/<owner>/<name>/git/...` / `PATCH .../git/refs/...`: GitHub Git Data API を使ってリポジトリのツリー確認とコミットのプッシュを行います。
2. **`https://github.com/*`**
   - `POST https://github.com/login/device/code` および `POST https://github.com/login/oauth/access_token`: 「GitHub でサインイン」（OAuth Device Flow）を使う場合にのみ通信します。

これら以外の外部サーバーへの通信は一切行われません。

## 拡張機能の権限について

[`src/manifest.json`](../src/manifest.json) で要求している各権限の用途は次のとおりです。

| 権限 / マッチパターン | 必要な理由 |
| --- | --- |
| `storage` | 端末固有の認証情報を `chrome.storage.local` に、Device Flow の一時状態を `chrome.storage.session` に、機密情報を含まない設定を `chrome.storage.sync` に保存するため。 |
| `alarms` | 自動プッシュがネットワークエラーや GitHub のレート制限で失敗した際、一定時間後に再試行用アラーム（`gitchat:push-retry`）で Service Worker を起動するため。 |
| `https://api.github.com/*` | バックグラウンドの Service Worker から GitHub REST API および Git Data API と通信するため。 |
| `https://github.com/*` | 「GitHub でサインイン」使用時に OAuth デバイスコードの発行・トークン交換を行うため。 |
| `https://chatgpt.com/*`, `https://claude.ai/*`, `https://gemini.google.com/*`, `https://grok.com/*` | 対応する 4 つのチャットサイト上で `content.js` を動かし、ウィジェットの表示と、追跡対象の会話の Markdown 変換を行うため。 |
| `https://*.claudeusercontent.com/*`, `https://*.scf.usercontent.goog/*`, `https://*.web-sandbox.oaiusercontent.com/*` | Claude のアーティファクト、Gemini の Canvas、ChatGPT のインライン可視化を描画するサンドボックス iframe 内で `frame.js`（`all_frames: true`）を動かし、レンダリング済み HTML をチャットと一緒に保存できるようにするため。 |

### スクリプトとトークンの分離

- **トークンの隔離**: GitHub トークンはバックグラウンドの Service Worker（`src/background/`）内部でのみ読み書き・使用されます。チャットページ上のコンテンツスクリプト（`content.js`）や可視化フレーム内のスクリプト（`frame.js`）がトークンを受け取ることはありません。
- **メッセージ送信元の検証**: バックグラウンドの Service Worker は、`sender.id` が自身の拡張機能 ID（`chrome.runtime.id`）と一致するメッセージおよびポート接続のみを受け付けます。
- **フレーム間通信の検証**: `frame.js` が自発的にデータを外部へ送信することはありません。許可された親オリジン（`https://claude.ai`, `https://chatgpt.com`, `https://gemini.google.com`, `https://grok.com`）の `window.top` からワンタイムの `nonce` 付きで `frame/serialize` リクエストが届いたときにのみ、その `e.origin` に対してレンダリング済み HTML を返します。

## チャットを安全に保つための推奨設定

1. **非公開（Private）リポジトリを使う**: gitchat でリポジトリを新規作成する場合、初期設定で **非公開** がオンになっています。公開（Public）リポジトリを選ぶと誰でもチャットを読める状態になるため、警告が表示されます。
2. **1 つのリポジトリに限定した fine-grained トークンを使う**: GitHub の fine-grained 個人アクセストークン作成画面で、**Repository access** を **Only select repositories** にし、チャット保存用リポジトリ 1 つだけを選択したうえで、**Contents: Read and write** と **Metadata: Read** のみを付与してください。この設定により、トークンが他のリポジトリの読み書きに使われることを防げます。
3. **認証情報とデータの削除方法**:
   - この端末からトークンを削除するには、**設定 → アカウント** で **サインアウト** を押すか、**設定 → 詳細** で **設定をリセット** を実行します。
   - GitHub 側でトークンを無効化するには、[GitHub Settings → Personal access tokens](https://github.com/settings/tokens) から該当トークンを削除（または OAuth アプリの認可を取り消し）してください。
   - 拡張機能をアンインストールすると、ブラウザ内の `chrome.storage.local` および IndexedDB（`gitchat` データベース）は削除されます。GitHub リポジトリ上のファイルはそのままあなたの手元に残ります。
