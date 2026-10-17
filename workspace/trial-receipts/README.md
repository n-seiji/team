# 領収書トライアル — 画面（T6）

スマホのブラウザで領収書を撮り、4項目（日付・金額・支払先・カテゴリ）を確認・修正する画面。ビルド不要、依存なし。

## 動かし方
```
node serve.mjs 8080          # web/ を配る
node --test test/*.test.mjs  # ロジックのテスト
```
- モックで見る: `http://localhost:8080/?mock=1`（スマホからは `http://<PCのIP>:8080/?mock=1`）
- 縮小の比較（受け入れテスト用）: `?maxside=0` で縮小せずに送る。`?maxside=3000` のように上限も変えられる（既定 2000、500 未満や数字以外は既定に戻す）
- 実 API に向ける: `?api=http://<API のホスト>:<ポート>`（省略時は同じオリジンの `/receipts`）
- 実 API につながらないときは自動でモックになり、画面上部に黄色の「デモ表示」バナーが出る。
- LAN の http でも動く（`input[capture]` を使うので HTTPS 必須ではない）。外部公開するなら HTTPS にすること。

## 受け入れテストの始め方（テスト機）
1. テスト機で `READER=tesseract node src/server.mjs` を起動し（起動ログに「読み取り: tesseract（ローカル）」と出ることを確かめる）、テスト機のブラウザで `http://localhost:3000/start` を開く。LAN の URL の QR と、同じ URL が大きな字で出る（QR は依存なしの `web/qr.js` で作る）。
2. スマホはテスト機と同じ Wi-Fi（端末同士がつながるもの）か、テスト機のテザリングにつなぐ。
3. URL が違うとき（テザリングなど）は `http://localhost:3000/start?url=http://192.168.43.1:3000/` のように指定できる。

ユーザー向けの手順（`/start` にも同じ文を出す。3行）:
1. スマホのカメラでこの QR を読み、出てきたリンクを開く（読めないときは上の URL を入力）
2. 「📷 撮影」を押して領収書を撮り、「写真を使用」（Android は ✓）を押す
3. 一覧に1行増えたら登録完了。⚠ の欄は写真を見て直す

## 画面の約束
- 撮影は `input[type=file][capture=environment]`（OS 標準カメラ）。アプリ側のタップは「撮影」1回。撮影後は一覧に行が足されるだけで、画面は切り替わらない。
- 送信前に長辺 2000px へ縮小（JPEG 0.92）。薄い感熱紙で字が潰れないかは実物で未確認。潰れたら縮小をやめる/上げる。
- 要確認は 色＋⚠アイコン＋文言（例「要確認：金額が薄くて読めません」）。直して保存すると消える。
- 一覧上部の「要確認 ○件」は API の全体 `needs_review_count`。「要確認だけ見る」ボタンで絞り込んでも変わらない。
- 0件のときは「領収書を撮ると、ここに表ができます」と大きな撮影ボタンだけ。
- 読み取りは1枚ずつ順番。待っている行は「順番待ち（前に○枚）」、読んでいる行は「読み取り中…」。待っている間も空欄に手で入れられ、直した欄は読み取り結果で上書きされない（⚠ は読み取りが終わってから出す）。待ちがある間、先頭は「要確認 0件（読み取り待ち ○枚）」で、「すべて確認済み」とは言わない。
- 字の大きさ: 項目名・入力欄・⚠ の文言は 16px 以上（老眼でも拡大せずに読める大きさ）。
- 「🖨 印刷（先生に渡す表）」: 表示中の月を、日付・金額・支払先・カテゴリ・要確認の5列と合計だけの紙にする（`@media print`、A4）。id や `/receipts/…` は出さない。未確認があれば「⚠ 未確認が○件あり、合計は確定ではありません」も印刷される。Ctrl+P でも同じ紙になる。
- 並び順: 日付がまだない行（撮ったばかり・読み取り中・失敗）を先頭に新しい順。その下は API の日付順。
- 読み取りに失敗した行も、空欄の4項目を出して写真を見ながら入力できる（「要確認：読み取れませんでした。写真を見て金額を入力してください」）。4項目とも直すと要確認から外れる。`status` は記録として failed のまま残る。
- 月の表: 「表示する月」で月を選ぶと、その月の行と「2026年10月の合計 12,345円」が出る。未確認があれば「（未確認が○件あり、合計は確定ではありません）」を併記。日付のない領収書は月の表に入らないので、その枚数を案内する。
- 「CSV を保存」は `GET /export.csv?month=` へのリンク。デモ表示（モック）では出さない（見本データを本物の表として保存させないため）。

