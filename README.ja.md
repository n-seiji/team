# team — PM・エンジニア・ユーザーが会話しながら開発するチームシミュレーター

[English](README.md) | **日本語**

[microsoft/TinyTroupe](https://github.com/microsoft/TinyTroupe) のペルソナ・シミュレーションと、MetaGPT / ChatDev の役割分担型の開発プロセスを組み合わせ、

- **プロダクトマネージャー**（インタビュー・スコープ決定・受け入れ基準）
- **エンジニア（複数）**（設計・実装・相互レビュー。`workspace/` に実際にコードを書く）
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
| build | エンジニア（**並列**） | 自分のタスクを `workspace/` に実装し `[TASK_DONE]` |
| review | エンジニア, PM | 相互レビューと修正。PM が受け入れ基準を確認 |
| acceptance | ユーザー, PM | ユーザーが成果物を見て/動かして `[VERDICT accept/reject]`。PM がまとめる |

reject が1件でもあり、イテレーション上限 (`maxIterations`) に達していなければ planning に戻ります。各フェーズは最大ラウンド数で終わるほか、PM が `[ADVANCE]` で早めに切り上げられます。

### 会話のルール

エージェントは TinyTroupe の THINK / TALK / DONE を拡張したテキストタグで返答します（`src/protocol.ts`）。

```
[THINK] 本人にしか見えない思考
[SAY to=user-yamada] 指名された人が次に話す（to=all なら全員宛て）
[NOTE] 長期メモ（以降のターンで毎回本人に提示される）
[TASK owner=eng-backend] タイトル
受け入れ基準（次の行から）
[TASK_DONE T1] 何をどのファイルに実装し、どう確認したか
[DECISION] チームの決定事項
[VERDICT accept] / [VERDICT reject] 理由
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

あとは Claude Code が `team next` → サブエージェント → `team record` を繰り返します。途中で「予算は月1万円までと伝えて」などと話しかければ、`team say` でチーム全員に共有されます。「discovery だけやって」「次のフェーズまで」のように区切りも指定できます。

- 会話の全文（各メンバーの思考を含む）: `.team/sessions/<name>/transcript.md`
- 作られたプロダクト: `workspace/`

### コマンドラインで使う

```bash
node src/main.ts init --brief "作りたいもの" --name my-session   # セッション作成
node src/main.ts status                                          # フェーズ・次の話者・backlog
node src/main.ts run --backend claude-cli                        # 自動実行 (claude -p で各ターンを実行)
ANTHROPIC_API_KEY=... node src/main.ts run --backend anthropic   # 自動実行 (Messages API を直接呼ぶ)
node src/main.ts run --backend mock                              # LLM なしで流れだけ確認
node src/main.ts log --tail 20 --no-thoughts                     # 会話ログ
node src/main.ts say "ターゲットは個人事業主に絞りたい"           # 人間として発言を差し込む
```

`npm run team -- <command>` や、`npm link` して `team <command>` でも同じです。

host モードを自分で回す場合（他のエージェント基盤から使う場合など）:

```bash
node src/main.ts next --json          # → pending: [{ member, role, subagent, canEdit, promptFile }]
# promptFile を LLM に渡して返答を得る
node src/main.ts record --as pm --file reply.txt
```

| backend | 必要なもの | 特徴 |
|---|---|---|
| (host モード) | Claude Code | API キー不要。ロール別サブエージェント。エンジニアが実際にファイルを編集 |
| `claude-cli` | `claude` コマンド | API キー不要。編集が許可されたフェーズでエンジニアに編集ツールを渡して実装させる |
| `anthropic` | `ANTHROPIC_API_KEY` | 依存なしの fetch 実装。テキスト会話のみ（ファイル編集はしない） |
| `mock` | なし | 決まった返答で1イテレーションを流す。テスト・デモ用 |

モデルは `team.config.json` の `backend.model`、`--model`、環境変数 `TEAM_MODEL` で指定できます。

## カスタマイズ

- **メンバー**: `personas/*.json` を追加・編集して `team.config.json` の `members` に並べます。`role` は `pm` / `engineer` / `user`（それ以外のロール名も使え、汎用の説明で参加します）。`persona` 以下は TinyTroupe 形式の自由な JSON で、そのままプロンプトに入ります。ユーザーには `tech_literacy` のような「試用のしかたに影響する情報」を書くと受け入れテストが現実的になります。
- **フェーズ**: `team.config.json` に `phases` を書くと `DEFAULT_PHASES` (`src/sop.ts`) を置き換えられます（`id` / `goal` / `speakers` / `mode: round-robin|parallel` / `maxRounds`、任意で `untilTasksDone`（タスクが全部終わったら早めに終える）/ `editors`（このフェーズで `workspace/` を編集できるロール）/ `iterationStart`（reject 後にここから次のイテレーションを始める））。
- **言語**: `language`（既定 `ja`）。
- **記憶の長さ**: `historyWindow`（プロンプトに入れる直近の会話件数）。

## 開発

```bash
npm install          # 型チェック用の devDependencies のみ
npm test             # node --test（依存なし）
npm run typecheck    # tsc --noEmit
npm run build:bin    # (任意) Bun で単一実行ファイルを作る
```

```
src/
  main.ts       エントリポイント
  cli.ts        コマンド
  world.ts      ワールド: スケジューリング・アクションの適用 (TinyWorld 相当)
  sop.ts        フェーズ定義・ロールの責務・権限
  protocol.ts   返答タグのパーサ
  prompt.ts     ターンごとのプロンプト生成（ペルソナ・共有状態・記憶）
  store.ts      .team/ への保存
  render.ts     ログ・transcript.md の整形
  backends/     anthropic / claude-cli / mock
personas/       メンバー定義
.claude/        サブエージェント (agents/) と team-dev スキル (skills/)
```

## 制約と注意

- シミュレーションしたユーザーは実ユーザーの代わりにはなりません。仮説出しと明らかな問題の発見に使い、重要な判断は実際のユーザーで確かめてください。
- build フェーズのエンジニアは同じ `workspace/` を並列に編集します。担当ファイルを分ける指示はしていますが、競合したときは review フェーズで直す前提です。
- `claude-cli` バックエンドの build/review では、エンジニア役に Bash と編集ツールを許可します。信頼できる環境（コンテナやクラウドセッションなど）で実行してください。
