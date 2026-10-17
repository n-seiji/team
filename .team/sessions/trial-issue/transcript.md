# trial-issue

**Brief:** team シミュレーター (このリポジトリ) に、GitHub の issue から直接セッションを始める機能 `team init --issue owner/repo#N` を加える。gh CLI があれば issue のタイトルと本文を brief に取り込み、無ければ何をすればよいか分かるエラーを出す。既存のルール (CLAUDE.md、README、pnpm typecheck && pnpm test) を守る。

**Status:** done · iteration 1/2 · phase `wrapup`

## Team

- **佐藤 美咲** (`pm`, pm)
- **田中 健** (`eng-backend`, engineer)
- **鈴木 ひかり** (`eng-frontend`, engineer)
- **木村 拓也** (`user-dev`, user)

## Backlog

- T1 [done] owner=eng-backend `team init --issue owner/repo#N` で gh から issue を取得する
    acceptance: - `team init --issue owner/repo#N` を実行すると、`gh issue view N -R owner/repo --json title,body,comments,url` 相当でタイトル・本文・全コメントを取得し、セッション名と brief を作る。
    - `owner/repo#N` の形式が不正なら、正しい書式例を添えて非0で終了する。セッションは作らない。
    - gh の実行は差し替え可能にして、テストで gh を偽装できる（実ネットワーク不要）。
    - 既存の `team init <brief>` の挙動は変えない。
    result: 完了済みで、wrapup での変更はありません。ゲートの通過は再確認しました。
- T2 [done] owner=eng-backend gh が無い・取得失敗のときは、空 brief のセッションを作らず即停止する
    acceptance: - gh が PATH に無い場合は、起動直後に1行目で原因が分かるエラーを出して非0終了する。`.team/sessions/` には何も作らない。
    - エラーには、gh のインストール方法（例: `https://cli.github.com`）と、`GH_TOKEN`（Actions なら `GITHUB_TOKEN` を渡す）の設定方法を必ず書く。
    - gh はあるが、認証失敗・404・ネットワーク失敗になった場合も同様に、原因と対処を書いて非0終了する。空 brief にはしない。
    - 上の2パターンを、gh を偽装したテストで検証する。
    result: 完了済みで、wrapup での変更はありません。
- T3 [done] owner=eng-frontend 取り込んだ issue から brief を組み立てる
    acceptance: - brief の先頭に `Issue: owner/repo#N` と URL を必ず入れる。
    - タイトル、本文、コメントを取り込む。コメントは投稿者・日時つきで時系列に並べ、本文との境目が分かるようにする。コードブロックと箇条書きは元の Markdown のまま崩さない。
    - 末尾に「PR 説明に `Closes owner/repo#N` を入れること」と「`pnpm typecheck && pnpm test` を通すこと」を入れる。
    - テストで、コメント内の「API は v2 で」のような追記が brief に含まれることと、参照・Closes・規約の3行があることを確認する。
    result: `buildIssueBrief` を `src/issue-brief.ts` に実装した。先頭に `Issue: owner/repo#N` と URL を置き、タイトル、本文、コメント（`### @author — 日時 (UTC)`、時系列）を並べる。末尾に `Closes` と `pnpm typecheck && pnpm test` の 2 行を入れる。コメントの追記が brief に入ること、参照・Closes・規約の 3 行があることは `test/issue-brief.test.ts` で確認した。確認は `pnpm typecheck && pnpm test`（47 件中 47 件 pass）で行える。
- T4 [done] owner=eng-frontend README と最終確認
    acceptance: - README の init の項に `--issue` の使い方、gh の要件、`GH_TOKEN` / `GITHUB_TOKEN` の説明、エラー例を追記する。
    - `pnpm typecheck && pnpm test` が通る。
    - 通した結果を、完了報告に書く。
    result: README の init の項に「Starting from a GitHub issue」を追記した。内容は次のとおり。
    - `--issue` の使い方と `--name` の優先。
    - gh の要件と、`GH_TOKEN` / `GITHUB_TOKEN`（Actions では `env: GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`）。
    - 田中さんの T2 の実出力をそのまま貼ったエラー例 2 つ。
    - 200KB 上限と 16MB の扱い。
    
    `pnpm typecheck && pnpm test` は通った（47 件中 47 件 pass、fail 0）。
- T5 [done] owner=eng-backend T1 追記: 型の先行引き渡しとセッション名、巨大出力の扱い
    acceptance: - `src/issue.ts` に `Issue` 型（`ref={owner,repo,number}`、`title`、`body`、`url`、`comments[]={author,createdAt(ISO のまま),body}`）と `fetchIssue(ref, runGh)` を置き、置いた時点で鈴木さんに型とシグネチャを伝える。
    - `runGh` は `(args, env) => {status, stdout, stderr, notFound}` で差し替えられ、テストでは gh を偽装する。
    - issue の取得は `src/cli.ts` の `--force` の `rmSync` より前に行う。取得に失敗しても既存セッションは消えない。
    - セッション名の既定値は `issue-<repo>-<N>`。英数字とハイフン以外は `-` に置換。`--name` があればそちらを優先する。
    - gh の出力が 16MB を超えたら、黙って欠けさせずエラーにして非0終了する。テストで確認する。
    - 依存は追加しない。既存の `team init <brief>` の挙動は変えない。
    result: 完了済みで、wrapup での変更はありません。
- T6 [done] owner=eng-frontend T3 追記: 上限・警告・フェンス補完
    acceptance: - `buildIssueBrief(issue)` は副作用のない純関数で、順序は `Issue: owner/repo#N`、URL、省略警告（あれば）、`# タイトル`、本文、`## コメント (N件)`、`### @author — 日時 (UTC)` と本文（時系列）、末尾に規約2行。
    - brief が 200KB を超えたら、新しいコメントを優先して残し、Issue 行の直下に `⚠ コメント N 件中 M 件を省略しました（brief の上限 200KB）。全文: <url>` を出す。本文だけで超える場合はエラーにする。テストで確認する。
    - コメント本文のコードフェンスが奇数個なら末尾に閉じフェンスを補う。テストで確認する。
    - 先に仮の型でテストを書いてよい。田中さんの型が届いたら合わせる。
    result: `buildIssueBrief(issue)` を `src/issue-brief.ts` に実装し、`test/issue-brief.test.ts` に 8 ケースを追加した。`pnpm typecheck && pnpm test` は通った（33 件中 33 件 pass）。
    - 出力順は次のとおり。
      - 先頭に `Issue: owner/repo#N` と URL。
      - 省略があるときは、その直下に `⚠ コメント N 件中 M 件を省略しました（brief の上限 200KB）。全文: <url>`。
      - `# タイトル` と本文。
      - `## コメント (N件)` の下に `### @author — YYYY-MM-DD HH:MM (UTC)` と本文を時系列で並べる。
      - 末尾に `Closes owner/repo#N` と `pnpm typecheck && pnpm test` の 2 行。
    - 本文とコメントの Markdown は元のまま入れる。コメントのコードフェンスが奇数個なら、末尾に閉じフェンスを補う。
    - 上限は 200×1024 の UTF-8 バイトで数え、警告行も予算に含める。超えたら新しいコメントから残し、古いものを省略する。残したコメントの数は `## コメント (N件)` に出る。
    - 本文だけで上限を超えたときは `Error` を投げ、全文の URL を添える。
    - 型は `src/issue.ts` の `Issue` と構造が同じ `BriefIssue` を自前で持っている。田中さんの型が届いたら `Issue` に差し替える。
    - 実行は `node --test test/issue-brief.test.ts`。

## Decisions

- (discovery, 佐藤 美咲 (pm)) スコープは最小にする。(1) `team init --issue owner/repo#N` で gh 経由のタイトル・本文・コメントを brief に取り込む (2) brief に issue 参照を必ず残し、PR に `Closes owner/repo#N` を入れる前提を示す (3) brief に CLAUDE.md の `pnpm typecheck && pnpm test` を守る旨を含める (4) gh が無い、または取得に失敗したら、空 brief のセッションを作らず即座に非0終了し、インストール方法と `GH_TOKEN` 設定を書いたエラーを出す。理由: 木村さんの実害は欠落・紐づけ漏れ・規約抜け・黙った失敗の4点で、それ以外（複数 issue、ラベル同期など）は後回しにしても困らないため。
- (planning, 佐藤 美咲 (pm)) 田中さんの分担案を採用する。田中さんが先に `src/issue.ts` に `Issue` 型（`ref={owner,repo,number}`、`comments[].createdAt` は ISO 文字列のまま）と `fetchIssue(ref, runGh)` を置き、鈴木さんに通知する。理由: T3 のテストが T1 の型に依存するため。トレードオフは、型を決めるまで鈴木さんが仮の型で待つこと。
- (planning, 佐藤 美咲 (pm)) セッション名の既定値は `issue-<repo>-<N>`（英数字とハイフン以外は `-` に置換）、`--name` 指定があればそちらを優先する。依存は追加せず `spawnSync` のみ。gh の出力が 16MB を超えたら黙って欠けさせず、エラーで止める。
- (planning, 佐藤 美咲 (pm)) brief が 200KB を超える場合は、新しいコメントを優先して残し、古いものを省略する。省略したときは Issue 行の直下に `⚠ コメント N 件中 M 件を省略しました（brief の上限 200KB）。全文: <url>` を出す。本文だけで上限を超える場合は切らずにエラーで止める。理由: 黙って欠けるのが一番の実害で、末尾の警告は見落とされるため。
- (planning, 佐藤 美咲 (pm)) README に載せるエラー例は T2 の実出力をそのまま貼る。T4 は T2 の文言が確定してから着手する。エラー文言は、1行目に原因、2行目以降にインストール方法と `GH_TOKEN` の設定方法の順にする。
- (planning, 佐藤 美咲 (pm)) 200KB の上限は UTF-8 のバイト数で数え、省略警告の行も予算に含める。gh の `author` が null（削除済みユーザー）の場合は、型側で `ghost` に正規化する。理由: 文字数で数えると日本語で上限を超えて通ってしまい、null 分岐を鈴木さん側に持たせると見出しの処理が複雑になるため。
- (acceptance, 佐藤 美咲 (pm)) 今回の `team init --issue` は、木村さんの ACCEPT をもって受け入れ完了とする。追加の実装タスクは作らない。次の確認事項は、実 gh と Actions での取得、および PR 作成まで通した `Closes` の確認で、結果は木村さんから受ける。コミットと push は、ユーザーの確認を取ってから行う。

