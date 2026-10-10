# 事例調査と設計の対応

このリポジトリの設計にあたって参考にした事例と、そこから何を取り入れたか（何を取り入れなかったか）のメモです。

## microsoft/TinyTroupe

LLM で「人」をシミュレーションする Python ライブラリ。中心となる概念は次の2つです。

- **TinyPerson**: JSON のペルソナ定義（名前・年齢・職業・目標・話し方・性格 (Big Five)・好み・信念 …）を持つエージェント。`listen` / `see` で刺激を受け取り、`act` で `THINK` / `TALK` / `DONE` などのアクションを返す。
- **TinyWorld**: エージェントを置く環境。`world.run(n)` でステップを進め、あるエージェントの `TALK` は相手側に会話の刺激として届く。v0.5.1 以降は1ステップ内のエージェントを並列に動かす。
- そのほか: ペルソナの部品化 (Fragment)、条件から多様な人物を作る `TinyPersonFactory`、ペルソナから逸脱していないかの検証 (propositions / quality checks)、結果抽出 (`ResultsExtractor`)。

**取り入れたもの**

| TinyTroupe | このリポジトリ |
|---|---|
| TinyPerson の JSON 定義 | `personas/*.json`（`persona` 以下は自由形式。TinyTroupe と同じキーを推奨） |
| THINK / TALK / DONE アクション | `[THINK]` `[SAY to=...]` `[DONE]` ＋ 開発用の `[TASK]` `[TASK_DONE]` `[DECISION]` `[VERDICT]` `[ADVANCE]` (`src/protocol.ts`) |
| TALK が相手への刺激になる | `[SAY to=<id>]` で指名された人が次に話す (`World.replyTo`) |
| TinyWorld のステップ・並列実行 | フェーズごとの round-robin / parallel スケジューリング (`src/world.ts`) |
| `world.broadcast` | `team say "..."`（人間からの発言の差し込み） |
| エピソード記憶・意味記憶 | 自分に見える会話ログの直近 N 件（思考は本人にだけ見える）＋ `[NOTE]` による長期メモ |

**取り入れなかったもの（今後の拡張候補）**: ペルソナの自動生成ファクトリ、ペルソナ一貫性の LLM 検証、統計的な検証、結果抽出器。

## MetaGPT

「Code = SOP(Team)」を掲げ、Product Manager → Architect → Project Manager → Engineer → QA という役割分担と標準作業手順 (SOP) をプロンプトとして与え、各工程の成果物（PRD・設計・タスク・コード）を次の工程の入力にするマルチエージェント開発フレームワーク。

**取り入れたもの**: 役割ごとの責務と、フェーズ（SOP）で会話を構造化すること。`src/sop.ts` の `DEFAULT_PHASES` は discovery → planning → build → review → acceptance。PM が書くタスクには受け入れ基準を必須にし、後工程（レビュー・受け入れ）の判定基準にしています。

## ChatDev

CEO / CTO / Programmer / Reviewer / Tester などの役割を持つエージェントが、ウォーターフォール型のフェーズごとに2者間チャット（指示役とアシスタント役）で設計・実装・テストを進める仮想ソフトウェア会社。

**取り入れたもの**: フェーズ単位の「チャットチェーン」と、レビューの段階を独立させること。

## CAMEL / Generative Agents

- **CAMEL**: 役割を与えた2エージェントのロールプレイ（inception prompting）。役割を外れないためのシステムプロンプト設計の参考にしました（「AI であることに触れない」「ペルソナに沿って話す」）。
- **Generative Agents (Stanford, 2023)**: 記憶ストリーム・振り返り・計画を持つエージェントの社会シミュレーション。今回は「本人にだけ見える思考」と「長期メモ」という軽量な記憶モデルに留めています。

## シミュレートされたユーザーによる要求獲得・ユーザビリティ評価

LLM でエンドユーザーのペルソナを多数作り、インタビューや製品の試用をさせて、要求の洗い出しやユーザビリティの問題を見つける研究があります（例: Elicitron、UXAgent など）。実ユーザーの代替ではなく、**実インタビューの前に仮説を広げる・明らかな欠陥を潰す**用途が現実的です。

**取り入れたもの**: ユーザー役を「チームの外の人」として明確に分け、(1) discovery で PM がインタビューし、(2) acceptance で実際の成果物 (`workspace/`) を見て `[VERDICT accept|reject]` を出す。reject があれば planning に戻って次のイテレーションに入る、というループにしています。ユーザー役には技術的な解決策を語らせず、ITリテラシーをペルソナに書いて「動かせなかった」こと自体も評価として扱わせます。

## Claude Code のサブエージェント / スキル

Claude Code では `.claude/agents/*.md` でツール権限の異なるサブエージェントを、`.claude/skills/*/SKILL.md` で手順（スキル）を定義できます。

**取り入れたもの**: ロールごとにツール権限を分けたサブエージェント（PM とユーザーは読み取りのみ、エンジニアだけが `workspace/` を編集できる）と、オーケストレーションの手順を書いた `team-dev` スキル。状態はすべてエンジン（CLI）が持ち、Claude Code は「次に誰が話すか」を聞いてサブエージェントに渡し、返答を記録するだけにしています。これにより、

- API キーがなくても Claude Code (Web / CLI / Desktop) の中で完結する
- 同じエンジンを API 直叩き (`--backend anthropic`) や `claude -p` (`--backend claude-cli`) の自動実行でも使える
- 会話の途中で人間が割り込める

という形になっています。

## 言語・実行環境の選定

- **TypeScript (Node.js ≥ 22.18)**: Node.js 22.18 以降は型注釈を取り除いて `.ts` を直接実行できるため、ビルドなし・実行時依存ゼロで動きます。Linux / macOS / Windows のどこでも同じコマンドで動き、Claude Code が入っている環境には Node.js がほぼ確実にあります。
- **Go** も単一バイナリ配布の点で有力でしたが、Claude Code（Node 製）と同じランタイムに乗れること、JSON のペルソナ定義との相性、`node --test` でテストまで依存なしで書けることから TypeScript にしました。単一バイナリが欲しい場合は `pnpm build:bin`（Bun の `--compile`）で各 OS 向けの実行ファイルを作れます。
