# trial-receipts バックエンド

領収書の画像を保存し、日付・金額・支払先・カテゴリを読み取って月の表とCSVにする。Node.js 22 以上、依存なし、DBなし。

## 動かし方
```
node src/server.mjs        # PORT=3000 既定。public/ があれば静的配信（フロント用）
node --test test/*.test.mjs
```
データは `data/images/<id>.<ext>`（画像1枚1ファイル）と `data/records/<id>.json`（1対1）。環境変数なしで `data/` に保存される。

## API
| | |
|---|---|
| `POST /receipts` | body=画像バイト、`Content-Type: image/jpeg\|png\|webp\|heic`。読み取りを待たず 201 で `{id, status:"reading", ...}`。10MB超は 413＋理由 |
| `GET /receipts/:id` | 1件。`status` は reading / done / failed |
| `GET /receipts?month=YYYY-MM` | `{rows, total, unconfirmed_count, total_note, needs_review_count, undated_count}`。月省略で全件。rows は日付順、日付なしは末尾 |
| `PATCH /receipts/:id` | `{date?, amount?, vendor?, category?}`。直した項目は要確認が消え `edited:true`。不正値は 400＋理由。reading 中は 409 |
| `GET /receipts/:id/image` | 元の写真 |
| `GET /export.csv?month=YYYY-MM` | UTF-8 BOM 付き CSV（日付,金額,支払先,カテゴリ,要確認,id,画像） |

項目は `{value, confidence, needs_review, reason}`。`needs_review_count` は月に関係なく全体の件数（読み取り中・失敗の行も含む）。`total_note` は未確認があるときだけ「未確認が○件あり、合計は確定ではありません」。日付が空の行は月指定の表に入らず、`undated_count` で数える。

## 要確認の規則（`src/reader.mjs`、エンジンに依存しない）
空欄／確からしさ 0.8 未満／日付 YYYY-MM-DD でない・実在しない日／金額が正の整数でない／カテゴリが固定5候補（交通費・会議費・消耗品費・通信費・その他）外 → 要確認。カテゴリは空・不明なら「その他」＋要確認。推測で値を埋めない。

## 読み取りエンジンの差し替え
`createApp({reader})` に `async (imageBuffer, meta) => ({date, amount, vendor, category})` を渡す。各値は `{value, confidence(0-1), reason?}`。検証と要確認の判定は normalize() が行うので、API・保存形式・画面は変わらない。既定は全項目を空欄＋要確認「未読み取り」で返す `nullReader`。外部APIには画像を送らない。

## 未実施
ローカルOCRの試行と精度の報告（T5の一部）。実サンプル画像が未着で、OCR未導入のため。実測するまで精度の数字は書かない。
