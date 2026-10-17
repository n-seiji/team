# trial-tango (通学中の英単語 + 小テストの自動採点)

**公開 URL: まだありません** (GitHub Pages の公開用リポジトリは、持ち主の許可待ち。公開したらここに書く)
- 先生用: `<URL>/teacher.html` / 生徒の学習画面: `<URL>/index.html` / テスト: 先生が作ったリンク (`<URL>/test.html#…`)

## 先生向けの手順

1. **Google フォームを作る**: 質問を「結果コード」(記述式) の1問だけにして、送信用の URL を `teacher.html` の「Google フォームの URL」欄に貼ってからリンクを作る。
2. **集計画面に貼る**: フォームの「回答」→ スプレッドシートを開き、「タイムスタンプ」と「結果コード」の列を見出しごと選んでコピーし、「2. 結果コードを集計する」の欄に貼る。

- 一覧と CSV は「組→番号」の順。同じ組・番号が2回以上ある行は、両方残して黄色と「2回以上」で印を付ける。
- タイムスタンプの列ごと貼ると「提出時刻」の列が出て、同じ組・番号の中は先に出した順に並ぶ。どちらを成績にするかは先生が決める。コードだけを貼ったときは、一覧では列を出さず、CSV では空の列になる。
- 読めない行は「8行目: 結果コードが見つかりません」のように行番号つきで飛ばす。1行目にコードがなければ見出しとして黙って飛ばす。
- 生徒の名前は使わない。データはリンクと先生の端末の中だけにあり、このアプリはサーバーに送らない (Google フォームに載る分は学校のフォームの扱い)。

## 公開用のファイルを作る (GitHub Pages)

```
npm run dist     # dist/ に公開するファイルだけを集める (sw.js の FILES と同じもの + .nojekyll)
```

`dist/` の中身を、公開用リポジトリの直下に置いて Pages を有効にする。ファイルは相対パスだけで参照しているので、`https://<owner>.github.io/<repo>/` のようなサブパスでも動く。


## 共通モジュール `src/tango.js` (T5)

ブラウザ標準機能だけで動く ES モジュール。依存なし・サーバー通信なし・オフライン可。
画面側も Node のテストも同じ import で使える。

```js
import { parseWordList, encodeTest, decodeTest, testId, makeResultCode, parseResultCode,
         checkKumi, checkNo, checkFormUrl } from './src/tango.js';
```

| 関数 | 同期 | 返り値 |
|---|---|---|
| `parseWordList(text)` | 同期 | `{words:{en,ja,key}[], errors:{line,reason}[], truncated}` |
| `encodeTest(words, form?)` | async | `#` の後ろに入れる文字列 (base64url)。`form` は Google フォームの URL (省略可) |
| `decodeTest(s)` | async | `{ok:true, words, id, form}` か `{ok:false, reason}`。例外は投げない。`form` は確かめ直した URL か `''` |
| `testId(words)` | 同期 | 単語の内容から作る6文字のID |
| `makeResultCode({id,kumi,no,score,total,nick})` | 同期 | `テストID-組-番号-点数-問題数-ニックネーム-チェック4文字` (例 `szme4y-2B-14-6-8-ひなた-px60`) |
| `parseResultCode(text)` | 同期 | `{ok:true,id,kumi,no,score,total,nick}` か `{ok:false, reason}` |
| `checkKumi(v)` / `checkNo(v)` | 同期 | `{ok, value, reason}`。組は全角→半角・英字は大文字で3文字までの数字か英字、番号は1〜99の整数 |
| `checkFormUrl(v)` | 同期 | `{ok, value, reason}`。空はフォームなしで ok。`https://docs.google.com/forms/…` と `https://forms.gle/…` だけ通す |

- 入力は1行1語で「英語,日本語」(全角カンマ可、最初のカンマで分ける)。空行は無視。
  不正な行は `errors` に行番号つきで入り、他の行は使える。同じ英語の2回目以降も errors。
  31問目以降は使わず `truncated: true`。`key` は英語を小文字・trim にしたもの (作るのはこの関数だけ)。
- `reason` は先生・生徒にそのまま見せられる文言。表示は画面側で「3行目: 〜」と組み立てる。
- リンクは `https://…/#<encodeTest の結果>`。`#` 以降はサーバーに送られない。
  実測 (`#` の後ろ、日本語入りの現実的な30問): フォームなし 866文字 / forms.gle (35文字) 948文字 / docs.google.com (111文字) 1052文字。上限の目安 1500。