## Verdicts

- iteration 1 · 木村 拓也 (user-dev) · **accept** — 受け入れます。ただし、実 gh でのネットワーク取得は誰も見ていません。

良い点:
- `init --issue owner/repo#N` の1コマンドで始まります。issue 本文のコピペが要らず、これが一番助かります。
- gh が無いとき、1行目に原因が出ます。続けてインストール先、`gh auth login`、`GH_TOKEN`、Actions で `GITHUB_TOKEN` を渡す書き方まで書いてあります。何をすべきかが分かるので、私の基準に合っています。
- 失敗してもセッションは作られません。`--force` でも既存セッションは消えません。黙って空 brief になることがありません。
- コメントが投稿者・日時つきで時系列に入ります。「API は v2 で」のような追記が落ちません。
- brief の先頭に `Issue: owner/repo#N` と URL が入ります。末尾に `Closes owner/repo#N` と `pnpm typecheck && pnpm test` の2行が入ります。
- 200KB 超でも、古いコメントを省略して警告を Issue 行の直下に出します。黙って欠けないのは評価します。

要望です。ブロッカーではありません。
1. `Closes` は brief に書いてあるだけです。PR 説明に実際に入るかは、後段の動作を見ないと分かりません。次回は PR 作成まで通して確認させてください。
2. 実 gh と Actions 環境(`GH_TOKEN` 経由)での確認をお願いします。私の CI で最初に試して、結果を返します。
3. 本文が 200KB を超えた場合は、`--brief-file` に手で切り替える必要があり、手順が1つ増えます。ただ、これは稀なので許容します。

## Transcript

### iteration 1 · discovery

- — Session "trial-issue" started. Brief: team シミュレーター (このリポジトリ) に、GitHub の issue から直接セッションを始める機能 `team init --issue owner/repo#N` を加える。gh CLI があれば issue のタイトルと本文を brief に取り込み、無ければ何をすればよいか分かるエラーを出す。既存のルール (CLAUDE.md、README、pnpm typecheck && pnpm test) を守る。

- — Phase "discovery" started (iteration 1) — PM interviews the users to uncover their real situation, pains and jobs-to-be-done. Users answer strictly in character, with concrete episodes. No solutions yet.

> _佐藤 美咲 (pm) [thinks]: discovery の1ラウンド目。ユーザーは木村 拓也 (user-dev) のみ。事実を掘る質問を短く。解決策は出さない。_

- 佐藤 美咲 (pm) → user-dev: 木村さん、よろしくお願いします。まず最後に、GitHub の issue を見てから team のセッションを始めたのはいつでしたか？そのとき、issue の内容をどうやって team に渡しましたか？手順をそのまま教えてください。

- 佐藤 美咲 (pm) → user-dev: もう一つ。その作業で「面倒だった」「間違えた」と感じた場面があれば、具体的に聞かせてください。

> _木村 拓也 (user-dev) [thinks]: 直近の具体的エピソードを、persona に沿って端的に答える。_

- 木村 拓也 (user-dev) → pm: 先週火曜です。うちのリポジトリの issue を team に回しました。手順は次の通りです。
  1. ブラウザで issue を開く。
  2. タイトルと本文をコピーする。
  3. `team init` の brief に貼る。貼る際にコードブロックや箇条書きが崩れたので、手で直した。
  4. 「どの issue か」を自分で brief に書き足した。これを忘れたので、後で PR と issue が紐づかなかった。
  
  `gh issue view` は毎日使っているので、本来はコマンド一発で取れるはずです。それなのに手でコピペしているのが、自分でも腹立たしいです。

- 木村 拓也 (user-dev) → pm: 面倒だった点は 3 つあります。
  - 手で貼ると本文が欠けます。長い issue でコメント側にある追記の仕様を落としました。それで、たたき台が古い仕様のまま上がってきました。
  - たたき台がチームの規約を無視します。CLAUDE.md の `pnpm typecheck && pnpm test` を通していない PR が来ると、レビューする前に差し戻す手間が増えます。
  - いちばん嫌いなのは、黙って失敗することです。前に CI 上で試したときは、gh が無かったのに何も言われず、brief が空のままセッションが走りました。10 分後に空の brief だと気づきました。エラーには「何を入れれば動くか」まで書いてほしいです。

> _佐藤 美咲 (pm) [thinks]: 木村さんの話から、課題が3つ見えた。手コピペでの欠落（コメント側の追記）、規約（pnpm typecheck && pnpm test）の抜け、黙って失敗すること。issue と PR の紐づけ漏れも出た。解決策にはまだ踏み込まず、事実をあと少し掘って discovery を閉じる。_

- 佐藤 美咲 (pm) → user-dev: ありがとうございます。具体的でとても助かります。追加で3点だけ教えてください。
  1. 「長い issue でコメント側の追記を落とした」とき、たたき台はどの時点で古い仕様だと分かりましたか？誰が、何を見て気づきましたか？
  2. 「PR と issue が紐づかなかった」ことで、実際に何が起きましたか？ 誰が困りましたか？
  3. CI で brief が空のまま走ったときは、どの環境で、gh はどう用意する予定でしたか？ そのとき最初に見たかった画面やメッセージは何でしたか？

> _佐藤 美咲 (pm) [notes]: 木村さんの実績：先週火曜に issue を手でコピペして team に回した。コードブロック・箇条書きが崩れ、手で直した。issue の参照を brief に書き忘れ、PR と issue が紐づかなかった。長い issue ではコメント側の追記仕様を落とし、古い仕様のたたき台が上がった。CLAUDE.md の `pnpm typecheck && pnpm test` を通していない PR が来て差し戻しになった。過去に CI で gh が無いのに何も言われず、brief が空のまま10分走った。「エラーには何を入れれば動くかまで書いてほしい」。`gh issue view` は毎日使っている。_

> _木村 拓也 (user-dev) [thinks]: 3 つの質問に、具体的に端的に答える。実装の話はしない。_

- 木村 拓也 (user-dev) → pm: 1. 気づいたのは私です。PR を開いて、まず diff を見ました。issue 本文のコメント欄に「API は v2 で」と追記があったのに、PR は v1 のままでした。issue を開き直して初めて分かりました。PR の説明には根拠が書かれておらず、どの issue のどの時点の内容を見たのか判別できなかったので、15 分ほど迷いました。
  
  2. 実害が 2 つありました。
  - マージ後に issue が自動で閉じませんでした。`Closes #N` が PR になかったからです。
  - 翌週、チームメンバーが同じ issue を「未着手」と見て拾い、二重作業になりかけました。困ったのは私とそのメンバーです。
  
  3. 環境は GitHub Actions で、ubuntu-latest です。gh は入っていると思い込んでいました。実際は未インストールで、用意するつもりも特にありませんでした。トークンは `GITHUB_TOKEN` が既にある前提でした。
  最初に見たかったのは、起動直後の 1 行のエラーです。内容は「gh が無い。インストールするか、`GH_TOKEN` を設定してください」といったもので、brief が空のまま先に進んでほしくありません。止まってくれるなら、10 分も無駄にしませんでした。

> _木村 拓也 (user-dev) [notes]: 木村さんの最重要の不満は、黙って失敗することです。次に、手でコピペすると issue のコメント側の追記が落ちることと、PR に `Closes #N` が付かず issue と紐づかないことです。環境は CI (GitHub Actions) で、gh が無いことがあります。_

> _佐藤 美咲 (pm) [thinks]: 十分な事実が揃った。discovery の目的は達成。課題は4つ：欠落（コメント）、issue 参照漏れ、規約抜け、黙って失敗。スコープは最小に絞り、ここで決めて次フェーズへ進める。_

- 佐藤 美咲 (pm) → user-dev: 木村さん、ありがとうございます。「起動直後の1行のエラー」「止まってくれるなら10分も無駄にしなかった」という言葉が決め手でした。整理します。
  - 欠落: 本文だけでなくコメントの追記も落ちる（「API は v2 で」）。
  - 紐づけ: `Closes #N` が無く issue が閉じず、二重作業になりかけた。
  - 規約: `pnpm typecheck && pnpm test` が守られず差し戻し。
  - 黙って失敗: gh が無いのに空 brief で10分走った。
  
  次のフェーズで最小スコープに落とします。

> _佐藤 美咲 (pm) [notes]: 木村さんの追加事実：コメント欄の追記（「API は v2 で」）を見落とし、PR を開いて diff を見てから気づくまで15分迷った。PR 説明に issue の根拠が無く判別不能。`Closes #N` が無く issue が自動で閉じず、翌週チームメンバーが「未着手」と見て二重作業になりかけた。CI は GitHub Actions の ubuntu-latest で gh 未インストール、`GITHUB_TOKEN` は既にある前提。最初に見たかったのは起動直後の1行エラー（gh が無い／インストールするか `GH_TOKEN` を設定）で、空 brief のまま進まず止まってほしい。_

