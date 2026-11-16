# team — PM・エンジニア・ユーザーが会話しながら開発するチームシミュレーター

[English](README.md) | **日本語**

[microsoft/TinyTroupe](https://github.com/microsoft/TinyTroupe) のペルソナ・シミュレーションと、MetaGPT / ChatDev の役割分担型の開発プロセスを組み合わせ、

- **プロダクトマネージャー**（インタビュー・スコープ決定・受け入れ基準）
- **エンジニア（複数）**（設計・実装・相互レビュー。`workspace/<セッション名>/` に実際にコードを書く）
- **ペルソナ＝ユーザー（複数）**（チーム外の人。インタビューに答え、できたものを試して accept / reject する）

が **会話しながら** プロダクトを作っていく仕組みです。

- **どこでも動く**: TypeScript ですが Node.js ≥ 22.18 が `.ts` を直接実行するので、ビルドも実行時依存もありません。Linux / macOS / Windows、ローカル / クラウドで同じように動きます（CI で3 OS をテスト）。
- **Claude Code (Web) でそのまま動く**: API キーは不要です。Claude Code がオーケストレーターになり、メンバーの1ターンずつをロール別のサブエージェントに演じさせます（host モード）。
- **API / CLI で自動実行もできる**: `team run --backend anthropic | claude-cli | mock`（auto モード）。

調査内容と設計の対応は [docs/research.md](docs/research.md) にまとめています。

## 仕組み

```
             ┌──────────────── team エンジン (src/, 状態は .team/sessions/<name>/) ───────────────┐
             │  roster (personas/*.json) · SOP フェーズ · 誰が次に話すか · 会話ログ · backlog · 決定 · 判定 │
             └───────▲───────────────────────────────┬──────────────────────────────────────────┘
       team record   │ 返答 (アクションタグ)            │ team next → 次の話者 + ターン用プロンプト
                     │                               ▼
  host モード: Claude Code (team-dev スキル) ── サブエージェント team-pm / team-engineer / team-persona
  auto モード: team run ── backend: anthropic (API) | claude-cli (claude -p) | mock
```

### フェーズ (SOP)

| フェーズ | 話す人 | 内容 |
|---|---|---|
| discovery | PM, ユーザー | PM がユーザーにインタビュー。具体的なエピソードを掘る。解決策の話はしない |
| planning | PM, エンジニア | PM が受け入れ基準つきタスクを作って担当を決める。エンジニアは実現性・リスク・技術選定を議論 |
| build | エンジニア（**並列**） | 自分のタスクを `workspace/<セッション名>/` に実装し `[TASK_DONE]` |
| review | エンジニア, PM | 相互レビューと修正。PM が受け入れ基準を確認 |
| acceptance | ユーザー, PM | 最初にエンジン自身がチームの `[VERIFY]` コマンドを実行し、本物の出力とファイル (スクリーンショットなど) を**試用ログ**として残す。ユーザーは試用ログとデモから成果物を読んで `[VERDICT accept/reject]`。PM がまとめる |

reject が1件でもあり、イテレーション上限 (`maxIterations`) に達していなければ planning に戻ります。各フェーズは最大ラウンド数で終わるほか、PM が `[ADVANCE]` で早めに切り上げられます。終了したセッションは `team continue` でもう1イテレーション続けられます（[使い方](#使い方)）。

### 会話のルール

エージェントは TinyTroupe の THINK / TALK / DONE を拡張したテキストタグで返答します（`src/protocol.ts`）。

```
[THINK] 本人にしか見えない思考
[SAY to=user-yamada] 指名された人が次に話す（to=all なら全員宛て）
[NOTE] 長期メモ（以降のターンで毎回本人に提示される）
[TASK owner=eng-backend] タイトル
受け入れ基準（次の行から）
[TASK owner=eng-backend replaces=T1] T1 を置き換えるタスク（T1 は閉じる）
[TASK_DONE T1] 何をどのファイルに実装し、どう確認したか（実行したコマンドと結果、または「未実行」）
[TASK_BLOCKED T1] 実機・アカウント・公開など、人にしかできない作業。人が何をすればよいか
[CHECK T1] 作り終えたタスクのうち、人にしか確かめられないこと（実機で試す、など）。タスクは done のまま
[TASK_DROP T1] やらないことにしたタスクを閉じる（PM のみ）。理由を添える。閉じたタスクは再開できない
[ASK_HUMAN] 本物の人にしか答えられない質問と、それまでチームが進める既定の案
[VERIFY] ユーザーと同じ手順でプロダクトを試し、見たものを出力し、スクリーンショットを $TEAM_ARTIFACTS に保存する 1 行のコマンド
[DECISION] チームの決定事項
[VERDICT accept] / [VERDICT reject] 理由・何を見て判断したか・確かめられなかったこと
[ADVANCE] フェーズを終える（PM のみ）
[DONE]
```

ロールごとに使えるアクションが決まっていて（ユーザーはタスクを作れない等）、範囲外のアクションは無視されログに残ります。

## 使い方

### Claude Code (Web / CLI / Desktop) で使う — おすすめ

このリポジトリを開いた Claude Code で:

```
/team-dev フリーランス向けの、ターミナルから数十秒で請求書を作れるツール
```

あとは Claude Code が `team next` → サブエージェント → `team record` を繰り返します。途中で「予算は月1万円までと伝えて」などと話しかければ、`team say` でチーム全員に共有されます。メンバーが `[ASK_HUMAN]` で質問したときは、チームは自分たちの既定の案で先へ進みます。質問には `team status` で id (`Q1`, `Q2`, ...) が付いて見えるので、`team answer Q2 "..."` でその質問に答えます（以降のプロンプトでは答えが既定の案より優先されます）。「discovery だけやって」「次のフェーズまで」のように区切りも指定できます。セッションが終わったあとに「もう1周して、CSV 出力も足して」と頼むこともできます。1イテレーションは最初の1周と同じくらいトークンを使うので、Claude Code は先に確認してから `team continue "..."` を実行します。

- 会話の全文（各メンバーの思考を含む）: `.team/sessions/<name>/transcript.md`。ブラウザで読むなら `transcript.html`（フェーズごとにまとまり、人で絞り込める。本人だけのメモは既定で隠す。`team log --html` でパスを表示し、古いセッションの分も作る）
- 試用ログと証拠のファイル: `.team/sessions/<name>/artifacts/`
- 各返答に実際にかかったもの: `.team/sessions/<name>/usage.jsonl`。記録した返答ごとに1行で、メンバー・フェーズ・イテレーション・プロンプトと返答の文字数、バックエンドが測定した値（トークン数4種: input / cache write / cache read / output、コスト(USD)、所要時間、モデル呼び出し回数）が入ります。失敗した試行の分も含み、2回失敗して、またはタイムアウトして飛ばしたターンには `skipped` が付きます。オーケストレーターが `record --tokens` で渡す1つのトークン数は `reportedTokens` として別に保存し、測定値には足しません。`team stats` はフェーズ別・ロール別に合計し、cache read を他のトークン数に足した合計は出しません。`team stats --json` は `{ session, recorded: true, total, byPhase, byRole }` を出します。各グループにはターン数の内訳（`turns`・`skippedTurns`・`turnsWithoutCost`・`turnsWithoutMeasuredTokens`）が入り、誰も報告しなかった値（`tokens`・`costUsd`・`durationMs`・`modelCalls`・`reportedTokens`）は含みません。使用量の行がないセッション（これより前に保存したもの、まだ何も記録していないもの）は `{ session, recorded: false }` です
- 作られたプロダクト: `workspace/<name>/`（セッションごとに別フォルダ）

#### Claude Code on the web / Claude のプロジェクト

クラウドのセッションでも同じように動きます。コンテナが一時的なので、次の点だけ違います。

- クラウドのセッションが始まると、`.claude/hooks/session-start.sh` が pnpm と開発用の依存をバックグラウンドで入れます。セッションはその完了を待たずに始まります（エンジン本体は Node だけで動きます）。
- セッションの状態と作ったプロダクトは、`.team/sessions/<name>/` と `workspace/<name>/` をコミットして push することで残ります。`team-dev` スキルはフェーズが変わるたびにこれを行います。別のスレッドや後のセッションからは「<name> のセッションを続けて」で、実行中のセッションを再開できます（`team next`）。すでに終了したセッションにもう1イテレーション足すのは `team continue` で、スキルは確認を取ってから実行します。
- プロジェクトでは、1つのスレッドで1つのシミュレーションを回してください。セッションごとにフォルダが分かれているので、スレッド同士が同じファイルを編集することはありません。

### コマンドラインで使う

```bash
node src/main.ts init --brief "作りたいもの" --name my-session   # セッション作成
node src/main.ts status                                          # 要約: task・人の作業・verdict・質問・次の一手 (--full で全文)
node src/main.ts sessions                                        # セッション 1 つにつき 1 行: 状態・結果・最終更新・brief (* が current)
node src/main.ts use my-session                                  # 別のセッションを current にする
node src/main.ts run --backend claude-cli                        # 自動実行 (claude -p で各ターンを実行)
ANTHROPIC_API_KEY=... node src/main.ts run --backend anthropic   # 自動実行 (Messages API を直接呼ぶ)
node src/main.ts run --backend mock                              # LLM なしで流れだけ確認
node src/main.ts log --tail 20 --no-thoughts                     # 会話ログ
node src/main.ts stats                                           # フェーズ別・ロール別の実トークン数とコスト (--json でスクリプト向け)
node src/main.ts say "ターゲットは個人事業主に絞りたい"           # 人間として発言を差し込む
node src/main.ts answer Q2 "公開してよいです"                     # チームの質問 Q2 に答える (id は status に出る)
node src/main.ts continue "CSV 出力も欲しい"                      # 終了したセッションをもう1イテレーション (--iterations N で N 個)
```

`pnpm team <command>` や、`pnpm link --global` して `team <command>` でも同じです。

`team status` は 1 画面に収まる要約です。セッションの状態・フェーズ・イテレーション・ラウンド、brief の先頭、task を 1 行ずつ、**本物の人がやること**（`[TASK_BLOCKED]` で引き継がれた task と、`[CHECK]` で頼まれた確認。省略せず全文）、ユーザーの verdict（accept / reject と理由の先頭。verdict がある最後のイテレーション）、人への質問（未回答は全文、回答済みは 1 行）、同じリポジトリを触る他のセッションとの重なり、次の発言者、次の一手を出します。`team status --full` は従来どおりの全文（フェーズの goal と、各 task の acceptance と result まで）です。`team status --json` は、セッションの状態に `phase`・`next`・`overlaps` を足したもので、変わりません。

`team sessions` はセッション 1 つにつき 1 行です。current に `*`、名前、状態（`running` / `done`）、フェーズ、イテレーション（`2/2`）、結果（終了したセッションは最後のイテレーションで何人が accept したか `1/2 accepted`。verdict が無ければ `no verdict`）、最後の会話ログを書いた時刻（ローカル時刻。読めないときはセッションを作った時刻）、brief の先頭が並びます。名前はセッションのフォルダ名で、`team use` や `--session` が受け取るものです。state が別の名前を持つ（フォルダをコピーした）場合は、その行にそう書きます。読めないセッションはその旨の行になり、一覧は止まりません。

`status`・`init`・`run`・`continue` は、テキスト出力の最後に、そのまま打てる次の一手を `Next:` で出します。質問が未回答なら `team answer <Qn> "<回答>"`、実行中ならそのあとに `team run`（または Claude Code に「<name> のセッションを続けて」と頼む。エンジンは host モードか auto モードかを知らないので両方を出します）、終了していれば `team continue "<追加の要望>"` と `team log --html` です。current ではないセッション（`--session <name>`）には、これらのコマンドに `--session <name>` が付きます。`--json` の出力には出ません。`record` と `next` はセッションが終了したときだけ `Next:` を出します。実行中は、`record` は記録した内容と次の話者だけを出し（host のループが返答のたびに読むため）、`next` はターンのプロンプトを出します。終了済みのセッションへの `answer` も `Next:` を出し、答えをチームが読むのは `team continue` のあとだと添えます。

セッション名は ASCII の英数字・`_`・`-` で、単独の `.` でつなげられます（`villa-57`、`v1.2`）。`--name` を省くと、`init` はローカルの日時を分まで使って名前を付けます（`20261115-1554`。brief からは付けません）。同じ分に 2 つ作ると、次の「同名」の案内が出ます。この時計と `team sessions` の UPDATED 列は、コマンドを実行したマシンのローカル時刻です（クラウドのコンテナでは通常 UTC）。`init` は同名のセッションがあると作らずに、別の `--name` を付ける・`team use <name>` で続ける・`--force` で作り直す、のいずれかを案内します。`--force` が消すのはそのセッションの保存内容すべて（`.team/sessions/<name>/`）で、`workspace/<name>/` のファイルは消しません。残っていれば、新しいチームから見えるので警告します。また、フェーズの `speakers` に、どのメンバーも持たないロールがあれば警告します。警告は stderr に出るので、`--json` の出力はそのまま読めます。

`team continue [<text> | --say <text>] [--iterations N] [--json]` は、`done` のセッションにもう1イテレーション足します。実行中のセッションは exit 1 で止まり、`team next` / `team run` を案内します。

- セッションを running に戻し、`iterationStart` が付いたフェーズ（無ければ、後始末ではない最初のフェーズ）から次のイテレーションを始めます。タスク・決定・ノートは引き継がれます。
- 上限は「終わったイテレーション + N」です（N は 1 以上の整数で既定 1）。5 回中 1 回目で終わったセッションに、使わなかった残り 4 回を足すことはしません。
- フェーズはセッションに保存してあるものをそのまま使います。あとから `team.config.json` や `DEFAULT_PHASES` を変えても反映されません。
- text は `team say` と同じく人間の発言として記録します。引数でも `--say` でも渡せますが、両方は不可です（空も不可）。text が無いときは、人間が何を変えるかを言っていないことをログで PM に伝え、PM がユーザーの verdict の理由・open なタスク・人の確認待ちから次の改善を選びます。発言がプロンプトに載るのは直近の `historyWindow` 件に入っている間だけなので、恒久的な方針は PM に `[DECISION]` にしてもらってください。
- プロダクトのファイルはセッションに含まれません。`workspace/<name>/` が無い・空なら、stderr に警告したうえで続けます（チームが前回の成果物を見られず、受け入れ前の試行も失敗します）。
- `--json` は `next --json` と同じ出力です。終了済みのセッションへの `say` は、誰も読まないので拒否します。`answer` は使え、チームが答えを踏まえて動くのは continue したあとです。`run`・`record`・`next` は、セッションの終了を伝えるときに、次の一手に `continue` を出します。

`.team` はカレントディレクトリ（か `--root`）だけを見ます。親ディレクトリは探しません。`--turns`・`--tail`・`--tokens`・`--duration-ms` は 0 以上の整数だけを受け付けます。`say` と `record` は空の入力を受け付けず、exit 1 で止まって何も記録しません。返答できなかったメンバーには `[SAY to=all] (could not attend this turn)` を記録してください。

host モードを自分で回す場合（他のエージェント基盤から使う場合など）:

```bash
node src/main.ts next --json          # → pending: [{ member, role, subagent, canEdit, promptFile }], openQuestions: [{ id, by, text }]
# promptFile を LLM に渡して返答を得る
node src/main.ts record --as pm --file reply.txt [--tokens N] [--duration-ms N]   # 任意: オーケストレーターが報告したトークン数と所要時間 (team stats 用)
```

| backend | 必要なもの | 特徴 |
|---|---|---|
| (host モード) | Claude Code | API キー不要。ロール別サブエージェント。エンジニアが実際にファイルを編集 |
| `claude-cli` | `claude` コマンド | API キー不要。編集が許可されたフェーズでエンジニアに編集ツールを渡して実装させる |
| `anthropic` | `ANTHROPIC_API_KEY` | 依存なしの fetch 実装。テキスト会話のみ（ファイル編集はしない） |
| `mock` | なし | 決まった返答で1イテレーションを流す。テスト・デモ用 |

モデルは `team.config.json` の `backend.model`、`--model`、環境変数 `TEAM_MODEL` で指定できます。

`team run` は最初に `backend=<type> model=<model>` を 1 行出します（backend がモデルを自分で選ぶときは `default`）。何かを変更する前に、backend がそもそも動くかを、何も起動せず呼び出しもせずに確かめます。`claude-cli` は `claude` コマンドの有無（`TEAM_CLAUDE_BIN` があればそれ、なければ `PATH` を探索。Windows は `PATHEXT` も）、`anthropic` は `ANTHROPIC_API_KEY` の有無です。動かない場合は原因と対処（インストールする、変数を設定する、`--backend mock` で試す）を表示して exit 1 で終了し、セッションは元のままです。すでに終了したセッションは確認しません。

`claude-cli` のターンが `TEAM_TURN_TIMEOUT` 秒（既定 1800）を超えると、そのターンのプロセスツリーとプロセスグループを強制終了し、リトライせずにそのターンを飛ばします（ハングは繰り返すだけのため）。`usage.jsonl` の行には `skipped` が付き、かかった時間が残ります。親がすでに終了したプロセスはターンとの関係をたどれず、残ることがあります。

`claude-cli` の各ターンが読み込むのは、プロジェクト（外部ワークスペースならそのワークスペース）の Claude Code 設定と、ユーザー設定のうち deny ルール・`env`・`apiKeyHelper` だけです。グローバルのルール・プラグイン・フック・スキルは読み込みません。

## カスタマイズ

- **メンバー**: `personas/*.json` を追加・編集して `team.config.json` の `members` に並べます。`role` は `pm` / `engineer` / `user`（それ以外のロール名も使え、汎用の説明で参加します）。`persona` 以下は TinyTroupe 形式の自由な JSON で、そのままプロンプトに入ります。ユーザーには `tech_literacy` のような「試用のしかたに影響する情報」を書くと受け入れテストが現実的になります。
- **フェーズ**: `team.config.json` に `phases` を書くと `DEFAULT_PHASES` (`src/sop.ts`) を置き換えられます（`id` / `goal` / `speakers` / `mode: round-robin|parallel` / `maxRounds`、任意で `untilTasksDone`（タスクが全部終わったら早めに終える）/ `editors`（このフェーズで `workspace/` を編集できるロール）/ `iterationStart`（reject 後や `team continue` のあと、ここから次のイテレーションを始める））。
- **言語**: `language`（既定 `ja`）。
- **記憶の長さ**: `historyWindow`（プロンプトに入れる直近の会話件数）。プロンプトでは、同じプロンプトの Backlog・Decisions・Demos に全文がある発言（タスク作成・タスク更新・決定・デモ）は 1 行の参照にします。`transcript.md` と `team log` は全文のままです。

## 開発

```bash
npm install -g pnpm@12.15.0   # pnpm が未インストールなら最初に1回（package.json で固定した版。corepack では pnpm 12 が起動しない）
pnpm install         # 型チェック用の devDependencies のみ
pnpm test            # node --test（依存なし）
pnpm typecheck       # tsc --noEmit
pnpm build:bin       # (任意) Bun で単一実行ファイルを作る
```

`pnpm-workspace.yaml` で `minimumReleaseAge` を7日にしているので、公開から1週間未満のパッケージは入りません（固定している pnpm のバージョンも同じルールで選んでいます）。

```
src/
  main.ts       エントリポイント
  cli.ts        コマンド
  world.ts      ワールド: スケジューリング・アクションの適用 (TinyWorld 相当)
  sop.ts        フェーズ定義・ロールの責務・権限
  protocol.ts   返答タグのパーサ
  prompt.ts     ターンごとのプロンプト生成（ペルソナ・共有状態・記憶）
  store.ts      .team/ への保存
  render.ts     ログ・transcript.md の整形、`status` の先頭部分、`Next:` の行
  summary.ts    既定の `team status` の要約（`--full` が全文）
  session-list.ts  `team sessions` の一覧表
  text.ts       長い文章の 1 行プレビューと、制御文字を出力に通さない処理
  local-time.ts ローカル日時の部品（既定のセッション名と `team sessions` 用）
  html.ts       transcript.html（ブラウザで読む用）
  verify.ts     受け入れ前に [VERIFY] コマンドを実行する試用
  usage.ts      バックエンドのトークン数と、team stats の集計
  backends/     anthropic / claude-cli / mock
personas/       メンバー定義
scripts/        prompt-snapshot.ts: 全プロンプトを書き出す。`diff -r` の前後比較で prompt.ts の変更が 1 バイトも変えていないことを確かめる
.claude/        サブエージェント (agents/) と team-dev スキル (skills/)
```

## 制約と注意

- シミュレーションしたユーザーは実ユーザーの代わりにはなりません。仮説出しと明らかな問題の発見に使い、重要な判断は実際のユーザーで確かめてください。
- build フェーズのエンジニアは同じ `workspace/<セッション名>/` を並列に編集します。担当ファイルを分ける指示はしていますが、競合したときは review フェーズで直す前提です。
- auto モードでは、失敗したターン（API エラーなど）を 1 回リトライし、それも失敗したらそのメンバーはそのターンを飛ばして実行を続けます。空（空白だけを含む）の返答も失敗した試行として扱い、ファイル編集を伴うターンも含めてターン全体をやり直します。タイムアウトしたターンはリトライせずに飛ばします。動かない設定（`claude` コマンドが無い、API キーが無い）は上記のとおり開始前に止まります。途中で壊れた場合も、ターンが 3 回続けて飛ばされた時点で、スキップのままセッションを終わらせずに `run` が exit 1 で止まります。数えるのは、step の全メンバーが飛ばされたときだけです（1 メンバーを 1 ターンとして足す）。誰か 1 人でも返答を得た step があればカウントは 0 に戻ります。この連続数は 1 回の `run` の中で数えます（再開した `run` や `--turns` の短い実行では 0 から数え直します）。上限に達した step は transcript にもセッションのターン数にも記録しませんが、失敗した試行は `skipped` 付きで `usage.jsonl` に書くので、`team stats` ではコストつきの skip したターンとして数えます。セッションは running のままメンバーが pending に残るので、原因を直して `team run` すれば続きから再開できます。
- `claude-cli` バックエンドの build/review では、エンジニア役に Bash と編集ツールを許可します。信頼できる環境（コンテナやクラウドセッションなど）で実行してください。
