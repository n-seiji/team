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
- 並び順: 日付がまだない行（撮ったばかり・読み取り中・失敗）を先頭に新しい順。その下は API の日付順。
- 読み取りに失敗した行も、空欄の4項目を出して写真を見ながら入力できる（「要確認：読み取れませんでした。写真を見て金額を入力してください」）。4項目とも直すと要確認から外れる。`status` は記録として failed のまま残る。
- 月の表: 「表示する月」で月を選ぶと、その月の行と「2026年10月の合計 12,345円」が出る。未確認があれば「（未確認が○件あり、合計は確定ではありません）」を併記。日付のない領収書は月の表に入らないので、その枚数を案内する。
- 「CSV を保存」は `GET /export.csv?month=` へのリンク。デモ表示（モック）では出さない（見本データを本物の表として保存させないため）。

## API（eng-backend と合意済み。実装は `src/server.mjs`）
| 操作 | 形 |
|---|---|
| `POST /receipts` | body は画像のバイト列そのもの（`Content-Type: image/jpeg` など）。すぐ `{id, status}` |
| `GET /receipts?month=YYYY-MM` | `{receipts:[{id,status,fields,edited,image_url}], needs_review_count, total, total_note, undated_count}`。`needs_review_count` は月に関係なく全体の枚数。`fields.{date,amount,payee,category}` は `{value,confidence,needs_review,reason}` |
| `GET /export.csv?month=YYYY-MM` | BOM 付き UTF-8 の CSV |
| `PATCH /receipts/:id` | `{ "amount": "1200" }`（直す項目だけ）。更新後の領収書を返す |
| `GET /receipts/:id/image` | 元の写真 |
- `reason` は述語の形（「薄くて読めません」「不正な形式です」）。「未読み取り」だけは画面側で文にする。
- エラーは `{error: "理由"}` を日本語で。

## サーバーと読み取りアダプタ（T4・T5）
```
node src/server.mjs          # API と web/ を http://<IP>:3000/ で配る。データは data/ に保存
```
- 保存: 画像は `data/images/<id>.<ext>`、記録は `data/records/<id>.json`。DB なし。
- 読み取りエンジンは `createApp({ reader })` で差し替える。`reader(buffer, {id})` は `{date, amount, payee, category}` を返し、各項目は `{value, confidence, reason?}`。
- 要確認の規則は `src/reader.mjs` の `normalize()` にあり、エンジンに依存しない。空欄、確からしさ 0.8 未満、日付・金額の形式 NG、カテゴリが5候補外（→「その他」）は要確認。推測で埋めない。
- 今のエンジンは `nullReader`（全項目を空欄＋要確認「未読み取り」）。ローカル OCR の試行と実測はまだしていない（本物のサンプル5枚と tesseract の導入許可待ち）。精度の数字は測るまで書かない。
- 外部 API には画像を送らない。

## 未確認・既知の制限
- 実ブラウザ（iOS Safari / Android Chrome）での動作はまだ確認していない。ここで確認できたのはロジックのテストのみ。
- 実 API には `node src/server.mjs` → `http://<IP>:3000/` で同じオリジンからつながる（スモーク確認済み）。
