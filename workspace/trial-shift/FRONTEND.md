# 画面(public/)

ビルドなし・依存0。田中さんのサーバーが `public/` を静的配信する。

- `index.html` + `staff.js` … スタッフ用の希望提出(スマホ360px想定)
- `owner.html` + `owner.js` … オーナー用シフト作成(合言葉は `X-Owner-Pass` ヘッダ)
- `common.js` / `shift-logic.js` … 日付・API・純関数(`node --test test/frontend.test.mjs`)
- `mock/server.mjs` … 画面確認用モック。`node mock/server.mjs` → http://localhost:8787/ と `/owner.html`(合言葉 `test`)。`FAIL=1` で提出失敗の表示を確認できる。

## 画面が前提にしている API の形(田中さんと要確認)
- `PUT /api/staff/:id/requests?month=` 本文 `{days:{"2026-11-07":{available:true|false,note?:string}(未選択の日は送らない。サーバーは null を 400 にする)}}` → `{receivedAt}`
- `GET /api/staff/:id/requests?month=` → `{submitted, submittedAt, days}`
- `GET /api/owner/requests?month=` → `{month, staff:[{id,name,submittedAt,days}]}(時給・上限は含まれない。calc がサーバー側で引く)`
- `POST /api/calc` 本文 `{month, shifts:[{date,staffId,start,end}], revenue, targetRate}` → `{totalCost, rate, targetRate, diffPoints, overLimit:[{staffId,name,weekStart,hours,limit}]}`
- 合言葉違いは 401 か 403

## 今回の制約
- 組んだシフトはサーバーに保存しない(API 対象外)。ブラウザの localStorage に月ごとの下書きとして残る。
- 名前選択のみのため、API を直接叩けば他人の希望が読める(画面には出さない)。
