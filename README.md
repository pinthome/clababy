# クラベビー（引っ越し先の子育て支援くらべ）

1都3県212市区町村（東京都は島しょ部9町村を含む全62区市町村）の子育て支援制度を、ご家族の条件に合わせて比較できるWebアプリ。

- 公開URL: https://kosodate.pint-home.com/
- 妊娠〜出生・未就学・小中高のステージ別に「これから受けられる支援」を概算表示
- 自治体を最大3つえらんで比較表を作成（県またぎ可・行列固定）
- 制度内容は2026年7月時点の各自治体公式サイト・各都県の公表資料に基づく

## 構成

| パス | 役割 |
|---|---|
| `app/index.html` | **編集するのはここ**（可読ソース。HTML/CSS/JS） |
| `src/prefs.json` | 制度データ（212自治体。HTMLには埋め込まない） |
| `src/worker.js` | Worker: https強制＋`/api/prefs`（同一オリジンチェック付き）＋静的配信 |
| `scripts/build.mjs` | `app/index.html` → `public/index.html`（ミニファイ・識別子マングル・著作権バナー付与） |
| `public/index.html` | **ビルド生成物**（gitignore済み。直接編集しない） |

制度データは `/api/prefs` から実行時に取得する。HTMLの保存・view-sourceだけではデータが手に入らず、
APIは `Sec-Fetch-Site` / `Referer` でサイト内fetchのみ許可する（ヘッダ偽装までは防げない簡易対策。
本命はフッターの著作権表記＋robots.txtのAIボット拒否＋Cloudflareダッシュボードのボット対策）。

## ローカル開発

```sh
npm ci
cp .dev.vars.example .dev.vars   # devでのhttps強制リダイレクト抑止＋APIチェック緩和（必須）
npm run dev                       # build + wrangler dev
```

`app/index.html` を変更したら再ビルドが必要（`npm run dev` を再実行 or `npm run build`）。

```sh
npm test          # build + スモークテスト + Workerテスト
npm run deploy    # build + wrangler deploy
```

## 運用メモ（重要）

- `public/_headers` の CSP に `script-src` を**入れないこと**。Cloudflare の Web Analytics（自動計測）が HTML にビーコンを注入する際、`script-src` を自社ハッシュに書き換えるため、`'unsafe-inline'` が無効化されてアプリ本体のインラインスクリプトがブロックされる（2026-07 に本番全損の実績あり）。
- 厳格な `script-src` を使いたい場合は、先に Cloudflare ダッシュボードで該当サイトの Web Analytics（RUM 自動セットアップ）を無効化すること。
- **npm audit の既知の警告（許容済み）**: `wrangler → miniflare → sharp` の high 3件（libvips CVE）は開発ツール内のみで、本番の Worker/配信物には含まれない。miniflare が sharp 0.35 系に更新されたら `npm update wrangler` で解消すること（2026-07 時点で修正版なし）。
- **AIクローラー対策**: robots.txt（助言）と Worker の UA ブロック（強制・`src/worker.js` の `AI_BOT_UA`）の二段構え。新しいAIボットが現れたら両方に追記する。
- 保育所待機児童数は都県で公表時期が異なるため基準年度が混在する（神奈川=令和8年4月1日、他は大半が令和7年4月1日）。毎年8〜9月に各都県の新年度値が出揃ったら更新する。