- 組・番号のチェックは `checkKumi` / `checkNo` の1か所。生徒の開始画面と先生の集計で同じ `reason` (「組は3文字までの数字か英字にしてください（例: 3、2B）」など) を出す。`makeResultCode` に壊れた値を渡すと、その `reason` で例外を投げる。
- リンクに入った URL は、開く側 (`decodeTest`) でも `checkFormUrl` で確かめ直し、Google フォーム以外なら捨てる。リンクを書き換えて別サイトへ誘導されないようにするため。
- ニックネームは `-`・タブ・改行を除き12文字まで、空なら「名無し」。`makeResultCode` が整えるので画面側で二重処理しない。
- **結果コードのチェック4文字は、コピーミスや切れを見つけるためだけのもの。改ざんは防げない。**
  点数の確認は、先生が本人の前で行う運用にする。

### テスト

```
npm test        # Node >= 22 の標準テストランナー。追加インストール不要
node demo/e2e.mjs  # 先生のリンク作成 → 生徒の採点・結果コード → 先生の集計・CSV を画面なしで通す
```

実ブラウザ (Chromium) で画面を通す確認。Playwright は本体の依存に入れない。手元にあるものを `PLAYWRIGHT` で指す。

```
python3 -m http.server 8765 --bind 127.0.0.1 &
PLAYWRIGHT=/path/to/playwright/index.mjs node demo/browser.mjs   # スクリーンショットと CSV は demo/screens/
```

先生のリンク作成 (PC幅) → 生徒が 360px 幅でテスト (組・番号の入力チェック、フォームを開くボタン、コピー失敗時、開き直しで組・番号が残る、フォームなしのテスト) → 学習画面 → 開き直し → 単語リストの入れ替え (覚えた数が減らないこと) → 先生の集計と CSV → オフラインでの再読み込み、を通す。`hidden` なのに見えている要素と、横のはみ出しも出力する。

## 生徒用 `test.html` / `index.html` (T1・T3・T7)

- テストの開始画面: 組・出席番号 (必須)、ニックネーム (任意)。空や範囲外はその欄の下に理由を出し、その欄にフォーカスを移す。チェックは `src/seat.js` → `checkKumi` / `checkNo`。前回の組・番号は `trial-tango:seat:v1` に残す (進捗とは別のキー)。
- 結果画面: フォームの URL 入りのテストは「コピーしてフォームを開く」(`<a target="_blank">`、押すと同時にコピー)。コピーできないときはコードを全選択して「長押しでコピーしてください」。URL なしのテストは「コードをコピー」だけ。
- 学習画面: 単語がないときは「先生のテストリンクから開いてください」。自分で貼る欄は折りたたみの中。「進捗をコピー」で書き出し・貼って復元 (足し合わせ、数は減らない)。

## 先生用 `teacher.html` (T2・T4)

関数は `src/teacher.js`、画面は `teacher.html` + `teacher.js`。通信はしない。貼った内容は端末の localStorage にだけ残る。

| 関数 | 返り値 |
|---|---|
| `buildTestLink(text, baseUrl, formUrl?)` (async) | `{ok:true, url, id, form, words, errors, truncated}` か `{ok:false, reason, errors}` (有効な行が0、またはフォームの URL がだめ) |
| `findResultCode(line)` | 1行 (タブ区切りのセル) から結果コードを探す。`{ok:true, …, code, at}` か `{ok:false, reason}`。`at` は同じ行のタイムスタンプ (なければ `''`) |
| `aggregateResults(text, id?)` | `{id, ids, rows:{line,kumi,no,nick,score,total,dup,at}[], skipped:{line,text,reason}[], average, total, hasTime}`。rows は組→番号→提出時刻の順 |
| `toCsv(rows)` | 列は `組,番号,ニックネーム,点数,問題数,同じ番号,提出時刻`。番号・点数は数値。BOM つき UTF-8、CRLF。`= + - @` で始まるセルは先頭に `'` |

- 集計はテストIDごと。`id` を省略するといちばん多いIDを使い、別IDの行は「別のテストのコードです」でスキップ。
- 同じコードの貼り重ねは1件にする。同じ人のやり直し (点数が違う) は両方残す。問題数が他と違う行はスキップ。
- 壊れた行は行番号つきで `skipped` に入る。空行は数えない。

### 公開 (GitHub Pages)

```
npm run dist    # sw.js の FILES と同じファイルだけを dist/ に集める (+ .nojekyll)
```

`dist/` の中身を公開用リポジトリ (例: `trial-tango`) の main に置き、Settings → Pages で main / root を選ぶ。
リポジトリの作成と Pages の有効化は、持ち主の許可を得てから行う。生徒のデータは公開物に入らない。

### 動かし方・オフライン

ES モジュールを使うので `file://` で直接開くと Chrome では動かない。静的サーバーで配る
(例: `python3 -m http.server`) と、`sw.js` が一度開いたあとのオフライン動作を担う。