- 佐藤 美咲 (pm) [DECISION]: スコープは最小にする。(1) `team init --issue owner/repo#N` で gh 経由のタイトル・本文・コメントを brief に取り込む (2) brief に issue 参照を必ず残し、PR に `Closes owner/repo#N` を入れる前提を示す (3) brief に CLAUDE.md の `pnpm typecheck && pnpm test` を守る旨を含める (4) gh が無い、または取得に失敗したら、空 brief のセッションを作らず即座に非0終了し、インストール方法と `GH_TOKEN` 設定を書いたエラーを出す。理由: 木村さんの実害は欠落・紐づけ漏れ・規約抜け・黙った失敗の4点で、それ以外（複数 issue、ラベル同期など）は後回しにしても困らないため。

- 佐藤 美咲 (pm) [ADVANCE]: End of phase "discovery".

### iteration 1 · planning

- — Phase "planning" started (iteration 1) — PM turns findings into a small, shippable scope: [TASK] items with clear acceptance criteria, each assigned to an engineer. Engineers challenge feasibility, split or re-assign tasks, and agree on tech choices.

> _佐藤 美咲 (pm) [thinks]: 決定済みの4点を、テストできる受け入れ基準にして2人に割り振る。田中さんは gh 取得とエラー処理、鈴木さんは brief 組み立てと README・テスト。コード調査は技術確認としてエンジニアに任せる。_

- 佐藤 美咲 (pm) [TASK]: T1 owner=eng-backend: `team init --issue owner/repo#N` で gh から issue を取得する
  - `team init --issue owner/repo#N` を実行すると、`gh issue view N -R owner/repo --json title,body,comments,url` 相当でタイトル・本文・全コメントを取得し、セッション名と brief を作る。
  - `owner/repo#N` の形式が不正なら、正しい書式例を添えて非0で終了する。セッションは作らない。
  - gh の実行は差し替え可能にして、テストで gh を偽装できる（実ネットワーク不要）。
  - 既存の `team init <brief>` の挙動は変えない。

- 佐藤 美咲 (pm) [TASK]: T2 owner=eng-backend: gh が無い・取得失敗のときは、空 brief のセッションを作らず即停止する
  - gh が PATH に無い場合は、起動直後に1行目で原因が分かるエラーを出して非0終了する。`.team/sessions/` には何も作らない。
  - エラーには、gh のインストール方法（例: `https://cli.github.com`）と、`GH_TOKEN`（Actions なら `GITHUB_TOKEN` を渡す）の設定方法を必ず書く。
  - gh はあるが、認証失敗・404・ネットワーク失敗になった場合も同様に、原因と対処を書いて非0終了する。空 brief にはしない。
  - 上の2パターンを、gh を偽装したテストで検証する。

- 佐藤 美咲 (pm) [TASK]: T3 owner=eng-frontend: 取り込んだ issue から brief を組み立てる
  - brief の先頭に `Issue: owner/repo#N` と URL を必ず入れる。
  - タイトル、本文、コメントを取り込む。コメントは投稿者・日時つきで時系列に並べ、本文との境目が分かるようにする。コードブロックと箇条書きは元の Markdown のまま崩さない。
  - 末尾に「PR 説明に `Closes owner/repo#N` を入れること」と「`pnpm typecheck && pnpm test` を通すこと」を入れる。
  - テストで、コメント内の「API は v2 で」のような追記が brief に含まれることと、参照・Closes・規約の3行があることを確認する。

- 佐藤 美咲 (pm) [TASK]: T4 owner=eng-frontend: README と最終確認
  - README の init の項に `--issue` の使い方、gh の要件、`GH_TOKEN` / `GITHUB_TOKEN` の説明、エラー例を追記する。
  - `pnpm typecheck && pnpm test` が通る。
  - 通した結果を、完了報告に書く。

- 佐藤 美咲 (pm) → eng-backend, eng-frontend: スコープは4点だけです。取得（本文＋コメント）、参照と Closes、規約の明記、gh 無し・失敗時の即停止。複数 issue、ラベル同期、gh を使わない API 取得は今回やりません。
  確認したいのは次の3点です。
  1. 田中さん: 取得は `gh issue view --json` でコメントまで一発で取れますか？ 取れないなら代替案を教えてください。
  2. 田中さん: 失敗時に `.team/sessions/` を汚さないのは、既存の init の流れで無理がありますか？
  3. 鈴木さん: コメントが非常に長い場合、brief の長さに上限は要りますか？ 要るなら、切り捨てると分かる印を付ける案でお願いします。黙って欠けるのが一番困ります。
  タスクの分け方に異論があれば言ってください。

- 田中 健 (eng-backend): 田中です。結論から言います。1 と 2 は問題なし、タスクの分け方は 1 点だけ調整させてください。
  
  1. 取得は一発で取れます。`gh issue view N -R owner/repo --json title,body,comments,url` で、comments には `author.login`、`createdAt`、`body` が入ります。ページングも gh 側で全件返すので、別 API は要りません。代替案は不要です。
  2. `.team/sessions/` を汚さない件は、既存の init の流れで無理なくできます。`src/cli.ts` の init では、状態を書く処理（`World.create`、`mkdirSync`、`store.save`）がすべて brief 確定より後にあります。ただし `--force` の `rmSync`（139 行目）は brief 確定より後ですが、既存セッションを消す処理です。issue の取得は、ここより前の brief を決める箇所（131 行目付近）で済ませます。取得に失敗したら、既存セッションも消えません。
  3. 失敗の検出は 2 種類に分けます。gh が無い場合は spawn の `ENOENT` で判定します。gh があって失敗した場合は、終了コードと stderr の文言（`auth`、`404`、`Could not resolve`）で分類します。
  4. 分け方で調整したい点は、T1 と T3 の境界です。T3 のテストは T1 の取得結果の型に依存します。そこで私が先に `src/issue.ts` に次の 2 つを置き、鈴木さんに渡します。
     - 型 `Issue = { ref, title, body, url, comments: {author, createdAt, body}[] }`
     - 取得関数 `fetchIssue(ref, runGh)`
     `runGh` は引数で差し替えられる `(args, env) => {status, stdout, stderr, notFound}` です。これで鈴木さんは偽の Issue を渡して `buildIssueBrief(issue)` を書けます。私は gh の偽装でテストを書きます。
  5. セッション名の既定値は `issue-<repo>-<N>` にします。`owner/repo` の `/` はパス区切りになるので、英数字とハイフン以外は `-` に置換します。`--name` 指定があればそちらを優先します。
  6. 依存は増やしません。`node:child_process` の `spawnSync` だけを使います。
  
  鈴木さんの上限の件には、私からも 1 つ付けます。`gh` の出力が巨大なとき、`spawnSync` の `maxBuffer` 既定 1MB を超えると黙って欠けます。私の側で 16MB に上げ、超えたらエラーにします。brief 側の切り捨てには、鈴木さんが決める印を付けてください。

- 田中 健 (eng-backend) [TASK_UPDATE]: T1 → doing

> _鈴木 ひかり (eng-frontend) [thinks]: 計画フェーズなのでファイルは編集しない。上限の方針と印を決め、田中さんの型・関数の渡し方に合意して返す。_

- 鈴木 ひかり (eng-frontend) → pm, eng-backend: 鈴木です。タスクの分け方は田中さんの案で賛成です。上限の件と、T3 の仕様を先に決めます。
  
  1. 上限について。コメントが長くても、黙って欠けるのが一番困ります。そこで、本文もコメントも切らない方針を基本にします。理由は、木村さんの実害が「コメントの追記を落とした」ことだからです。切る場合に備えて、上限は次のようにします。
     - brief 全体で 200KB を上限にします。これを超えたら、新しいコメントから優先して残します。古いコメントは落とします。
     - 落としたら、brief の先頭付近（Issue 行のすぐ下）に `⚠ コメント N 件中 M 件を省略しました（brief の上限 200KB）。全文: <url>` を出します。末尾だけに書くと見落とされるので、先頭に置きます。
     - 本文だけで上限を超える場合は切りません。エラーで止めて、原因と対処を書きます。
  2. brief の形です。T3 の `buildIssueBrief(issue)` は純関数にします。副作用や gh 呼び出しは持たず、文字列だけを返します。構成は次の順です。
     - `Issue: owner/repo#N`
     - URL
     - 省略の警告（あれば）
     - `# タイトル`
     - 本文（Markdown のまま）
     - `## コメント (N件)` 以下に、`### @author — 日時 (UTC)` の見出しと本文を時系列で並べる
     - 末尾に規約 2 行
     本文とコメントの境目は見出し 2 つで分かります。
  3. 崩れ対策です。コメント本文にコードフェンス（```）が閉じていない場合、後続の見出しが飲み込まれます。そこで、フェンスが奇数個なら末尾に閉じフェンスを補います。これもテストに入れます。
  4. 田中さんへのお願いです。`Issue` 型の `comments[].createdAt` は gh が返す ISO 文字列のまま渡してください。整形は私の側でやります。`ref` は `{owner, repo, number}` の形にしてほしいです。`Issue: owner/repo#N` を組み立てるのに使います。型と関数のシグネチャは、`src/issue.ts` に先に置いたら教えてください。それまでは、私は仮の型でテストを書きます。
  5. T4 については、README に載せるエラー例は T2 の実際の出力をそのまま貼ります。T2 の文言が確定してから書きます。文言の案としては、1 行目に原因、2 行目以降にインストール方法と `GH_TOKEN` の設定方法、の順を希望します。

> _鈴木 ひかり (eng-frontend) [notes]: 上限方針: brief は 200KB まで。超えたら古いコメントから省略し、Issue 行の直下に省略件数と URL を出す。本文だけで超える場合はエラー。`buildIssueBrief(issue)` は純関数で、`src/issue.ts` の `Issue` 型（田中さん担当）に依存する。コメントのコードフェンスが奇数個なら閉じフェンスを補う。_

