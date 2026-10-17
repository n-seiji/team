# 回覧板アプリ (trial-kairanban)

町内会の回覧板をスマホで回し、誰が読んだかを班長が見られる Web アプリ。実行時依存は 0(Node 標準ライブラリのみ)。

## 必要なもの
- **Node.js 22.18 以上**(`node:sqlite` と TypeScript の直接実行を使うため)。`node -v` で確認。

## 動かし方
```
PUBLIC_URL=https://kairan.example.jp ADMIN_KEY=ひみつの合言葉 node src/main.ts
```
- **`PUBLIC_URL`**(必須)は、住民のリンクと QR に焼く URL の頭。外から開けるドメインを入れる(手元で試すなら `http://localhost:3000`)。未設定・`http(s)://` で始まらないと起動しない。**一度 QR を配ったら変えない**(変えると紙が全部使えなくなる)。
- **管理キー**は環境変数 `ADMIN_KEY` で渡す。未設定だと起動しない。班長用 API はこのキーを `X-Admin-Key` ヘッダーで受け取る(班長画面が入力欄から送る)。
- `PORT`(既定 3000)、`DB_PATH`(既定 `kairanban.db`)で変更できる。DB は 1 ファイル。コピーすればバックアップになる。
- 班長画面: `http://localhost:3000/admin` / 住民画面: `/r/<token>`(管理キー不要)
- 班長画面でできること: 回覧の登録（「＋ 回覧を登録」）、世帯の追加（「＋ 世帯を追加」、表示名だけ）、一覧・代理記録・リンクのコピー・「リンクを作り直す」。
- 画面の確認（開発時のみ、playwright と chrome が必要）: `docs/e2e-check.mjs`（住民・一覧）、`docs/e2e-t6.mjs`（登録・追加・作り直し）。どちらも新しい DB・ポート 3456 で起動してから実行する。
- QR の読み取り確認（開発時のみ）: `pnpm install`（jsqr が入る。開発用で、動かすだけなら不要）のあと、新しい DB・ポート 3457 で起動して `docs/qr-camera-check.mjs`。斜め・ぼかし・遠めの「写真」にした QR を読み、開いた先が住民画面かを見る。

## 本番で動かす（町内会の機械）
班長・役員向けの説明は `docs/運用のしかた.md`（A4 1枚）。機械係向けの手順はここ。
1. Raspberry Pi OS に Node 22.18 以上を入れ、ユーザー `kairan` の家にこのフォルダを置く。
2. `cp deploy/kairanban.env.example ~/kairanban.env` → `PUBLIC_URL` を町内会のドメインに書き換える。
3. 管理キーを作る: `node src/tool.ts key ~/kairanban.env`（4文字×3。ファイルは 600 になる）。
4. `sudo cp deploy/kairanban.service /etc/systemd/system/ && sudo systemctl enable --now kairanban`（電源が入ると自動で起動）。
5. 毎晩のバックアップ: `deploy/crontab.txt` の1行を `crontab -e` に入れる。`node src/tool.ts backup <DB> <保存先>` は動かしたままでも壊れないコピー（VACUUM INTO）を作り、14日分を残す。
6. 戻す: サーバーを止めて `node src/tool.ts restore <バックアップ> <DB>` → 起動。壊れたバックアップは戻さない。
- 手で試すときは `node --env-file=$HOME/kairanban.env src/main.ts` で同じ設定のまま起動できる。
- キーを変える: `node src/tool.ts key ~/kairanban.env` → `sudo systemctl restart kairanban`。古いキーは 401 になる。住民のリンクは変わらない。
- 未検証: systemd のユニット、cron、Cloudflare のトンネルとドメイン（実機と契約が要るため）。起動・キー変更・バックアップ・復元は、まっさらなコピーで手順どおりに試した。
- **公開の条件（紙を配る前に必ず）**: 本番の `PUBLIC_URL` で刷った紙を、実機のスマホ（森さんのスマホと、らくらくスマホ）の標準カメラで読み、住民画面が開いて「読みました」を押せることを確かめる。機種・QR の大きさ・手順・結果を記録する。読めなければ QR を大きくするか URL を短くして刷り直す。これが通るまで紙は配らない。iPhone Safari の印刷プレビューで1ページ1世帯になるかも見る。

