# trial-shift — シフト希望の回収と人件費・週上限チェック(API)

依存 0。Node.js 22 以上の標準ライブラリだけで動きます。

## 動かし方

```
OWNER_PASSPHRASE=ひみつ node server.js      # http://localhost:3000
npm test                                    # 21 ケース
```

環境変数: `OWNER_PASSPHRASE`(必須・オーナー用の合言葉)、`PORT`(既定 3000)、`DATA_FILE`(既定 `data/shift.json`)。
`public/` を静的配信します(`/` は `public/index.html`)。ビルド工程はありません。

## 保存

JSON ファイル。更新ごとに `shift.json.tmp` へ書いてから rename します。書き込みに失敗したら API は 500 を返し、メモリ上もファイルも旧データのままです(=受付済みにならない)。再起動してもスタッフと希望は残ります。同時起動(プロセスを2つ)は想定していません。

## API

エラーは常に `{ "error": "メッセージ" }`。`month` は `YYYY-MM`、日付は `YYYY-MM-DD`、時刻は同じ日の `HH:MM`。

### スタッフ用(認証なし)

| | |
|---|---|
| `GET /api/staff` | `[{id, name}]`。時給・週上限は含まない |
| `GET /api/staff/:id/requests?month=` | 未提出でも 200: `{submitted:false, submittedAt:null, days:{}}` / 提出済み: `{submitted:true, submittedAt, days}` |
| `PUT /api/staff/:id/requests?month=` | body `{days:{"2026-11-03":{available:true, note:"17時まで"}}}`。成功: `{receivedAt:"2026-10-25T12:04:00+09:00"}`。`note` は任意(200文字まで)。再提出は全置換 |

画面の「受け付けました(○月○日 ○時○分)」は `receivedAt` だけで作ってください。200 以外(または `receivedAt` なし)は受付表示を出さないこと。

### オーナー用(ヘッダ `x-owner-pass: <合言葉>` 必須。違えば 401)

| | |
|---|---|
| `GET /api/owner/staff` | `[{id, name, wage, weeklyLimit}]`(`weeklyLimit` 未設定は null) |
| `POST /api/owner/staff` | `{name, wage, weeklyLimit?}` → 作成したスタッフ |
| `PUT /api/owner/staff/:id` | 変更するキーだけ。`weeklyLimit:null` で上限なしに戻す |
| `GET /api/owner/requests?month=` | `{month, staff:[{id, name, submittedAt|null, days}]}`。全スタッフを返し、未提出は `submittedAt:null, days:{}`。メモ含む |
| `POST /api/calc` | 下記 |

### POST /api/calc

```json
{
  "month": "2026-11",
  "revenue": 500000,
  "targetRate": 0.3,
  "shifts": [{"date":"2026-11-02","staffId":"s1","start":"09:00","end":"15:00"}],
  "carryIn": {"s1": 12}
}
```

- `revenue` 必須(>0)。`targetRate` 省略時 0.3。`carryIn` 省略可(`{staffId: 時間}`)。時給と週上限は保存済みスタッフから引く。
- 応答:

```json
{
  "totalCost": 6600, "revenue": 500000,
  "rate": 0.0132, "targetRate": 0.3, "diffPoints": -28.7,
  "weekly":    [{"staffId":"s1","name":"陳 美玲","weekStart":"2026-11-02","hours":6,"limit":28}],
  "overLimit": [{"staffId":"s1","name":"陳 美玲","weekStart":"2026-11-02","hours":29,"limit":28}]
}
```

- `rate` は 0〜1 の割合(小数4桁)、`diffPoints` は `(rate - targetRate)×100` を小数1桁で(正なら目標超え)。
- 人件費は分単位で `時給×分/60` を足し、合計の最後に1回だけ円に丸める。
- 週は月曜始まり。`weekStart` は月曜の日付(月初の週は前月の日付になりうる)。`overLimit` は **合計が上限を超えたとき**(ちょうど上限は超過ではない)。上限未設定の人は `weekly` に出るが `overLimit` には出ない。
- `carryIn` は月初の週(1日を含む週)に加算する。省略は 0。画面には「月初の週は前月分を含まない」と出すこと。
- 日またぎ(終了≤開始)、休憩控除なし。月外の日付・存在しない日付・不明スタッフは 400。

## 既知のリスク(判断済み)

- **ログインなし**: 名前を選ぶだけなので、`/api/staff/:id/requests` を直接叩けば他人の希望(メモ含む)が読める。9人の店なら許容する、と PM が判断。画面上は他人の希望を出さない。時給・週上限はスタッフ用 API に出さない。
- 合言葉は平文のヘッダ。HTTPS 終端は別途(店内 LAN か、リバースプロキシ配下で使う)。
- 日またぎ・休憩控除は未対応。