## API（eng-backend と合意済み。実装は `src/server.mjs`）
| 操作 | 形 |
|---|---|
| `POST /receipts` | body は画像のバイト列そのもの（`Content-Type: image/jpeg` など）。すぐ `{id, status:"queued", queue_position}` |
| `GET /receipts?month=YYYY-MM` | `{receipts:[{id,status,fields,edited,image_url}], needs_review_count, total, total_note, undated_count}`。`needs_review_count` は月に関係なく全体の枚数。`fields.{date,amount,payee,category}` は `{value,confidence,needs_review,reason}` |
| `GET /export.csv?month=YYYY-MM` | BOM 付き UTF-8 の CSV |
| `PATCH /receipts/:id` | `{ "amount": "1200" }`（直す項目だけ）。更新後の領収書を返す |
| `GET /receipts/:id/image` | 元の写真 |
| `GET /api/info` | `{urls:["http://192.168.x.x:3000/"], reader}`。`/start` の QR 用 |
- 読み取りは1件ずつ順番。`status` は queued → reading → done / failed。queued の行には `queue_position`（前に何枚あるか。読み取り中の1枚を含む）が付く。
- queued / reading の間も `PATCH` できる。直した欄には `edited:true` が付き、あとから届いた読み取り結果で上書きされない。
- `reason` は述語の形（「薄くて読めません」「不正な形式です」）。「未読み取り」だけは画面側で文にする。
- エラーは `{error: "理由"}` を日本語で。

## サーバーと読み取りアダプタ（T4・T5・T7）
```
node src/server.mjs                    # 読み取りなし（全項目を要確認で返す）
READER=tesseract node src/server.mjs   # ローカルの tesseract で読む（受け入れテスト機）
```
起動すると、スマホで開く LAN の URL が表示される。
```
読み取り: tesseract（ローカル）
写真の保存先: …/data/images（このマシンの外には送りません）
スマホで開く URL:
  http://192.168.x.x:3000/
```
- 受け入れテストは、端末同士がつながる Wi-Fi か、テスト機のテザリングで行う（会議室・カフェの Wi-Fi はクライアント分離で開けないことがある）。
- 保存: 画像は `data/images/<id>.<ext>`、記録は `data/records/<id>.json`。DB なし。`data/` と `samples/` は `.gitignore` 済み。
- 外部 API には画像を送らない。`src/` に外へ通信するコードはない（tesseract はこのマシンの CLI を `child_process` で呼ぶ）。
- 読み取りエンジンは `createApp({ reader })` で差し替える。`reader(buffer, {id})` は `{date, amount, payee, category}` を返し、各項目は `{value, confidence, reason?}`。
- 要確認の規則は `src/reader.mjs` の `normalize()` にあり、エンジンに依存しない。空欄、確からしさ 0.8 未満、日付・金額の形式 NG、カテゴリが5候補外（→「その他」）は要確認。推測で埋めない。

### tesseract（T5）
- 入れ方（Ubuntu）: `sudo apt-get install tesseract-ocr tesseract-ocr-jpn`。`READER=tesseract` でも tesseract か jpn がなければ、警告を出して読み取りなしに戻る。
- `src/tesseract.mjs`: 確からしさは、その行の単語の conf の最小値。金額は「合計・お買上・領収金額・運賃」などの行の金額だけを見る（小計・税・お預り・お釣りは見ない）。候補が食い違う、`1,2O0` や `1.500` のような形は空欄＋要確認。日付は西暦と令和。カテゴリはキーワードで1つに決まるときだけ。
- HEIC は読めない（failed になり、写真を見て入力する）。画面は送信前に JPEG へ縮小するので、通常は届かない。
- サンプルの一覧: `samples/` に画像と `answers.json`（正解。コミットしない）を置いて、`READER=tesseract node scripts/sample-report.mjs` を実行する。
  - `answers.json` の形: `{"cafe-1.jpg": {"kind": "カフェ", "date": "2026-10-03", "amount": 480}}`
  - 出るもの: 画像ごとの4項目と秒数、金額・日付の「通過（要確認なしで正解）／誤読（要確認なしで不正解）／要確認」の件数と母数、kind ごとの行。％は出さない。
- 実サンプルでの結果はまだない（受け入れテストで撮ってから測る）。

## 未確認・既知の制限
- ヘッドレス Chromium（スマホ幅 390px）で、空状態・3枚続けて撮る・順番待ち・直す・月の表・印刷（PDF）まで確認した。実機（iOS Safari / Android Chrome）でカメラが開くかは T7 の受け入れテストで確かめる。
- 実 API には `node src/server.mjs` → `http://<IP>:3000/` で同じオリジンからつながる（スモーク確認済み）。