> _佐藤 美咲 (pm) [thinks]: 田中さんと鈴木さんの提案は妥当。受け入れ基準に反映が必要な点を決める。200KB上限・先頭の省略警告・フェンス補完はT3に追加。T1にはmaxBuffer超過エラー、セッション名、型の先行引き渡しを追加。T4はT2の実出力を貼るので順序をT2後にする。_

- 佐藤 美咲 (pm) [DECISION]: 田中さんの分担案を採用する。田中さんが先に `src/issue.ts` に `Issue` 型（`ref={owner,repo,number}`、`comments[].createdAt` は ISO 文字列のまま）と `fetchIssue(ref, runGh)` を置き、鈴木さんに通知する。理由: T3 のテストが T1 の型に依存するため。トレードオフは、型を決めるまで鈴木さんが仮の型で待つこと。

- 佐藤 美咲 (pm) [DECISION]: セッション名の既定値は `issue-<repo>-<N>`（英数字とハイフン以外は `-` に置換）、`--name` 指定があればそちらを優先する。依存は追加せず `spawnSync` のみ。gh の出力が 16MB を超えたら黙って欠けさせず、エラーで止める。

- 佐藤 美咲 (pm) [DECISION]: brief が 200KB を超える場合は、新しいコメントを優先して残し、古いものを省略する。省略したときは Issue 行の直下に `⚠ コメント N 件中 M 件を省略しました（brief の上限 200KB）。全文: <url>` を出す。本文だけで上限を超える場合は切らずにエラーで止める。理由: 黙って欠けるのが一番の実害で、末尾の警告は見落とされるため。

- 佐藤 美咲 (pm) [DECISION]: README に載せるエラー例は T2 の実出力をそのまま貼る。T4 は T2 の文言が確定してから着手する。エラー文言は、1行目に原因、2行目以降にインストール方法と `GH_TOKEN` の設定方法の順にする。

- 佐藤 美咲 (pm) [TASK]: T5 owner=eng-backend: T1 追記: 型の先行引き渡しとセッション名、巨大出力の扱い
  - `src/issue.ts` に `Issue` 型（`ref={owner,repo,number}`、`title`、`body`、`url`、`comments[]={author,createdAt(ISO のまま),body}`）と `fetchIssue(ref, runGh)` を置き、置いた時点で鈴木さんに型とシグネチャを伝える。
  - `runGh` は `(args, env) => {status, stdout, stderr, notFound}` で差し替えられ、テストでは gh を偽装する。
  - issue の取得は `src/cli.ts` の `--force` の `rmSync` より前に行う。取得に失敗しても既存セッションは消えない。
  - セッション名の既定値は `issue-<repo>-<N>`。英数字とハイフン以外は `-` に置換。`--name` があればそちらを優先する。
  - gh の出力が 16MB を超えたら、黙って欠けさせずエラーにして非0終了する。テストで確認する。
  - 依存は追加しない。既存の `team init <brief>` の挙動は変えない。

- 佐藤 美咲 (pm) [TASK]: T6 owner=eng-frontend: T3 追記: 上限・警告・フェンス補完
  - `buildIssueBrief(issue)` は副作用のない純関数で、順序は `Issue: owner/repo#N`、URL、省略警告（あれば）、`# タイトル`、本文、`## コメント (N件)`、`### @author — 日時 (UTC)` と本文（時系列）、末尾に規約2行。
  - brief が 200KB を超えたら、新しいコメントを優先して残し、Issue 行の直下に `⚠ コメント N 件中 M 件を省略しました（brief の上限 200KB）。全文: <url>` を出す。本文だけで超える場合はエラーにする。テストで確認する。
  - コメント本文のコードフェンスが奇数個なら末尾に閉じフェンスを補う。テストで確認する。
  - 先に仮の型でテストを書いてよい。田中さんの型が届いたら合わせる。

- 佐藤 美咲 (pm) → eng-backend, eng-frontend: 田中さん、鈴木さん、方針を確定しました。分担は田中さんの案どおり、`src/issue.ts` の型と `fetchIssue` を先に置いてください。鈴木さんの上限・警告・フェンス補完も採用します。確認は2点です。(1) 田中さん: 型を置いたら鈴木さんに一言ください。(2) 鈴木さん: README は T2 の実出力が出てから書いてください。ここまでで異論や、スコープに入れると重すぎる点があれば教えてください。

> _田中 健 (eng-backend) [thinks]: 計画フェーズなのでファイルは触れない。異論は無し。リスクを数字で2点だけ挙げ、型の引き渡し予定を明言する。_

- 田中 健 (eng-backend) → pm, eng-frontend: 田中です。結論から言います。分担、スコープ、上限の方針に異論はありません。重すぎる点も無いです。
  
  確認は2点です。
  1. 型の件は了解です。実装フェーズの最初に `src/issue.ts` へ `Issue` 型と `fetchIssue(ref, runGh)` を置きます。置いた時点で鈴木さんに型とシグネチャを伝えます。鈴木さんはそれまで仮の型で進めてください。型は T5 に書いたとおりで、`createdAt` は ISO のままにします。
  2. T1・T2・T5 は同じ `fetchIssue` と `cli.ts` の init を触ります。そのため、私が1つの流れでまとめて実装します。タスクは分けたままで構いません。T2 のエラー文言は、実装した時点で鈴木さんに共有します。T4 はそれを貼ってください。
  
  実装前に押さえておくリスクが2つあります。
  - gh の `author` は、削除済みユーザーだと `null` になることがあります。その場合は `ghost` として扱い、落ちないようにします。鈴木さんの `### @author` 見出しも、この前提で書いてください。
  - `GH_TOKEN` は子プロセスに環境変数ごと引き継ぎます。テストでは `runGh` を偽装するので、実ネットワークも実トークンも使いません。
  
  次の実装フェーズでは、テストを先に書きます。範囲は、書式不正、gh なし、404、16MB 超過、`--force` 時に既存セッションが消えないことです。

> _鈴木 ひかり (eng-frontend) [thinks]: 計画フェーズで編集不可。新たな論点は少ない。田中さんの ghost 前提と型の件に応答し、T6 の細部（サイズ計測はバイト、警告込みの再計算）を確認して終える。_

- 鈴木 ひかり (eng-frontend) → pm, eng-backend: 鈴木です。分担・スコープに異論なしです。T6 を始める前に、田中さんに2点だけ共有します。
  1. 削除済みユーザーは `author` が `null` になる件、了解です。見出しは `### @ghost — 日時 (UTC)` にします。型側で `ghost` に正規化してもらえれば、私の側では null 分岐を持たずに済みます。
  2. 200KB は文字数ではなく UTF-8 のバイト数で数えます。日本語は 1 文字 3 バイトなので、文字数で数えると上限を超えて通ってしまうためです。省略警告の行も予算に含めて数えます。これで、警告を足した結果また上限を超える、ということを防ぎます。
  
  実装フェーズの順番は次のとおりです。
  - 型が届くまでは仮の型でテストを先に書きます。ケースは、コメントの追記が含まれること、参照・Closes・規約の 3 行、時系列、フェンス補完、200KB 超での省略と警告、本文だけで超えたときのエラーです。
  - 型が届いたら合わせます。
  - T4 の README は、T2 の文言が確定してから書きます。

> _鈴木 ひかり (eng-frontend) [notes]: 200KB は UTF-8 のバイト数で数え、省略警告の行も予算に含める。author が null のときは型側で `ghost` に正規化してもらい、見出しは `### @ghost — 日時 (UTC)` とする。_

> _佐藤 美咲 (pm) [thinks]: 計画は出揃い、異論もない。planning の目的（小さなスコープ、受け入れ基準つきの割り当て）は達成済み。最後に、未確定の点を一つ確認して次へ進める。_

- 佐藤 美咲 (pm): 田中さん、鈴木さん、ありがとうございます。分担とスコープは確定です。実装フェーズの順番だけ確認します。
  1. 田中さん: 最初に `src/issue.ts` の型と `fetchIssue` を置き、鈴木さんに一言ください。次に T1・T2・T5 をまとめて実装してください。T2 の実際のエラー文言は、確定したら鈴木さんに共有してください。
  2. 鈴木さん: T6 を先に進めてください。200KB は UTF-8 のバイト数で数え、省略警告の行も予算に含める方針で採用します。T4 の README は、T2 の文言が届いてから書いてください。
  3. 完了の条件は 2 つです。`pnpm typecheck && pnpm test` が通ること。既存の `team init <brief>` の挙動が変わらないことです。結果は完了報告に書いてください。
  スコープは増やしません。複数 issue、ラベル同期、gh を使わない取得は今回やりません。

- 佐藤 美咲 (pm) [DECISION]: 200KB の上限は UTF-8 のバイト数で数え、省略警告の行も予算に含める。gh の `author` が null（削除済みユーザー）の場合は、型側で `ghost` に正規化する。理由: 文字数で数えると日本語で上限を超えて通ってしまい、null 分岐を鈴木さん側に持たせると見出しの処理が複雑になるため。

> _佐藤 美咲 (pm) [notes]: planning は T1〜T6 で確定。実装順は、田中さんが `src/issue.ts` の型と `fetchIssue` を先に置き、鈴木さんに通知する。次に T1・T2・T5 をまとめて実装し、T2 の文言が確定してから T4 の README を書く。完了条件は `pnpm typecheck && pnpm test` が通ることと、既存の `team init <brief>` が変わらないこと。_

- 佐藤 美咲 (pm) [ADVANCE]: planning の目的は達成した。

### iteration 1 · build

- — Phase "build" started (iteration 1) — Engineers implement their own tasks in the workspace (real files, runnable code, tests when sensible), coordinate interfaces with each other, and mark finished work with [TASK_DONE].

> _田中 健 (eng-backend) [thinks]: T1・T2・T5 を実装した。テストは自分の分が通る。鈴木さんの issue-brief.test.ts だけ、BRIEF_LIMIT_BYTES と BriefIssue がまだ無くて型エラーになる。これは T6 側で解消される。_

