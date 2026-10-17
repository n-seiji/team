# 閉店後の在庫チェック・発注

iPad の Safari で動く静的 Web アプリ(ビルド不要、データは localStorage)。

## 動かす
`python3 -m http.server 8000` で配信し、`http://localhost:8000/#/check` を開く。
ES モジュールなので `file://` では動かない。iPad では https の静的ホスティング(GitHub Pages)で開く。

## 画面
- `#/check` 在庫チェック(蓮さん向け)。上部に、直近の記録のあと彩さんが発注したか(「この記録のあと、彩さんが 10/17 19:30 に発注しました」/「まだ発注されていません」)を出す。数える品目は数字をタップして直接入れられる(+/- も使える)。
- `#/order` 発注(彩さん向け)。「文面をコピー」「読み上げ用の一覧を出す」の後、「発注した」が成功するまで「送ったら『発注した』を押してください」を出す。

## テスト
`npm test`(中身は `node --test test/*.test.js`)

## GitHub Pages に置く
1. このフォルダ(`index.html` がある階層)をリポジトリのルートか `docs/` に置く。
2. リポジトリの Settings → Pages で、そのブランチとフォルダを選ぶ。
3. `https://<ユーザー名>.github.io/<リポジトリ名>/#/check` を iPad の Safari で開く。
   ホーム画面に追加しておくと、閉店後にすぐ開ける。

注意: データは開いた URL(オリジン)ごとに localStorage に残る。URL を変えると記録は引き継がれない。プライベートブラウズでは保存が失敗し、「記録できませんでした」が出る。

## お店の iPad で確かめること(初回)
Chromium では確認済み。Safari の実機でしか分からないことを、初回に見る。
- [ ] `#/check`: +/- と4段階のボタンが指で押しやすいか。最後の品目が下のバーに隠れないか。
- [ ] `#/check`: 「記録する」→「記録しました」。Safari を閉じて開き直しても、名前と「前回: …」が残るか。
- [ ] `#/order`: 発注量の欄で数字キーボードが出るか(`inputmode="numeric"`)。
- [ ] `#/check`: 数える品目の数字をタップしたとき、数字キーボードが出るか。濡れた指でも押せるか。
- [ ] 発注した後に `#/check` を開くと「この記録のあと、彩さんが … に発注しました」が出るか。時刻が iPad の時計と合っているか。
- [ ] `#/order`: LINE の業者で「文面をコピー」→ LINE に貼れるか。だめなら、選択済みの欄を長押ししてコピーできるか。
- [ ] `#/order`: 「発注した」→「○○に発注しました」。最後に頼んだ日と量が「今日・○個」になるか。

## 品目と業者を変える
`js/store.js` の `SUPPLIERS` と `ITEMS` を書き換える。
- 業者: `{ id, name, channel: 'line' | 'phone' }`
- 品目: `{ id, name, unit, kind: 'count' | 'level', supplierId }`
- 使い始めた後は、品目の `id` を変えない。過去の在庫・発注記録は `id` でつながっている。名前と単位は変えてよい。
- 今の中身は彩さんの一覧(2026-10-17)どおり: 北村商店(電話)6、八百屋 みどり商店(LINE)7、森田たまご(LINE)3 の計16品目。
  玉ねぎ・じゃがいも・にんじんの発注単位「箱」は仮置き(彩さんに要確認)。
- 仮データの頃の記録(レタス、「食材卸 まるい」など)が残った iPad では、その記録は画面に出ないだけで消えない。

## 保存層の API(`js/store.js` の `createStore(storage, now)`)
- `recordStocks({ entries, recorder })` / `recordOrders({ entries, supplierId })`: 一括保存。1件でも不正なら全件失敗。
- `latestStock(id)` / `lastOrder(id)` / `recentOrder(id, 2)` / `history(id)`
- `orderedAfter(stockAt)`: 在庫記録の日時より後の、最初の発注の日時(ISO 文字列)。業者は問わない。なければ `null`。

## iPad サイズでの画面確認(任意)

`npm test` には入れていません。Playwright が必要です。

```sh
python3 -m http.server 8765 &        # workspace/trial-cafe で
CHROME_PATH=<chromium のパス> node tools/ipad-check.mjs http://localhost:8765 docs/screenshots
```

820×1180(iPad 相当)で `#/check` と `#/order` を操作し、44px 未満のタップ領域、保存、再読み込み、コピーと退避欄を確認します。スクショは `docs/screenshots/` に出ます。Chromium での確認なので、iPad Safari の実機確認は別に要ります。
