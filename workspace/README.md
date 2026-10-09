# invoice-cli（コア部分）

ターミナルから請求書を作る小さなツール。依存ゼロ（Node.js >= 22 の標準ライブラリのみ）。

## 動かし方
```
cd workspace
npm test        # node --test test/
```

## 使い方（CLI）
```
node src/main.ts init                       # 最初の1回(発行者名・インボイス番号)
node src/main.ts client add 山田商店 --withholding   # --honorific 様 も可
node src/main.ts new 山田商店 --month 2026-09 --format html \
  --item "顧問料:50000" --item "記帳代行:60000:源泉"   # --item 省略で対話
node src/main.ts list
```
`bin/invoice` でも同じ。データは `~/.invoice/data.json`(`INVOICE_HOME` で変更)、出力はカレントに `INV-0001.md|html`。
確認画面で `y` 以外(Enter含む)なら何も保存せず、番号も使いません。
`--item` は最後の2要素を金額・`源泉` として読むので、名称に「:」があっても使えます。
**明細は15行程度までが A4 1ページの目安**です(HTML は印刷用CSSで A4)。丸め規則は下の「金額の規則」を参照(暫定)。

## コア API（`src/core.js`）
| 関数 | 内容 |
|---|---|
| `openStore(dir)` | 保存先ディレクトリ（`data.json`）を指す |
| `initStore(store, {name, invoiceNumber})` | 発行者を1回設定。インボイス番号は `T`+13桁 |
| `addClient(store, {name, honorific='御中', withholding=false})` | クライアント登録 |
| `previewInvoice(store, {clientId, month, items})` | **番号なし・書き込みなし**。確認画面用 |
| `createInvoice(store, input, {date})` | 同じ計算に番号を付けて保存（確認で y のときだけ呼ぶ） |
| `listInvoices(store)` | 番号・日付・クライアント・対象月・金額 |

`items` は `{name, amount(整数円), withholding(bool)}` の配列。`clientId` は id か名前。

## 金額の規則（整数円）
- 消費税 = 小計 × 10%、**円未満切り捨て**
- 源泉徴収 = 「源泉対象」明細の合計（税抜）× 10.21%、**円未満切り捨て**。クライアントが源泉ありの場合のみ
- 請求額 = 小計 + 消費税 − 源泉徴収
- 例: 報酬10万円(源泉対象)+実費1万円 → 小計110,000 / 消費税11,000 / 源泉10,210 / 請求額110,790
- 切り捨てか切り上げかは**暫定**（山田さんの先生に確認待ち）。変更は `calcAmounts` 1か所。

## 採番
- `INV-0001` 形式。`data.json` の `lastSeq` を発行時にだけ +1 する（プレビューや失敗した発行では進まない）
- 保存は一時ファイルに書いて rename（途中で落ちても data.json は壊れない）
- 前提: 同時に複数プロセスで発行することは想定しない（個人利用）

## スナップショット
請求書には宛名・敬称・源泉有無・発行者名・インボイス番号を発行時点でコピーして保存。後から設定を変えても過去分は変わらない。