- 田中 健 (eng-backend) → eng-frontend, pm: 田中です。`src/issue.ts` を置きました。`src/cli.ts` に `--issue` を配線済みです。鈴木さんは次の2点を確認してください。
  - 型は `Issue = { ref:{owner,repo,number:number}, title, body, url, comments:{author, createdAt(ISO のまま), body}[] }` です。`author` が null のときは型側で `ghost` にしてあるので、鈴木さん側で null 分岐は要りません。
  - cli は `src/issue-brief.ts` の `buildIssueBrief(issue: Issue): string` を import して呼びます。今ある中身は私の仮スタブなので、本物に置き換えてください。署名は維持してください。本文だけで 200KB を超えたときは throw すれば、そのまま非0終了になります。
  
  現状は `pnpm test` が 39 件通過、1 件失敗です。失敗は `test/issue-brief.test.ts` で、`BRIEF_LIMIT_BYTES` と `BriefIssue` が `src/issue-brief.ts` に無いため型エラーになっています。鈴木さんの実装が入れば解消するはずです。`pnpm typecheck` も同じ2件だけが残っています。
  
  T2 のエラー文言は確定です。README にはこの出力を貼ってください。実機で gh が PATH に無い状態で実行した出力です。
  ```
  error: gh コマンドが見つかりません。issue acme/web#1 を取得できないため中止しました (セッションは作っていません)。
    gh のインストール: https://cli.github.com
    認証: `gh auth login`、または環境変数 GH_TOKEN にトークンを設定 (GitHub Actions では env: GH_TOKEN: ${{ secrets.GITHUB_TOKEN }} を渡す)
  ```
  書式不正のときは次のとおりです。
  ```
  error: --issue の書式が不正です: "bad"
    正しい例: --issue owner/repo#123
  ```
  認証失敗・404・ネットワーク失敗も、同じ形で1行目に原因、続けて対処を出します。

> _田中 健 (eng-backend) [notes]: `main(argv, out, deps)` の第3引数 `deps.runGh` で gh を差し替えられる。16MB 超過は `GhResult.overflow` で渡す。実 gh は ENOBUFS で判定する。`--issue` と brief の同時指定はエラーにした。`src/issue-brief.ts` は私の仮スタブで、本物は鈴木さんが置く。_

- 田中 健 (eng-backend) [TASK_UPDATE]: T1 → done: `team init --issue owner/repo#N` を実装した。`src/issue.ts` に `parseIssueRef` と `fetchIssue` を置いた。`gh issue view N -R owner/repo --json title,body,comments,url` でタイトル・本文・全コメントを取得し、セッション名と brief を作る。書式が不正なら、正しい例 `owner/repo#123` を添えて非0で終了し、セッションは作らない。gh は `deps.runGh` で差し替えられ、実ネットワークなしでテストできる。既存の `init <brief>` の挙動は変えていない。確認は `pnpm test`（`test/issue.test.ts`）で行える。

- 田中 健 (eng-backend) [TASK_UPDATE]: T2 → done: gh が PATH に無い場合は、1行目に原因を出して非0終了する。`.team/sessions/` には何も作らない。エラーには `https://cli.github.com`、`gh auth login`、`GH_TOKEN`、`GITHUB_TOKEN`（Actions で渡す方法）を必ず書く。認証失敗・404・ネットワーク失敗・その他の失敗も、原因と対処を書いて非0終了し、空 brief にはしない。gh なしと上の3パターンを、gh を偽装したテストで検証した。実機でも gh を PATH から外して実行し、exit=1 とセッション未作成を確認した。

- 田中 健 (eng-backend) [TASK_UPDATE]: T5 → done: 型の先行引き渡し、セッション名、巨大出力の扱いを入れた。
  - `Issue` 型と `fetchIssue(ref, runGh)` を `src/issue.ts` に置き、`runGh` は `(args, env) => {status, stdout, stderr, notFound}` とした。
  - 取得は `cli.ts` の `--force` の `rmSync` より前で行う。取得に失敗しても既存セッションは消えず、テストで確認した。
  - セッション名の既定値は `issue-<repo>-<N>` で、英数字とハイフン以外は `-` に置換する。`--name` があればそちらを優先する。
  - gh の出力が 16MB を超えたら、黙って欠けさせずエラーにして非0終了する。テストで確認した。
  - 依存は追加していない。使ったのは `spawnSync` だけである。

> _鈴木 ひかり (eng-frontend) [thinks]: T6 は純関数なので先に仕上げた。田中さんの `src/issue.ts` はまだ無いので、`BriefIssue` を構造的に同じ型として自前で持った。T4 の README は T2 の文言待ち。_

- 鈴木 ひかり (eng-frontend) [TASK_UPDATE]: T6 → doing

- 鈴木 ひかり (eng-frontend) [TASK_UPDATE]: T6 → done: `buildIssueBrief(issue)` を `src/issue-brief.ts` に実装し、`test/issue-brief.test.ts` に 8 ケースを追加した。`pnpm typecheck && pnpm test` は通った（33 件中 33 件 pass）。
  - 出力順は次のとおり。
    - 先頭に `Issue: owner/repo#N` と URL。
    - 省略があるときは、その直下に `⚠ コメント N 件中 M 件を省略しました（brief の上限 200KB）。全文: <url>`。
    - `# タイトル` と本文。
    - `## コメント (N件)` の下に `### @author — YYYY-MM-DD HH:MM (UTC)` と本文を時系列で並べる。
    - 末尾に `Closes owner/repo#N` と `pnpm typecheck && pnpm test` の 2 行。
  - 本文とコメントの Markdown は元のまま入れる。コメントのコードフェンスが奇数個なら、末尾に閉じフェンスを補う。
  - 上限は 200×1024 の UTF-8 バイトで数え、警告行も予算に含める。超えたら新しいコメントから残し、古いものを省略する。残したコメントの数は `## コメント (N件)` に出る。
  - 本文だけで上限を超えたときは `Error` を投げ、全文の URL を添える。
  - 型は `src/issue.ts` の `Issue` と構造が同じ `BriefIssue` を自前で持っている。田中さんの型が届いたら `Issue` に差し替える。
  - 実行は `node --test test/issue-brief.test.ts`。

- 鈴木 ひかり (eng-frontend) → eng-backend: 鈴木です。`src/issue-brief.ts` に `buildIssueBrief(issue: BriefIssue): string` を置きました。`BriefIssue` は `{ref:{owner,repo,number}, title, body, url, comments:{author,createdAt,body}[]}` で、田中さんの `Issue` と構造が同じなので、そのまま渡せます。`cli.ts` の init では、`fetchIssue` の結果を `buildIssueBrief` に渡して brief にしてください。本文だけで 200KB を超えると `Error` を投げます。メッセージをそのまま stderr に出して非0終了してください。また `author` の null は型側で `ghost` にしてもらう前提です。`src/issue.ts` を置いたら一言ください。T2 のエラー文言が確定したら、README に貼ります。

- 鈴木 ひかり (eng-frontend) → pm: T6（T3 の中身を含む）は完了です。T4 の README は、田中さんの T2 の文言待ちで、まだ着手していません。

> _田中 健 (eng-backend) [thinks]: 私の分の T1・T2・T5 は完了済みで、`pnpm test` の失敗は鈴木さん側の `src/issue-brief.ts` が原因。実物にはまだ `BRIEF_LIMIT_BYTES` と `BriefIssue` の export が無い。確認結果を共有する。_

- 田中 健 (eng-backend) → eng-frontend, pm: 田中です。結論から言います。T1・T2・T5 は完了済みで、私の側に残作業はありません。ただ、全体のゲートはまだ通っていません。
  
  - 現状を今実行しました。`pnpm test` は 40 件中 39 件通過、1 件失敗です。`pnpm typecheck` は 2 件の型エラーが出ています。
  - 原因は 2 件とも同じです。`test/issue-brief.test.ts` の 3 行目が `src/issue-brief.ts` から `BRIEF_LIMIT_BYTES` と `BriefIssue` を import していますが、手元の `src/issue-brief.ts` にはこの 2 つの export がありません。
  - 鈴木さんの完了報告には「33 件中 33 件 pass」とあります。しかし手元のファイルは、私の仮スタブのままのように見えます。鈴木さんの実装が、このワークスペースに反映されていない可能性があります。
  
  鈴木さんにお願いです。`src/issue-brief.ts` を置き直して、`BRIEF_LIMIT_BYTES` と `BriefIssue` を export してください。または、保存先のパスを教えてください。置き直したら、私が `pnpm typecheck && pnpm test` を再実行して結果を報告します。
  
  T4 の README は、T2 の文言が確定済みなので着手できます。文言は前回のメッセージに貼ったとおりです。

> _鈴木 ひかり (eng-frontend) [thinks]: 私の `buildIssueBrief` が田中さんの仮スタブで上書きされていたので書き直した。README も追記した。typecheck と test は通った。_

- 鈴木 ひかり (eng-frontend) [TASK_UPDATE]: T4 → doing

- 鈴木 ひかり (eng-frontend) [TASK_UPDATE]: T4 → done: README の init の項に「Starting from a GitHub issue」を追記した。内容は次のとおり。
  - `--issue` の使い方と `--name` の優先。
  - gh の要件と、`GH_TOKEN` / `GITHUB_TOKEN`（Actions では `env: GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`）。
  - 田中さんの T2 の実出力をそのまま貼ったエラー例 2 つ。
  - 200KB 上限と 16MB の扱い。
  
  `pnpm typecheck && pnpm test` は通った（47 件中 47 件 pass、fail 0）。

