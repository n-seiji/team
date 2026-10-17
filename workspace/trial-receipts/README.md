# 領収書トライアル — 画面（T6）

スマホのブラウザで領収書を撮り、4項目（日付・金額・支払先・カテゴリ）を確認・修正する画面。ビルド不要、依存なし。

## 動かし方
```
node serve.mjs 8080          # web/ を配る
node --test test/*.test.mjs  # ロジックのテスト
```
- モックで見る: `http://localhost:8080/?mock=1`（スマホからは `http://<PCのIP>:8080/?mock=1`）
- 実 API に向ける: `?api=http://<API のホスト>:<ポート>`（省略時は同じオリジンの `/receipts`）
- 実 API につながらないときは自動でモックになり、画面上部に黄色の「デモ表示」バナーが出る。
- LAN の http でも動く（`input[capture]` を使うので HTTPS 必須ではない）。外部公開するなら HTTPS にすること。

## 画面の約束
- 撮影は `input[type=file][capture=environment]`（OS 標準カメラ）。アプリ側のタップは「撮影」1回。撮影後は一覧に行が足されるだけで、画面は切り替わらない。
- 送信前に長辺 2000px へ縮小（JPEG 0.92）。薄い感熱紙で字が潰れないかは実物で未確認。潰れたら縮小をやめる/上げる。
- 要確認は 色＋⚠アイコン＋文言（例「要確認：金額が薄くて読めません」）。直して保存すると消える。
- 一覧上部の「要確認 ○件」は API の全体 `needs_review_count`。「要確認だけ見る」ボタンで絞り込んでも変わらない。
- 0件のときは「領収書を撮ると、ここに表ができます」と大きな撮影ボタンだけ。

## API への期待（eng-backend と確認中）
| 操作 | 形 |
|---|---|
| `POST /receipts` | multipart の `image`。すぐ `{id, status}` |
| `GET /receipts` | `{receipts:[{id,status,fields,edited,image_url?}], needs_review_count}`。`fields.{date,amount,payee,category}` は `{value,confidence,needs_review,reason}` |
| `PATCH /receipts/:id` | `{ "amount": "1200" }`（直す項目だけ）。更新後の領収書を返す |
| `GET /receipts/:id/image` | 元の写真 |
- `reason` は述語の形（「薄くて読めません」「不正な形式です」）。「未読み取り」だけは画面側で文にする。
- エラーは `{error: "理由"}` を日本語で。

## 未確認・既知の制限
- 実ブラウザ（iOS Safari / Android Chrome）での動作はまだ確認していない。ここで確認できたのはロジックのテストのみ。
- 月での絞り込み、CSV ダウンロードは T2 側の画面が決まってから。
- 一覧の並び順は API の返す順をそのまま使う（モックは新しい順）。
