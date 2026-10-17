# 立て替え精算（trial-kakeibo）

家庭内の「立て替え」を記録し、「誰が誰にいくら渡せば終わるか」を出す。仕事の分は精算に含めない。
実行時依存なし（Node.js 22 以上、`node:http` と JSON ファイル保存のみ）。

## 動かし方

```sh
# 1. メンバーは API（POST /members）で追加・改名できる。初回だけ config/members.json が初期値になり、以後は data/members.json が優先される
# 2. 起動
npm start            # http://localhost:3000   PORT / DATA_FILE / MEMBERS_FILE / MEMBERS_DATA_FILE で変更可
# 3. テスト
npm test
```

保存先は `data/ledger.json`（git 管理外）。書き込みは一時ファイル→rename なので途中で落ちても壊れない。
複数端末の同時編集は未対応（1プロセス・1ファイル前提）。静的ファイルは `web/` から配信（`/` は `index.html`）。

## ルール

- 区分: `home`（家庭）/ `work`（仕事）。精算の対象は「家庭・未削除・未精算」だけ。
- 割り勘: 円単位で均等割り。余りは負担者をID昇順に並べた先頭から1円ずつ。例: 3人で1,000円 → 334/333/333。
- 精算の最小回数: 収支が0でない人が6人以下なら全探索で厳密な最小。7人以上は貪欲法で `approximate: true`。
- 削除は論理削除（`deleted: true`、履歴に残る）。修正は `revisions` が増える。
- 精算済みの記録は修正・削除できない（先に印を取り消す）。仕事の記録に精算済みは付けられない。

## API

エラーは `{ "error": { "code", "message" } }`（message は日本語でそのまま表示できる）。

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/members` | `{ members: [{id,name}] }`（0人なら空配列） |
| POST | `/members` | `{ name }` で追加。`{ member: {id,name} }`。id はサーバーが `m1`,`m2`… と採番し不変。空・31文字以上・重複（大文字小文字無視）は拒否 |
| PATCH | `/members/:id` | `{ name }` で改名。記録は id で持つので精算結果は変わらない。メンバー削除はない |
| GET | `/entries` | `{ entries, lastCategory, lastPayerId }` 新しい日付順。前回値は直近に作った未削除の記録から（なければ null） |
| POST | `/entries` | 必須は `amount`（整数円）と `payerId`。省略時: `participantIds`=全員、`date`=今日、`category`=前回の区分（なければ home）、`memo`=空 |
| PATCH | `/entries/:id` | 上記の項目を部分更新 |
| DELETE | `/entries/:id` | 論理削除 |
| PUT / DELETE | `/entries/:id/settled` | 精算済みの印を付ける / 取り消す |
| POST | `/settle` | 「精算しました」: 未精算の家庭分を一括で精算済みに。`{ batchId, settledCount }` |
| POST | `/settle/undo` | 直前の一括精算を取り消す。`{ batchId, restoredCount }` |
| GET | `/settlement` | `{ transfers:[{from,to,amount}], balances, undoable, approximate, entryCount, total }`。`undoable` は「直前の一括精算を取り消せるか」（再起動後も保持） |

entry の項目: `id date amount payerId participantIds memo category deleted deletedAt settled settledAt revisions createdAt updatedAt`

## curl の例

実サーバー（`PORT=3947 npm start`）で実行して通ったものだけを載せている。

```sh
B=http://localhost:3947
# 記録の追加（家庭・全員で割る・今日）
curl -s -X POST $B/entries -H 'content-type: application/json' -d '{"amount":3000,"payerId":"kenta","memo":"食材"}'
# 精算結果を見る（誰が誰にいくら）
curl -s $B/settlement
# 精算しました（未精算の家庭分を一括で精算済みに）
curl -s -X POST $B/settle
# 取り消し（直前の一括分を元に戻す。なければ 409 nothing_to_undo）
curl -s -X POST $B/settle/undo
# メンバー追加
curl -s -X POST $B/members -H 'content-type: application/json' -d '{"name":"花子"}'
```

例（メンバー kenta, mika, 花子の3人で 3,000 円）: `/settlement` は
`{"transfers":[{"from":"m1","to":"kenta","amount":1000},{"from":"mika","to":"kenta","amount":1000}],...,"undoable":false,...}`、
`/settle` は `{"batchId":1,"settledCount":1}`、`/settle/undo` は `{"batchId":1,"restoredCount":1}`。
金額 0 の記録は `{"error":{"code":"amount_not_positive","message":"金額は1円以上で入力してください。"}}`。

## ファイル

- `src/split.js` 割り勘 / `src/settle.js` 収支と最小回数 / `src/ledger.js` 記録の操作とルール
- `src/store.js` JSON 保存 / `src/members.js` メンバー名簿 / `src/server.js` HTTP / `test/` node:test