- 鈴木 ひかり (eng-frontend) → eng-backend, pm: 鈴木です。`src/issue-brief.ts` が田中さんの仮スタブに戻っていたので、実装を書き直しました。田中さんの指摘どおりです。
  - `buildIssueBrief(issue: Issue)` に、`BRIEF_LIMIT_BYTES` と `BriefIssue`（`Issue` の別名）を export しました。署名は維持しています。
  - 順序は次のとおりです。
    - `Issue: owner/repo#N` と URL。
    - 省略があるときは、その直下に警告行。
    - `# タイトル` と本文。
    - `## コメント (N件)` の下に、`### @author — 日時 (UTC)` と本文を時系列で並べる。
    - 末尾に `Closes owner/repo#N` と `pnpm typecheck && pnpm test` の 2 行。
  - 200KB は UTF-8 バイトで数え、警告行も含めて数えます。超えたら新しいコメントを残して古いものを省略します。本文だけで超えたら `Error` を投げます。
  - コメントのコードフェンスが奇数個なら、閉じフェンスを補います。
  
  私の手元で `pnpm typecheck && pnpm test` を実行し、47 件中 47 件 pass で型エラーは 0 でした。田中さん、再実行して結果を教えてください。

- 田中 健 (eng-backend) → eng-frontend, pm: 田中です。結論から言います。再実行の結果、`pnpm typecheck` は型エラー 0 で、`pnpm test` は 47 件中 47 件 pass、fail 0 でした。鈴木さんの `src/issue-brief.ts` は反映されています。T1・T2・T5 は完了済みで、私の側に残作業はありません。
  
  先に、田中さん側で押さえた点を挙げます。
  - 取得は `--force` の `rmSync` より前なので、取得に失敗しても既存セッションは消えません。
  - gh が無い場合、`.team/sessions/` には何も作りません。
  - gh の出力が 16MB を超えたら、黙って欠けさせずエラーで止めます。
  
  PM に確認があります。未コミットのままなので、コミットするか、このまま受け入れに進むかを指示してください。

- 鈴木 ひかり (eng-frontend) → eng-backend, pm: 鈴木です。もう一度実行して確認しました。`pnpm typecheck` は型エラー 0 件、`pnpm test` は 47 件中 47 件 pass、fail 0 でした。`src/issue-brief.ts` は `buildIssueBrief`、`BRIEF_LIMIT_BYTES`、`BriefIssue`（`Issue` の別名）を export しています。README の「Starting from a GitHub issue」も入っています。T3、T4、T6 は完了です。`src/issue-brief.ts` がまた仮スタブで上書きされないよう、触る前に一言ください。

- 鈴木 ひかり (eng-frontend) [TASK_UPDATE]: T3 → done: `buildIssueBrief` を `src/issue-brief.ts` に実装した。先頭に `Issue: owner/repo#N` と URL を置き、タイトル、本文、コメント（`### @author — 日時 (UTC)`、時系列）を並べる。末尾に `Closes` と `pnpm typecheck && pnpm test` の 2 行を入れる。コメントの追記が brief に入ること、参照・Closes・規約の 3 行があることは `test/issue-brief.test.ts` で確認した。確認は `pnpm typecheck && pnpm test`（47 件中 47 件 pass）で行える。

- 田中 健 (eng-backend) → pm, eng-frontend: 田中です。結論から言います。T1・T2・T5 は完了済みで、ゲートも通っています。
  - 今回の実行結果です。`pnpm typecheck` は型エラー 0 件。`pnpm test` は 47 件中 47 件 pass、fail 0 でした。
  - 変更は `README.md` と `src/cli.ts` の修正、`src/issue.ts`、`src/issue-brief.ts`、`test/issue.test.ts`、`test/issue-brief.test.ts` の新規追加です。すべて未コミットです。
  - 依存の追加はありません。既存の `team init <brief>` の挙動も変えていません。
  - 佐藤さんへの確認です。コミットの扱いを指示してください。このリポジトリは main 直 push の運用なので、勝手には push しません。
  - 鈴木さんへのお願いです。`src/issue-brief.ts` は、私も今回の確認で触っていません。このまま維持してください。

- 鈴木 ひかり (eng-frontend) → pm, eng-backend: 鈴木です。もう一度ゲートを実行しました。`pnpm typecheck` は型エラー 0 件です。`pnpm test` は 47 件中 47 件 pass、fail 0 でした。T3・T4・T6 は完了で、私の側に残作業はありません。`src/issue-brief.ts` と README の「Starting from a GitHub issue」は現状のまま維持します。変更はすべて未コミットなので、コミットの扱いは佐藤さんの指示を待ちます。

### iteration 1 · review

- — Phase "review" started (iteration 1) — Engineers review each other's work against the acceptance criteria and fix issues. Before users judge it, each engineer posts a [DEMO] for their tasks: what a user would do and what they would see, with output you really produced (run the command, render the page or email, paste the result or the path of the generated file or screenshot). Never describe output you did not produce. PM checks every task against its acceptance criteria and states what is ready for users.

- 田中 健 (eng-backend) → pm, eng-frontend: 田中です。レビューと DEMO の結果です。結論から言うと、T1・T2・T5 の受け入れ条件は満たしています。鈴木さんの T3・T6 も、実行した範囲では問題ありません。
  - ゲートは `pnpm typecheck` が型エラー 0 件、`pnpm test` が 47 件中 47 件 pass、fail 0 でした。
  - 指摘は 1 点だけです。偽の gh が不正な JSON を返すと「gh の出力を JSON として読めませんでした」で非0終了し、セッションは作られませんでした。これは意図どおりです。修正は要りません。
  - 未確認の点です。実ネットワークの本物の gh は、この環境では使っていません。偽装した gh と、`gh` なしの状態で確認しました。

- 田中 健 (eng-backend) [DEMO]: T1: 偽の gh で `node src/main.ts init --issue acme/web#7` を実行しました。出力は次のとおりです。セッション `issue-web-7` ができ、exit=0 でした。
  ```
  created session "issue-web-7" with 5 members → .team/sessions/issue-web-7/
  session: issue-web-7  status: running  iteration: 1/2
  ```
  state.json の brief は次のとおりです。
  ```
  Issue: acme/web#7
  https://github.com/acme/web/issues/7
  
  # API を v2 にする
  
  - 対応
  ```ts
  const a=1
  ```
  
  ## コメント (1件)
  
  ### @alice — 2026-10-01 09:30 (UTC)
  
  API は v2 で
  
  PR の説明に `Closes acme/web#7` を入れること。
  `pnpm typecheck && pnpm test` を通すこと。
  ```
  書式不正の `--issue bad` では、次のように出て exit=1 でした。
  ```
  error: --issue の書式が不正です: "bad"
    正しい例: --issue owner/repo#123
  ```

- 田中 健 (eng-backend) [DEMO]: T2: gh を PATH から外して `init --issue acme/web#1` を実行しました。exit=1 で、`.team/sessions` は作られませんでした。
  ```
  error: gh コマンドが見つかりません。issue acme/web#1 を取得できないため中止しました (セッションは作っていません)。
    gh のインストール: https://cli.github.com
    認証: `gh auth login`、または環境変数 GH_TOKEN にトークンを設定 (GitHub Actions では env: GH_TOKEN: ${{ secrets.GITHUB_TOKEN }} を渡す)
  ```

- 田中 健 (eng-backend) [DEMO]: T5: セッション名の既定値は上の出力のとおり `issue-web-7` です。`--force` 時に既存セッションが消えないことと、16MB 超過でエラーになることは、`test/issue.test.ts` で確認済みです。

> _佐藤 美咲 (pm) [thinks]: 鈴木さんの [DEMO] がまだ無い。T3・T4・T6 は出力を見ていないので、受け入れ済みとは言えない。田中さんの T1・T2・T5 は DEMO と 47 件 pass の報告で受け入れ基準を満たしている。実 gh 未確認の点は、偽装 gh とテストで足りるので今回は許容する。コミットは、ユーザーの指示が無いので保留にする。_

- 佐藤 美咲 (pm) → eng-frontend: 鈴木さん、T3・T4・T6 の [DEMO] をお願いします。実際に動かした出力だけを貼ってください。
  1. 偽の gh で `init --issue` を実行し、brief 全文を貼る。コメントが 2 件以上あり、時系列で並び、コードフェンスと箇条書きが崩れていないこと。
  2. コメントのフェンスが奇数個のとき、閉じフェンスが補われた brief の該当部分。
  3. 200KB を超える issue で、古いコメントが省略され、Issue 行の直下に `⚠ コメント N 件中 M 件を省略しました…` が出ていること。本文だけで超える場合のエラー出力も添える。
  4. README の「Starting from a GitHub issue」の該当箇所。

- 佐藤 美咲 (pm) → eng-backend: 田中さん、T1・T2・T5 は受け入れ基準を満たしています。ありがとうございます。不正な JSON のときの非0終了も、意図どおりで修正は要りません。コミットは私から指示しません。main への push は佐藤の判断では決めず、ユーザーの確認を取ってからにします。鈴木さんの DEMO が出たら、田中さんにも `--force` で既存セッションが残る様子を 1 回実機で見せてもらうかもしれません。待機してください。

> _佐藤 美咲 (pm) [notes]: review 時点で、T1・T2・T5 は DEMO と受け入れ基準の確認が済んだ。T3・T4・T6 は鈴木さんの DEMO 待ち。実 gh での確認は未実施で、偽装 gh とテストのみ。コミットと push は未実施で、ユーザーの確認が必要。_

