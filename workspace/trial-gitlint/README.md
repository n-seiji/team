# commitcheck

コミットメッセージを書く前に気づける、やさしいチェッカー。止めはしません(警告だけ)。

## 導入手順

前提: `node -v` が v22.18 以上であること。

```
git clone /home/claude/team/workspace/trial-gitlint ~/commitcheck
cd ~/projects/site
node ~/commitcheck/src/main.ts install-hook
```

2行目の `~/projects/site` は、普段コミットしているフォルダ(例: `cd ~/projects/site`)に変えてください。

これで、以後の `git commit` のたびにチェックが走ります。

- 問題があると警告が出ます。`Enter` でそのまま続行、`1` で直し案に置き換えできます。直し案が `<種類(feat=追加 / fix=修正)>: <説明>` の雛形のときは置き換えられないので、`Ctrl+C` でやめて書き直してください。
- IDE のコミットボタンなど、対話できない場所では警告を出すだけでコミットは通ります。
- すでに `.git/hooks/commit-msg` がある場合は上書きしません。そのファイルの末尾に、画面に出る1行(`node '…/main.ts' hook "$1" || true`)を足してください。
- チームのルールを決めるには `node ~/commitcheck/src/main.ts init --style free`(または `conventional`)を実行し、できた `.commitrules.json` をコミットします。

## 使い方

```
node src/main.ts check "メッセージ"   # 0=OK 1=問題あり 2=使い方の誤り・設定が読めない
node src/main.ts check --json "メッセージ"
```

## テスト

```
node --test "test/*.test.ts"
```