## テスト
QR を読み取って確かめるテストは jsqr（開発用）を使う。`pnpm install` していなければ、そのテストだけ飛ばす。
```
node --test --disable-warning=ExperimentalWarning test/*.test.ts
```

## API
班長用(`X-Admin-Key` 必須。無い・違うと 401 `キーが違います。班長さんに確認してください`)
| メソッド | パス | 内容 |
|---|---|---|
| POST | `/api/circulars` `{title, body}` | 回覧を登録 |
| GET | `/api/circulars` | 回覧一覧 |
| POST | `/api/households` `{name}` | 世帯を登録(表示名だけ)。`{id,name,link}` を返す |
| GET | `/api/households` | 世帯とリンクの一覧 |
| GET | `/api/circulars/:id/status` | `{circular, readCount, total, households:[{id,name,status,readAt,link}]}` を1回で返す |
| POST | `/api/circulars/:cid/households/:hid/proxy-read` | 紙で読んだと代理記録 |
| GET | `/api/admin/circulars` | 画面用: `[{id,title}]` |
| GET | `/api/admin/circulars/:id` | 画面用: `{id,title,households:[{id,name,status,readAt,url}]}` |
| GET | `/api/admin/print` | 印刷用: `[{id,name,url,qrSvg}]`。`qrSvg` は `url` の QR（`viewBox` だけ、四方に白い余白つき）。作り直した世帯は新しい URL になる |
| POST | `/api/admin/circulars/:cid/households/:hid/proxy` | 画面用の代理記録(`proxy-read` と同じ動き) |
| POST | `/api/households/:id/reissue` | リンクを再発行(古いリンクは即無効) |

住民用(管理キー不要)
| メソッド | パス | 内容 |
|---|---|---|
| GET | `/api/r/:token` | `{household:{name}, circular:{id,title,body}\|null, status, readAt, unreadCount}`。**一番古い未読の回覧**を返す(全部読んでいれば最新)。`unreadCount` は表示中の回覧を除く未読の件数で、代理記録は未読に数えない。`?circular=<id>` で指定もできる。無効なら 404 `このリンクは使えません` |
| POST | `/api/r/:token/read` `{circularId}` | 「読みました」。何度送ってもよい。応答は GET と同じ形(`unreadCount` 入り)。「次を読む」は GET を呼び直す |

`status` は `unread`(未読) / `self`(本人が読んだ) / `proxy`(班長が代理記録)。`readAt` は ISO 8601 (UTC)。
`link` / `url` は `PUBLIC_URL` から作った完全な URL(例: `https://kairan.example.jp/r/<token>`)。画面はそのまま使う。

## 状態のルール
- 本人が2回押しても、最初の日時が残る。
- 代理記録のあとに本人が押すと `self` になり、日時は本人が押した時刻。
- 本人が読んだ世帯への代理記録は無視される(状態も日時も変わらない)。
- トークンは `randomBytes(24)`(192bit)の base64url。世帯の保存項目は表示名とトークンだけ(電話・住所・メールは持たない)。

## 画面のファイル
`public/resident.html`(住民、`/r/<token>` で返す)、`public/admin.html`(班長)。静的配信は `src/server.ts`。
`public/print.html`(QR の印刷。班長画面の「QRを印刷（全世帯）」から開く。「A4に1世帯」（最初の選択）か「A4に2世帯」（真ん中の切り取り線で切る。80世帯なら40枚）を選べる。どちらも QR の黒い部分は1辺6cm以上（1世帯 64mm・2世帯 62mm）。`GET /api/admin/print` を使う。`?sample=1` を付けると API の代わりに「見本」の四角で組む。配る紙には使わない)。

- 住民画面で「読みました」を押したあと、ほかに未読があれば「まだ読んでいない回覧があと○件あります」と「次を読む」が出る。「次を読む」は同じ `GET /api/r/<token>` を呼び直す。
- 実ブラウザでの確認（開発時のみ）: `docs/e2e-t6.mjs`、`docs/e2e-t8.mjs`（T8 と印刷ページ）、`docs/e2e-t14.mjs`（80世帯を入れて、1世帯／2世帯の PDF の枚数・文字の大きさ・QR の大きさを測る）。