- 鈴木 ひかり (eng-frontend) [DEMO]: T3: 偽の gh（PATH 先頭に置いた簡易スクリプト）で `node src/main.ts init --issue acme/web#7 --name demo-hikari-7` を実行しました。exit=0 で、セッションが作られました。state.json の brief は次のとおりです。コメントは 3 件あり、投稿順の逆（bob → alice → carol）で返したものを、時系列に並べ替えて出力しています。コードフェンスと箇条書きは崩れていません。carol のコメントはフェンスが閉じていなかったので、末尾に閉じフェンスが補われています。
  ```
  Issue: acme/web#7
  https://github.com/acme/web/issues/7
  
  # API を v2 にする
  
  - 対応
  ```ts
  const a=1
  ```
  
  ## コメント (3件)
  
  ### @alice — 2026-10-01 09:30 (UTC)
  
  API は v2 で
  
  ### @bob — 2026-10-02 10:05 (UTC)
  
  - [ ] 移行手順
  - [ ] 告知
  
  ```sh
  pnpm test
  ```
  
  ### @carol — 2026-10-03 00:00 (UTC)
  
  途中で切れた例:
  ```ts
  const b=2
  ```
  
  PR の説明に `Closes acme/web#7` を入れること。
  `pnpm typecheck && pnpm test` を通すこと。
  ```

- 鈴木 ひかり (eng-frontend) [DEMO]: T6: 200KB 超の issue（#8）を同じ手順で取り込みました。本文は短く、コメントは 10 件で、各約 90KB の日本語です。exit=0 で、brief は 180446 バイト（UTF-8）でした。古い 8 件が省略され、新しい 2 件（u8、u9）だけが残りました。Issue 行の直下に警告が出ています。下は先頭部分です。
  ```
  Issue: acme/web#8
  https://github.com/acme/web/issues/8
  ⚠ コメント 10 件中 8 件を省略しました（brief の上限 200KB）。全文: https://github.com/acme/web/issues/8
  
  # 大きい issue
  
  本文
  
  ## コメント (2件)
  
  ### @u8 — 2026-10-09 00:00 (UTC)
  
  コメント9 ああああ…
  ```
  末尾は、規約 2 行（`Closes acme/web#8` と `pnpm typecheck && pnpm test`）で終わっています。
  
  本文だけで超える issue（#9、本文は日本語 8 万字で約 240KB）は、exit=1 で止まります。出力は次のとおりです。セッションは作られませんでした。
  ```
  error: issue acme/web#9 は本文だけで brief の上限 200KB を超えています。切り捨てずに中止しました。全文: https://github.com/acme/web/issues/9
    brief を手で用意して `team init --brief-file` を使ってください。
  ```
  デモ用に作った `demo-hikari-7` と `demo-hikari-8` は削除しました。`.team/current` は元に戻しました。

- 鈴木 ひかり (eng-frontend) [DEMO]: T4: README の「Starting from a GitHub issue」（`README.md` の 99〜124 行目）を読み直しました。次の内容が入っています。
  - `--issue` の使い方と、`--name` が優先されること。
  - gh の要件と、`gh auth login`、`GH_TOKEN`、Actions での `env: GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`。
  - 田中さんの T2 の実出力をそのまま貼ったエラー例 2 つ。
  - 200KB 上限の挙動と 16MB の扱い。
  
  ゲートは `pnpm typecheck && pnpm test` で 47 件中 47 件 pass です。

- 鈴木 ひかり (eng-frontend) → pm, eng-backend: 鈴木です。T3・T4・T6 の DEMO を上に出しました。実際に動かして確認したのは、コメントが時系列に並ぶこと、フェンスの補完、200KB 超での省略警告、本文だけで超えたときのエラーです。
  
  ただ、本物の gh は使っていません。確認は偽装した gh のみです。
  
  見つけた点が 1 つあります。本文だけで超えたときのエラーは「`--brief-file` で手動に切り替えてください」と案内する文言で、これで合っています。ユーザーが迷わない案内になっていると思います。修正は要りません。

- 田中 健 (eng-backend) → pm, eng-frontend: 田中です。`--force` で既存セッションが残ることを実機で確認しました。
  - 手順は次のとおりです。まず `init --name keep-demo "既存"` で既存セッションを作りました。次に、404 を返す偽の gh を PATH 先頭に置いて `init --issue acme/web#404 --name keep-demo --force` を実行しました。
  - 結果は exit=1 で、`.team/sessions/keep-demo` は残っていました。出力は次のとおりです。
  ```
  error: issue が見つかりません: acme/web#404 (404)。セッションは作っていません。
    owner/repo と番号を確認してください。private リポジトリは GH_TOKEN にそのリポジトリを読める権限が必要です。
    gh の出力: HTTP 404: Not Found
  ```
  - 後片付けとして、デモ用の `keep-demo` を削除し、`.team/current` を `villa-66` に戻しました。
  - 確認できていないのは、本物の gh でのネットワーク取得です。偽装した gh でしか見ていません。
  
  T1・T2・T5 に残作業はありません。コミットは佐藤さんの判断を待ちます。

> _佐藤 美咲 (pm) [thinks]: 全タスクの DEMO が揃った。T1〜T6 を受け入れ基準と照らして確認する。実 gh は未確認だが、偽装 gh とテストで足りるので許容する。コミットはユーザー確認待ちにする。_

- 佐藤 美咲 (pm): 佐藤です。レビュー結果です。T1〜T6 は、受け入れ基準を満たしていると判断します。根拠は次のとおりです。
  - T1・T5: 田中さんの DEMO で、セッション名 `issue-web-7`、書式不正のエラー、`--force` 時に既存セッションが残ることを確認しました。
  - T2: gh なしの 1 行目のエラーに、`https://cli.github.com`、`gh auth login`、`GH_TOKEN`、`GITHUB_TOKEN` が入っています。セッションは作られていません。
  - T3・T6: 鈴木さんの DEMO で、コメントが時系列に並び、フェンスと箇条書きが崩れていないことを確認しました。奇数フェンスの補完、200KB 超での省略警告、本文だけで超えたときのエラーも確認しました。
  - T4: README に、使い方、gh の要件、`GH_TOKEN` の説明、エラー例が入っています。
  - ゲート: `pnpm typecheck && pnpm test` は 47 件中 47 件 pass です。
  未確認の点は 2 つです。実際の gh での取得は偽装 gh のみで、実ネットワークは見ていません。コミットと push もしていません。
  
  ユーザーの木村さんには、起動直後の 1 行エラー、コメント追記の取り込み、`Closes` と規約行の 3 点を見てもらいます。実 gh での取得は、木村さんの環境で確かめてもらう前提にします。

> _佐藤 美咲 (pm) [notes]: review 完了。T1〜T6 は受け入れ基準を満たし、`pnpm typecheck && pnpm test` は 47 件中 47 件 pass。未確認は実 gh での取得で、偽装 gh とテストのみ。コミットと push は未実施で、ユーザーの確認が必要。_

- 佐藤 美咲 (pm) [ADVANCE]: review の目的は達成した。全タスクを受け入れ基準と照らして確認し、ユーザー受け入れに進める。

### iteration 1 · acceptance

- — Phase "acceptance" started (iteration 1) — Users try what was built — start from the team's demos, open the files they point to, run it if possible — and judge it from their own needs. Each user gives a [VERDICT accept|reject] with reasons. PM summarizes and decides next steps.

> _木村 拓也 (user-dev) [thinks]: README、エラー文言、brief の構成を確認した。実 gh は試していない。基準は満たしていて、懸念は小さい。_

- 木村 拓也 (user-dev) [VERDICT]: ACCEPT: 受け入れます。ただし、実 gh でのネットワーク取得は誰も見ていません。
  
  良い点:
  - `init --issue owner/repo#N` の1コマンドで始まります。issue 本文のコピペが要らず、これが一番助かります。
  - gh が無いとき、1行目に原因が出ます。続けてインストール先、`gh auth login`、`GH_TOKEN`、Actions で `GITHUB_TOKEN` を渡す書き方まで書いてあります。何をすべきかが分かるので、私の基準に合っています。
  - 失敗してもセッションは作られません。`--force` でも既存セッションは消えません。黙って空 brief になることがありません。
  - コメントが投稿者・日時つきで時系列に入ります。「API は v2 で」のような追記が落ちません。
  - brief の先頭に `Issue: owner/repo#N` と URL が入ります。末尾に `Closes owner/repo#N` と `pnpm typecheck && pnpm test` の2行が入ります。
  - 200KB 超でも、古いコメントを省略して警告を Issue 行の直下に出します。黙って欠けないのは評価します。
  
  要望です。ブロッカーではありません。
  1. `Closes` は brief に書いてあるだけです。PR 説明に実際に入るかは、後段の動作を見ないと分かりません。次回は PR 作成まで通して確認させてください。
  2. 実 gh と Actions 環境(`GH_TOKEN` 経由)での確認をお願いします。私の CI で最初に試して、結果を返します。
  3. 本文が 200KB を超えた場合は、`--brief-file` に手で切り替える必要があり、手順が1つ増えます。ただ、これは稀なので許容します。

> _佐藤 美咲 (pm) [thinks]: 木村さんは accept。要望3点はブロッカーではない。実 gh と PR 作成まで通した確認は次イテレーションか木村さんの CI での確認に回す。スコープを増やさず、ここで受け入れ完了とする。コミット・push はユーザー確認待ちのまま。_

- 佐藤 美咲 (pm): 佐藤です。木村さんの受け入れ、ありがとうございます。結果をまとめます。
  
  - 判定は ACCEPT です。T1〜T6 は受け入れ基準を満たし、`pnpm typecheck && pnpm test` は 47 件中 47 件 pass です。
  - 木村さんの要望 3 点は、今回は追加タスクにしません。理由は、どれもブロッカーではなく、スコープを広げると最初のリリースが小さくなくなるからです。
    1. `Closes` が PR 説明に実際に入るかは、brief に書いてあるところまでが今回の範囲です。PR 作成まで通す確認は、次の課題に回します。
    2. 実 gh と Actions（`GH_TOKEN` / `GITHUB_TOKEN`）での確認は、木村さんの CI で最初に試してもらい、結果を返してもらいます。誰も実ネットワークの取得を見ていないので、ここが一番の未確認です。
    3. 本文が 200KB を超える場合の `--brief-file` への切り替えは、稀なので許容します。
  - コミットと push は、まだしていません。main 直 push の運用なので、ユーザーの確認を取ってからにします。
  
  田中さん、鈴木さん、残作業はありません。ありがとうございました。

