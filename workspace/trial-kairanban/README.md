# 回覧板 (kairanban)

町内会の回覧板を、紙の世帯もデジタルの世帯も同じ記録で追えるようにする。核は「今どの家で止まっているか」が探し歩かずに分かること。
依存なし。Node.js >= 22.18 だけで動く(TypeScript は Node がそのまま実行する)。

## 動かし方
```
node src/gen-roster.ts > data/roster.json   # 名簿(架空の8班x15軒=120世帯)。生成済み
node src/demo.ts                            # 見本データ(任意。data/events.jsonl を作り直す)
node src/server.ts                          # http://localhost:3000/ (PORT, KAIRAN_DATA で変更可)
node --test "test/*.test.ts"                # テスト
```
保存は `data/events.jsonl` への追記のみ(回覧の作成と状態の記録)。現在地・日数はこのログから毎回計算する。消すと初期状態に戻る。
`web/` の静的ファイルを `/` から配信する(画面は T2)。

## 決まりごと
- 状態: `未着` `受取済` `次へ渡した` `不在で保留`。参加方法: `paper` / `digital`。どちらも同じ API・同じ状態。
- 現在地 = 班の順番で最初の「次へ渡した」でない家。「不在で保留」は飛ばさず現在地のまま。
- 留まり日数 = 前の家が「次へ渡した」と記録した日から(先頭の家は回覧の作成日から)。**記録ベースなので、記録忘れがあると狂う。** 画面は「記録から◯日」と出すこと。
- 3日以上で `stale: true`。現在地が `未着` のまま3日以上なら `receiptMissing: true`(「受取の記録なし」表示用)。
- 完了 = 全家が `受取済` か `次へ渡した`。回覧全体の `completed` と、班ごとの `done` / `completedCount` / `total`。
- 認証は作らない。班ごとの合言葉 + 班長名(選択式)。名簿 `data/roster.json` の `groups[].leaders` と `passphrase`。会長は `admin`(全班の記録と回覧作成ができる)。合言葉は API で返さない。デモ用の値: 会長 `石田 正雄`/`kaichou`、1班 `青木 誠`/`hanchou-1`(n班は `hanchou-n`)。実運用前に必ず変える。

## API (JSON)
| | |
|---|---|
| `GET /api/groups` | 班と班長名の一覧(合言葉なし) |
| `GET /api/circulars` | 回覧一覧 `{id,title,importance,createdAt,completed,doneGroups,groupCount}` |
| `POST /api/circulars` | 作成(会長) `{title, importance:"通常"\|"重要", by, passphrase, order?:{g1:[家ID…]}}`。`order` 省略時は名簿順 |
| `GET /api/circulars/:id` | 班ごとの現在地(下記) |
| `POST /api/circulars/:id/records` | 記録 `{houseId, status, by, passphrase}` → 更新後の `GET /api/circulars/:id` と同じ形を返す |
| `GET /api/circulars/:id/history?houseId=` | 記録の履歴 `{houseId,status,at,by}` |

エラーは `{"error":"…"}` で、400(入力不正) / 403(合言葉・記録者違い) / 404。

`GET /api/circulars/:id` の例(抜粋):
```json
{ "id":"c1", "title":"秋の清掃活動と防災訓練のお知らせ", "importance":"重要", "completed":false,
  "groups":[ { "group":"g3", "groupName":"3班", "leaders":["森田 剛"],
    "current":{"id":"g3-05","name":"木村家(進)","mode":"paper"},
    "status":"不在で保留", "stayingSince":"2026-10-08T…Z", "stayDays":5, "stale":true,
    "holdSince":"2026-10-12T…Z", "holdDays":5, "receiptMissing":false,
    "completedCount":4, "total":15, "done":false,
    "houses":[ {"id":"g3-01","name":"…","mode":"digital","status":"次へ渡した","recordedAt":"…","recordedBy":"森田 剛"}, … ] } ] }
```
`done: true` の班は `stayDays`/`stale` を使わず「完了」と表示すること。

## 未対応(次回以降)
保留が長引いた時の迂回、記録の取り消し(今は上書き記録で訂正し、履歴は残る)、訂正の配信、通知。

## 画面 (web/) の構成
- `web/adapt.js`: 実 API(日本語の状態・`g1` 形式の ID)を画面内部の形に変換する層。契約が変わったらここだけ直す。
- `web/logic.js`: 3日以上の判定・文言・並び順。`web/app.js`: DOM と通信。
- テスト: `node --test test/*.test.mjs`(画面ロジックと変換層)。`mock/server.mjs` は旧契約の代用 API で、実 API が揃った今は使わない。