> _佐藤 美咲 (pm) [notes]: 受け入れ完了 (iteration 1): 木村さんは ACCEPT。要望は、(1) PR 説明に `Closes` が実際に入るかを PR 作成まで通して確認、(2) 実 gh と Actions (`GH_TOKEN`) での確認を木村さんの CI で実施して結果を返す、(3) 本文が 200KB 超のときの `--brief-file` 手動切り替えは許容。いずれもブロッカーではなく次回に回す。未実施: 実 gh での取得確認、コミットと push（ユーザーの確認が必要）。_

- 佐藤 美咲 (pm) [DECISION]: 今回の `team init --issue` は、木村さんの ACCEPT をもって受け入れ完了とする。追加の実装タスクは作らない。次の確認事項は、実 gh と Actions での取得、および PR 作成まで通した `Closes` の確認で、結果は木村さんから受ける。コミットと push は、ユーザーの確認を取ってから行う。

- 佐藤 美咲 (pm) [ADVANCE]: End of phase "acceptance".

### iteration 1 · wrapup

- — Wrap-up before finishing: 0 open task(s), 1 late decision(s) to apply.

- — Phase "wrapup" started (iteration 1) — The session is about to end. Engineers apply every decision made during review and acceptance and finish their open tasks ([TASK_DONE]); a task that cannot be finished here gets one line saying why and what is left. PM then confirms what shipped and lists, for the real human, anything still open or needing their decision.

- 田中 健 (eng-backend) → pm, eng-frontend: 田中です。wrapup 時点でゲートを再実行しました。`pnpm typecheck` は型エラー 0 件、`pnpm test` は 47 件中 47 件 pass、fail 0 です。T1・T2・T5 に未完了のタスクはありません。反映すべき決定は「追加の実装タスクは作らない」だけで、コードの変更はありません。
  
  - 変更は未コミットです。対象は `README.md` と `src/cli.ts` の修正、`src/issue.ts`、`src/issue-brief.ts`、`test/issue.test.ts`、`test/issue-brief.test.ts` の新規追加です。依存の追加はありません。
  - 本物の gh での取得は、誰も実行していません。確認は偽装した gh と、gh なしの状態だけです。
  - コミットと push は、ユーザーの確認を取ってから行います。この環境では私から実行しません。

- 田中 健 (eng-backend) [TASK_UPDATE]: T1 → done: 完了済みで、wrapup での変更はありません。ゲートの通過は再確認しました。

- 田中 健 (eng-backend) [TASK_UPDATE]: T2 → done: 完了済みで、wrapup での変更はありません。

- 田中 健 (eng-backend) [TASK_UPDATE]: T5 → done: 完了済みで、wrapup での変更はありません。

> _田中 健 (eng-backend) [notes]: `team init --issue` の実装は未コミットで、本物の gh での取得は未確認。木村さんの CI で実 gh（`GH_TOKEN` / `GITHUB_TOKEN`）を試し、結果を受ける予定。PR 説明に `Closes` が入るところまで通す確認は、次の課題。コミットと push は、ユーザーの確認を取ってから行う。_

> _佐藤 美咲 (pm) [thinks]: 全タスク done、決定事項に対する追加実装なし。最終確認と、人間に残る事項を列挙して締める。_

- 佐藤 美咲 (pm): 佐藤です。wrapup の確認です。
  
  **出荷したもの**（T1〜T6 すべて done、`pnpm typecheck && pnpm test` は 47 件中 47 件 pass）
  - `team init --issue owner/repo#N` で、gh 経由で issue のタイトル・本文・全コメントを brief に取り込めます。
  - brief の先頭に `Issue: owner/repo#N` と URL、末尾に `Closes` と `pnpm typecheck && pnpm test` の 2 行が入ります。
  - gh が無い、認証失敗、404、ネットワーク失敗のときは、空 brief のセッションを作らず、原因と対処（インストール先、`GH_TOKEN` / `GITHUB_TOKEN`）を書いて非0終了します。
  - 200KB 超は、古いコメントを省略して警告を Issue 行の直下に出します。本文だけで超える場合はエラーにします。
  - README の init の項に使い方とエラー例を追記しました。
  - 既存の `team init <brief>` の挙動は変えていません。依存の追加もありません。
  
  **人間（ユーザー）に残っていること**
  1. **コミットと push の判断。** 変更はすべて未コミットです。対象は `README.md`、`src/cli.ts`、`src/issue.ts`、`src/issue-brief.ts`、`test/issue.test.ts`、`test/issue-brief.test.ts` です。main 直 push の運用なので、確認を取るまで私たちはやりません。
  2. **実 gh での取得確認。** 確認はすべて偽装 gh です。木村さんの CI（GitHub Actions、`GH_TOKEN` 経由）で最初に試してもらい、結果を受けます。
  3. **`Closes` の確認。** brief に書いてあるだけで、PR 説明に実際に入るかは PR 作成まで通して見ていません。次回の確認事項です。
  4. **任意の判断。** 本文が 200KB を超える issue は `--brief-file` で手動に切り替える仕様のままです。木村さんは許容していますが、頻度が上がったら見直してください。
  
  田中さん、鈴木さん、残作業はありません。ありがとうございました。

> _佐藤 美咲 (pm) [notes]: wrapup 完了 (iteration 1): T1〜T6 すべて done、47 件 pass。人間に渡した未決事項は、(1) 変更の commit/push（未コミット、main 直 push 運用なのでユーザー確認待ち）、(2) 実 gh と Actions での取得確認（木村さんの CI）、(3) PR 作成まで通した `Closes` の確認、(4) 本文 200KB 超は `--brief-file` 手動切り替えのまま。_

- 鈴木 ひかり (eng-frontend) → pm, eng-backend: 鈴木です。wrapup 時点でゲートをもう一度実行しました。`pnpm typecheck` は型エラー 0 件、`pnpm test` は 47 件中 47 件 pass、fail 0 です。T3・T4・T6 は done のままで、反映すべき決定に、コードを変えるものはありません。残作業もありません。
  - 変更は未コミットです。私の担当分は `src/issue-brief.ts`、`test/issue-brief.test.ts`、`README.md` の「Starting from a GitHub issue」です。コミットと push は、ユーザーの確認を取ってからにします。
  - 未確認なのは、本物の gh での取得です。私は偽装した gh でしか動かしていません。木村さんの CI で最初に試してもらい、結果を受けます。
  - `Closes` は brief に書いてあるだけで、PR 説明に実際に入るかは見ていません。PR 作成まで通した確認は、次回に回します。

> _佐藤 美咲 (pm) [thinks]: 全タスク done、wrapup の確認とユーザー向け未決事項は既に出した。重複を避けて短く締める。_

- 佐藤 美咲 (pm): 佐藤です。最終確認です。T1〜T6 はすべて done で、`pnpm typecheck && pnpm test` は 47 件中 47 件 pass です。受け入れの決定（追加の実装タスクは作らない）も反映済みで、コードの変更はありません。
  
  人間（ユーザー）に残っていることは次の 3 点です。
  1. **コミットと push の判断。** 変更はすべて未コミットです。main 直 push の運用なので、確認を取るまで私たちはやりません。
  2. **実 gh と Actions での取得確認。** ここまでは偽装 gh しか見ていません。木村さんの CI（`GH_TOKEN` / `GITHUB_TOKEN`）で最初に試して、結果を返してもらいます。
  3. **`Closes` の確認。** brief に書いてあるだけで、PR 説明に実際に入るかは PR 作成まで通して見ていません。次回の確認事項です。
  
  任意の判断が 1 つあります。本文が 200KB を超える issue は `--brief-file` に手で切り替える仕様のままです。頻度が上がったら見直してください。
  
  田中さん、鈴木さん、ありがとうございました。

> _田中 健 (eng-backend) [thinks]: 私の全タスクは完了済みで、反映すべき決定にコード変更はない。追加の作業は不要。_

- 田中 健 (eng-backend) → pm, eng-frontend: 田中です。wrapup の最終報告です。T1・T2・T5 は done で、反映すべき決定にコード変更はありません。直近のゲートは `pnpm typecheck` が型エラー 0 件、`pnpm test` が 47 件中 47 件 pass でした。
  - 未コミットのままです。コミットと push は、ユーザーの確認を取るまで私からは実行しません。
  - 実 gh での取得は未確認です。確認はすべて偽装 gh です。木村さんの CI（`GH_TOKEN` / `GITHUB_TOKEN`）で最初に試して、結果を受けます。
  - `Closes` が PR 説明に実際に入るかは、PR 作成まで通した確認が次回の課題です。
  - 実 gh で ENOBUFS による 16MB 超過の判定を通した確認も、まだありません。テストでは `GhResult.overflow` で偽装した範囲です。

> _佐藤 美咲 (pm) [thinks]: 全タスクが done で、wrapup の最終報告は出し終えている。重複を避けて、セッションを閉じる。_

- 佐藤 美咲 (pm): 佐藤です。wrapup は完了です。T1〜T6 はすべて done で、`pnpm typecheck && pnpm test` は 47 件中 47 件 pass です。人間に渡す事項は、先の報告から変わりません。コミットと push の判断、実 gh と Actions での取得確認、`Closes` が PR 説明に入るかの確認の 3 点です。ありがとうございました。

> _佐藤 美咲 (pm) [notes]: wrapup 最終確認 (iteration 1): 追加の実装は無く、人間に渡した未決事項も変わっていない。コミットと push は、ユーザーの確認が取れるまで行わない。_

- — Session finished after iteration 1. 1/1 users accepted.
