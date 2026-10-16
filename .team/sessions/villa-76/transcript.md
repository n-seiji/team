# villa-76

**Brief:** 既存プロダクト「Villa Karuizawa」(軽井沢の 1 棟貸し別荘の招待制予約サイト。HonoX + Cloudflare Workers + D1 + Stripe + Resend) に対する GitHub issue をチームで解決する。

- ワークスペースは villa リポジトリの作業コピー (git worktree) そのもの。ゼロから作らず、既存コードを読んで変更する。README.md は既存のものを保ち、新規 README は作らない。
- villa の CLAUDE.md と .claude/rules/ に従う。機能追加は実装前に Business Risk Review (.claude/rules/business-risk-review.md の 5 カテゴリ) を spec に書く (例: docs/specs/ 配下)。個人情報・認証・メールに触れる変更は .claude/skills/pii-review/SKILL.md の観点で差分を確認する。
- 品質ゲート: `pnpm test:run` (ユニット)、`npx tsc --noEmit`、`pnpm lint` 相当。依存の追加は避ける (pnpm の 7 日ルールあり)。外部 API キーは無いので、外部サービスはモックかインターフェースまでで止め、何が未検証かを明記する。
- git の commit / push はしない (ファシリテーターが最後にまとめる)。
- ユーザー役: 小林さん (リピーターのゲスト) と中村さん (オーナー兼運営者)。
- issue の「検討事項」で決まっていない点は、チームで決めて理由を残す。スコープが大きければ 1 イテレーションで出せる最小の価値に絞り、残りは明記する。

以下が issue 本文。
# villa#76 開発環境からメールをサクッと送って文言を確認できるようにする

## 要望
ゲストに送っているメールの文言を、開発環境から手軽に確認したい。ローカル (Mailpit) でも Resend 経由でもよいが、少なくとも「開発環境から 1 コマンド (または 1 画面) で、実際のテンプレートのメールを送って見られる」状態にする。

## 現状
- 送っているメールは 5 種類: 予約確定、キャンセル、ログイン用 OTP、予約前メール確認の OTP、宿泊後 (アンケート依頼)。テンプレートはすべて `app/lib/mail.ts`
- 送信の仕組みはある: `mise run send-mail` (`scripts/send-template-mail.ts`) が gum で種類と宛先を選び、`.dev.vars` の `MAILPIT_URL` があれば Mailpit、なければ Resend で送る
- **ただしこのタスクは今動かない**。`node scripts/send-template-mail.ts` が、`mail.ts` の拡張子なし import (`./format` など) を解決できず `ERR_MODULE_NOT_FOUND` で落ちる (#75 のレビューで判明。Node v25.6.1)
- スクリプトが送れるのは 4 種類で、予約前メール確認の OTP (`buildOtpEmail(code, undefined, 'reservation')`) が選べない
- サンプルデータが 1 パターン固定 (`res-sample-001`)。次の出し分けを確認できない
  - 料金内訳 (`price_breakdown`) あり / なし、無料招待 (0 円)
  - キャンセルの返金率 100% / 50% / 0% と、返金あり / なしの文言
  - 宿泊後メールの招待リンクあり / なし (`villaConfig.invitation.postStayEnabled`、#72)
- 文言を守るテストは `app/lib/mail-golden.test.ts` (予約確定・キャンセルの HTML を 1 パターンずつ完全一致) と `mail.test.ts`。OTP と宿泊後メールには golden が無い
- 管理画面 `/admin/emails` は送信履歴 (outbox) の一覧と再送だけで、本文のプレビューは無い

## やること (案)
1. `mise run send-mail` を直す。実行方法を変える (バンドルして実行する / `vite-node` などで走らせる) か、import を解決できる形にする
2. 5 種類すべてを送れるようにする
3. サンプルを「シナリオ」として複数持つ (通常料金 2 泊、無料招待、返金 100% / 50% / 0%、招待リンクあり / なし)。gum で選べ、全シナリオを一括送信もできる
4. 送らずに見るだけの経路も用意する: 全シナリオの HTML をファイルに書き出してブラウザで開く、またはローカル限定の管理画面プレビュー
5. 文言のテスト: シナリオを golden テストと共有し、全メール種別 × 主要シナリオの件名と本文を固定する。文言を変えたら差分がレビューで見える状態にする

## 検討事項
- 既定の送り先は Mailpit か Resend か。Resend 無料枠は 1 日 100 通・月 3,000 通で本番の自動メールと共有している (`docs/mail.md`)。一括送信を Resend に流すと枠を食う
- 実機 (Gmail / iPhone のメールアプリ) での見え方まで確認したいなら Resend 経由が要る。その場合の宛先の安全策 (自分のアドレス以外に送れないようにする等)
- golden を HTML 完全一致のままにするか、スナップショットファイル (`toMatchFileSnapshot`) にして差分を読みやすくするか
- プレビューを管理画面に置く場合、本番で出すか (運営が文言を確認できる利点 / 画面が増える)

## 関連
- #73 (送信元と問い合わせ先の分離)、#72 (宿泊後メールの招待リンク停止)、#75 (送信元の組み立てを `formatMailFrom` に集約)
- `docs/mail.md`

**Status:** done · iteration 1/2 · phase `acceptance`

## Team

- **佐藤 美咲** (`pm`, pm)
- **田中 健** (`eng-backend`, engineer)
- **鈴木 ひかり** (`eng-frontend`, engineer)
- **小林 直子** (`user-guest`, user)
- **中村 誠** (`user-owner`, user)

## Backlog

- T1 [done] owner=eng-backend メールシナリオを1か所に定義し、5種類すべてを網羅する
    acceptance: - `app/lib/` 配下に、メール種別・シナリオ名・入力データ・期待する件名を持つ定義ファイルを1つ置く。スクリプト・プレビュー・テストはすべてここを参照する。
    - 5種類 (予約確定、キャンセル、ログイン OTP、予約前メール確認 OTP、宿泊後) を含む。
    - 予約確定: 通常料金2泊(内訳あり)、内訳なし、無料招待(0円)。
    - キャンセル: 返金100%、返金50%、返金0%(返金なし)。
    - 宿泊後: 招待リンクあり、なし(`postStayEnabled` の切替)。
    - 各シナリオは `buildXxx` を呼んで件名と HTML/テキスト本文を返せる。
    - サンプルに実在のゲスト情報を使わない。
    - `pnpm test:run` と `npx tsc --noEmit` が通る。
    - 実装前に spec (`docs/specs/`) へ Business Risk Review 5カテゴリを書く。
    result: シナリオを 1 か所に定義した。spec は `docs/specs/2026-10-16-mail-preview-design.md` に Business Risk Review 5 カテゴリで書いた。
    - 定義は `app/lib/mail-scenarios.ts`。5 種類で計 11 シナリオ。
      - 予約確定: breakdown / no-breakdown / free-invitation
      - キャンセル: refund-100 / refund-50 / refund-0
      - ログイン OTP: magic-link / code-only
      - 予約前メール確認 OTP: code
      - 宿泊後: with-invitations / without-invitations
    - 各シナリオは `kind`、`scenario`、`label` (日本語名)、`expectedSubject`、`build()` を持つ。`buildMailScenario(s)` が `{ kind, scenario, label, subject, html, text }` を返す。
    - 宿泊後の招待あり/なしは `buildPostStayEmail` の引数で切り替える。`villaConfig` は書き換えない。
    - サンプルは架空値に固定した (山田花子、`example.com`、OTP は `000000`)。テストで、HTML 内の URL が `example.com` と `share.google` 以外にならないことも確認している。
    - 鈴木さんへ: `MAIL_SCENARIOS`、`buildMailScenario`、`formatHtmlForSnapshot`、`scenarioId` を使ってください。HTML の整形は golden と同じ `formatHtmlForSnapshot` です。ただし、プレビューの本文 iframe には整形前の生 HTML (`html`) を入れてください。ローダーは `loadMailModules()` で `{ mail, scenarios, mailFrom, close }` を返します。使い終わったら `close()` が必要です。
    - `text` は HTML から機械的に作った確認用です。`mail.ts` に text 版はありません。
- T2 [done] owner=eng-backend `mise run send-mail` を動くようにし、5種類・シナリオ指定・一括送信に対応する
    acceptance: - `mise run send-mail` が `ERR_MODULE_NOT_FOUND` で落ちずに起動する。依存追加はしない。
    - gum で種類とシナリオを選べる。「全シナリオ一括」も選べる。
    - 既定の送信先は Mailpit(`MAILPIT_URL`)。
    - Resend で送るのは明示的に選んだときだけ。宛先は環境変数で指定した自分のアドレス1件に限り、それ以外は送信前にエラーで止まる。
    - 一括送信で Resend は使えない。
    - 実 API キーがないため Resend 経路は未検証。モックのユニットテストで宛先制限だけ確認し、未検証である旨を `docs/mail.md` に書く。
    - 個人情報・メールに触れるので pii-review の観点で差分を確認する。
    result: `send-mail` を直し、5 種類・シナリオ指定・一括送信に対応した。
    - 原因は、素の `node` では `mail.ts` の拡張子なし import と `~` エイリアスを解決できないこと。`scripts/lib/load-mail.ts` で、vite の `createServer` + `ssrLoadModule` に統一した。`vite.config.ts` は使わず (honox などで重い)、alias だけを渡す。依存は追加していない。`vite build --ssr` への切り替えは不要だった。
    - 実行確認は Node v22.22 まで。issue の v25.6.1 では未実行。
    - 使い方は、`mise run send-mail`、または `node scripts/send-template-mail.ts <all|種類-シナリオ> [宛先] [--resend]`。`--list` で一覧を出す。
    - gum は「Mailpit: 全シナリオ一括」「Mailpit: シナリオを選ぶ」「Resend: シナリオを選ぶ」の 3 択。
    - 既定は Mailpit。`MAILPIT_URL` が無いときは、Resend に切り替えずエラーで止まる。
    - Resend は `--resend` を明示したときだけ。宛先は `.dev.vars` の `MAIL_PREVIEW_TO` 1 件に限る。次のどれも API を呼ぶ前に止まる。
      - 宛先の不一致
      - カンマ区切り
      - `Name <addr>` 形式
      - `all` との組み合わせ
      - 例外メッセージに宛先は含めない。
    - `.dev.vars` の `MAGIC_LINK_BASE_URL` が本番の値でも、スクリプト側でローカル判定に固定する。`sendMail` 既存の歯止めを迂回できないようにするため。
    - テストは `scripts/lib/send.test.ts` に 10 件以上。fetch をモックし、宛先制限、一括×Resend 拒否、Mailpit にフォールバックしないこと、全件が Mailpit に届くことを確認した。
    - 疑似 Mailpit (127.0.0.1:8025) に対して `all` を実行し、11 通が届くことを確認した。誤宛先、`all --resend`、`MAILPIT_URL` なしは、すべて exit 1 で止まる。
    - `docs/mail.md` に「文言の確認」と「未検証」の節を追加した。
    - pii-review の観点で自己確認した。実在のゲスト情報や宛先をエラー・ログ・snapshot に出していない。本番コードの `mail.ts` ほかは無変更。独立したレビューはまだ受けていない。
    - **未検証**
      - Resend 経路は実キーが無く、実際には送っていない。
      - gum の対話部分は実行していない。mise の bash は構文チェックのみで、中で呼ぶ `node` コマンドは実行した。
      - Gmail / iPhone での見え方も未確認。
- T3 [done] owner=eng-frontend 全シナリオを送らずに並べて見られる HTML を書き出す (`mise run preview-mail`)
    acceptance: - 1コマンドで全シナリオの HTML を1つの一覧ページに書き出し、ブラウザで開ける。送信は一切しない。
    - 各シナリオに、種類、シナリオ名、件名を表示する。
    - 本文は幅375pxの枠(iPhone 想定)で並べて表示し、表の横はみ出しがあればその場で分かる。
    - キャンセルの返金100% / 50% / 0%、内訳なし、無料招待、OTP 2種が同じ画面で見比べられる。
    - 出力先は git 管理外のディレクトリにする。
    - 書き出した本文のうち、金額・返金額・OTP の用途と有効時間が読める位置にあるか、エンジニアが目視確認する。確認結果を完了報告に書く。
    result: `mise run preview-mail` で全 11 シナリオを `.preview/mail/index.html` に書き出せます。送信処理は一切呼びません。ただし、ブラウザで開いての確認とはみ出しバッジの動作は未確認です。この環境にはブラウザの実体が無く、playwright は実行できませんでした。
    
    **ファイル**
    - `scripts/preview-mail.ts`(新規): `loadMailModules()` で `MAIL_SCENARIOS` を読み、`buildMailScenario` の結果を渡します。
      - iframe には整形前の生 HTML を入れています。
      - 生成日時と `git rev-parse --short HEAD` のハッシュを一覧に出します。ハッシュが取れなければ `unknown` です。
    - `scripts/lib/render-preview.ts`: 種類の日本語名(`MAIL_KIND_LABELS`)を出すため `kindLabel` を追加しました。
    - `.gitignore` に `.preview/`、`mise.toml` に `preview-mail` を追加しました。
    - 実行は `mise run preview-mail` か `node scripts/preview-mail.ts` です。
    - `pnpm exec vitest run scripts/lib` は 15 件通りました。このコマンドは `scripts/lib` 配下のテスト全体を対象にしているため、`render-preview.test.ts` と、田中さんの `send.test.ts` の両方を含みます。
    - `kindLabel` 追加後の `pnpm test:run` 全体、`pnpm lint` は実行していません。
    
    **目視確認(`.text.txt` snapshot と HTML のスタイルを読んだ結果)**
    - 金額: 予約確定は合計金額が内訳なしで `¥123,456`、無料招待で「無料」と読めます。
      - キャンセルは「お支払い金額」「返金金額」「適用返金率」が上から並びます。
      - 50% は `¥61,728` と `50%`、0% は `¥0` と `0%` です。
    - 返金の説明: 50% は「返金はお支払い時のカードに対して行われます」、0% は「キャンセルポリシーに基づき、返金はございません」が出ます。
      - 気づいた点が 1 つあります。0% の「返金はございません」は、キャンセルポリシー表の下にあります。小林さんは返金の有無をすぐ知りたいので、表の上に出す案を次の回で PM に相談したいです。今回は文言を変えていません。
    - OTP: 2 種とも見出しの直下に用途と「10分間有効」があり、コードの前に読めます。
      - ログイン用は「以下の認証コードを入力してください。このコードは10分間有効です。」です。
      - 予約前確認用は「ご予約の確認メールをお送りするため、…メールアドレスをご確認ください。」と、有効時間が同じ段落に入っています。
      - コードは 36px、letter-spacing 8px の 6 桁です。幅は約 180px で、375px に収まる計算です。
    - 横はみ出し: 全 table が `width:100%` で、固定幅と `nowrap` はありません。本文は `max-width:600px` です。静的には、はみ出す要因は見当たりません。
      - 実際の `mypage` URL は長くなります。サンプルの `example.com` では再現しないので、実機で確認が必要です。
    
    **未検証**
    - ブラウザでの表示、`scrollWidth` による「横はみ出しあり」バッジの動作、本文高さの自動調整は未確認です。生成された HTML とテストまでしか確認できていません。ブラウザのある環境で開いて確認してください。
    - iframe はブラウザの描画なので、Gmail や iPhone 標準メールの見え方は保証しません。実機確認は Resend 経由が必要です。
    - Resend 経路は、田中さんの報告どおり実キーが無く未検証です。
- T4 [done] owner=eng-backend 全メール種別 × 主要シナリオを golden テストで固定する (シナリオ共有)
    acceptance: - 上記シナリオ定義を使い、全シナリオの件名と本文を固定する。OTP 2種と宿泊後メールの golden も新規に追加する。
    - 既存の `mail-golden.test.ts` の2パターンは、新しい仕組みに移して内容が変わらないことを確認する。
    - 形式は `toMatchFileSnapshot` を推奨する。文言を変えると差分がファイル単位で PR に見える。理由: HTML 完全一致の文字列より、レビューで読みやすい。反対意見があれば教えてください。
    - 文言をわざと1語変えるとテストが落ち、スナップショット更新で差分が出ることを確認する。
    - `pnpm test:run` が通る。
    result: 全シナリオを `toMatchFileSnapshot` で固定した。
    - テストは `app/lib/mail-scenarios.test.ts`。snapshot は `app/lib/__snapshots__/mail/<種別>-<シナリオ>.{subject.txt,html,text.txt}` で、計 33 ファイル。OTP 2 種と宿泊後の golden も新規に入った。
    - **旧 golden との一致**: 旧 `mail-golden.test.ts` の予約確定 (内訳なし) とキャンセル (50%) の期待文字列を、一時テストで新シナリオの HTML と `toBe` 比較し、バイト一致を確認した。確認後に旧テストを削除した。旧の「内訳あり」テストは breakdown シナリオの snapshot に置き換わった。
    - **文言変更の検知**: `mail.ts` の「ご予約が確定しました」を 1 語変えると、予約確定の 3 シナリオが落ちた。`-u` で 6 ファイル (html と text) が更新された。確認後に文言を戻し、snapshot も戻した。
    - 補足の文言テストも追加した。
      - 返金 50% の金額と率が表示されること
      - 返金 0% で「返金はございません」が出ること
      - OTP の用途と「10分間有効」が出ること
      - 招待なしの宿泊後メールに「招待」が出ないこと
    - `.oxfmtrc.json` の ignore に `app/lib/__snapshots__` を追加した。これを入れないと `pnpm lint` が snapshot を整形しようとして落ちる。
    - 品質ゲートの結果
      - `pnpm test:run`: 160 ファイル / 1518 テスト通過 (最終変更前に実行)
      - `pnpm lint`: 通過
      - `npx tsc --noEmit`: 上記の既存エラー以外なし
    - 雑に `-u` で承認すると文言変更を見逃す。レビューでは snapshot の差分を必ず読んでください。

## Decisions

- (discovery, 佐藤 美咲 (pm)) 解決の中心は「送る」ではなく「送らずに全シナリオの本文を並べて見られる」ことに置く。送信は Mailpit を既定にし、Resend は実機確認用に宛先を自分のアドレスに限って明示的に選んだときだけ使う。理由: ゲストへの誤送信と Resend 無料枠の消費を避けるため。トレードオフは、実機確認に一手間かかること。
- (planning, 佐藤 美咲 (pm)) 今回のイテレーションは (1) シナリオ定義 (2) send-mail 修復と5種類対応 (3) 送らず並べて見る HTML 書き出し (4) golden をシナリオ共有で固定、の4つに絞る。管理画面プレビュー、誰が何を確認したかの記録、中村さんが自分のスマホで見る導線は次イテレーションに回す。理由: 先に文言を安全に確認できる土台を作るため。トレードオフは、中村さんが直接見られるのは次回以降になること。
- (planning, 佐藤 美咲 (pm)) golden は `toMatchFileSnapshot` を採用する。ファイルは `app/lib/__snapshots__/mail/<種別>-<シナリオ>.html` と `.subject.txt`、`.text.txt` に分ける。HTML の整形関数は golden と preview で共有する。理由: 文言変更の差分を PR で読めるようにするため。トレードオフは、スナップショット更新を雑に承認すると文言変更を見逃すこと。レビューでは差分を必ず読む。
- (planning, 佐藤 美咲 (pm)) メールの読み込みは、直接の devDependency である vite の `ssrLoadModule` を使った共通ローダー `scripts/lib/load-mail.ts` に統一する。send-mail と preview-mail はこれを使う。依存は追加しない。プレビューの出力先は `.preview/mail/` で、git 管理外とする。理由: 依存を増やさず、拡張子なし import の問題を直すため。トレードオフは、vite の内部 API に依存すること。
- (review, 佐藤 美咲 (pm)) 返金 0% の「返金はございません」をキャンセルポリシー表の上に出すかどうかは、次イテレーションで扱う。今回は文言を動かさない。理由: 小林さんは返金の有無を先に知りたいが、これは文言変更であり、golden の差分をレビューする作業が要る。トレードオフは、次回まで現状の位置が残ること。
- (review, 佐藤 美咲 (pm)) 次イテレーションの先頭に、ブラウザのある環境での確認を置く。確認するのは、はみ出しバッジの動作、長い URL でのはみ出し、Node v25 での `send-mail` の実行の 3 つ。理由: 今回の「完了」にはこれらの未検証が残っているため。その後に、中村さんがスマホで見る導線を決める(ローカル限定の管理画面プレビューか、自分宛て Resend か)。
- (acceptance, 佐藤 美咲 (pm)) 次イテレーションの優先順位は、(1) ブラウザ環境での未検証 3 点の確認 (2) 返金 0% 文言を表の上へ移す。変更前後を並べて見せ、golden 差分をレビューする (3) 中村さんのスマホ導線 (4) 確認の記録、とする。スマホ導線は自分宛て Resend を第一候補とし、管理画面に置く場合は本番で出ない作りを条件にする。理由: 両ユーザーの要望が一致し、最も誤りが高くつく場面を先に解消するため。トレードオフは、スマホ導線と記録が 3 番目以降になること。

## Verdicts

- iteration 1 · 小林 直子 (user-guest) · **accept** — 私が直接触れるものではありませんが、「直したあとに誰も確認していない」という私の不安には、土台として答えてくれていると思います。

- 返金100% / 50% / 0%、内訳なし、無料招待、ログインコードのメールを、ゲストに送らず全部並べて見られるようになりました。
- 金額や返金額が上から読める位置にあること、ログインコードの用途と「10分間有効」がコードより前にあることを、確認した結果として報告してもらえました。
- 文言を変えるとテストが落ち、差分がレビューで見えます。金額の書き方が黙って変わる心配は、かなり減りました。
- 実際に送るのは Mailpit が既定で、Resend は自分宛て1件に限られています。個人情報に敏感な私は、ここは安心できます。

まだ満足はしていません。次回、次の点をお願いします。

1. **返金0%の「返金はございません」の位置。** 今はキャンセルポリシー表の下にあります。私が一番知りたいのは、返金があるかないかです。表の上に出してください。次回に回すという判断は理解しますが、優先度は高いです。
2. **スマホでの崩れの確認。** ブラウザでの表示、実際の長い URL でのはみ出し、iPhone 標準メールでの見え方が、まだ確認されていません。私は iPhone の標準メールで読むので、ここが崩れていたら使えません。「確認済み」と言えるのは、実機で見てからにしてください。
3. **「確認済み」という表現。** 今回確認できたのは文言と位置までで、見た目はまだです。そこを区別して書いてください。
- iteration 1 · 中村 誠 (user-owner) · **accept** — 土台として受け入れます。ゲストに送らず、珍しいパターンも含めて全部並べて見られる点は、去年の半日の原因に効きます。誤送信を防ぐ歯止めも納得できます。ただし、私の3つの安心条件のうち満たされたのは「全パターンを並べて見られる」だけです。しかも、見るのはまだエンジニア経由です。スマホで見る手段、確認の記録、実機での確認は、次回の必須条件です。

## Transcript

### iteration 1 · discovery

- — Session "villa-76" started. Brief: 既存プロダクト「Villa Karuizawa」(軽井沢の 1 棟貸し別荘の招待制予約サイト。HonoX + Cloudflare Workers + D1 + Stripe + Resend) に対する GitHub issue をチームで解決する。
  
  - ワークスペースは villa リポジトリの作業コピー (git worktree) そのもの。ゼロから作らず、既存コードを読んで変更する。README.md は既存のものを保ち、新規 README は作らない。
  - villa の CLAUDE.md と .claude/rules/ に従う。機能追加は実装前に Business Risk Review (.claude/rules/business-risk-review.md の 5 カテゴリ) を spec に書く (例: docs/specs/ 配下)。個人情報・認証・メールに触れる変更は .claude/skills/pii-review/SKILL.md の観点で差分を確認する。
  - 品質ゲート: `pnpm test:run` (ユニット)、`npx tsc --noEmit`、`pnpm lint` 相当。依存の追加は避ける (pnpm の 7 日ルールあり)。外部 API キーは無いので、外部サービスはモックかインターフェースまでで止め、何が未検証かを明記する。
  - git の commit / push はしない (ファシリテーターが最後にまとめる)。
  - ユーザー役: 小林さん (リピーターのゲスト) と中村さん (オーナー兼運営者)。
  - issue の「検討事項」で決まっていない点は、チームで決めて理由を残す。スコープが大きければ 1 イテレーションで出せる最小の価値に絞り、残りは明記する。
  
  以下が issue 本文。
  # villa#76 開発環境からメールをサクッと送って文言を確認できるようにする
  
  ## 要望
  ゲストに送っているメールの文言を、開発環境から手軽に確認したい。ローカル (Mailpit) でも Resend 経由でもよいが、少なくとも「開発環境から 1 コマンド (または 1 画面) で、実際のテンプレートのメールを送って見られる」状態にする。
  
  ## 現状
  - 送っているメールは 5 種類: 予約確定、キャンセル、ログイン用 OTP、予約前メール確認の OTP、宿泊後 (アンケート依頼)。テンプレートはすべて `app/lib/mail.ts`
  - 送信の仕組みはある: `mise run send-mail` (`scripts/send-template-mail.ts`) が gum で種類と宛先を選び、`.dev.vars` の `MAILPIT_URL` があれば Mailpit、なければ Resend で送る
  - **ただしこのタスクは今動かない**。`node scripts/send-template-mail.ts` が、`mail.ts` の拡張子なし import (`./format` など) を解決できず `ERR_MODULE_NOT_FOUND` で落ちる (#75 のレビューで判明。Node v25.6.1)
  - スクリプトが送れるのは 4 種類で、予約前メール確認の OTP (`buildOtpEmail(code, undefined, 'reservation')`) が選べない
  - サンプルデータが 1 パターン固定 (`res-sample-001`)。次の出し分けを確認できない
    - 料金内訳 (`price_breakdown`) あり / なし、無料招待 (0 円)
    - キャンセルの返金率 100% / 50% / 0% と、返金あり / なしの文言
    - 宿泊後メールの招待リンクあり / なし (`villaConfig.invitation.postStayEnabled`、#72)
  - 文言を守るテストは `app/lib/mail-golden.test.ts` (予約確定・キャンセルの HTML を 1 パターンずつ完全一致) と `mail.test.ts`。OTP と宿泊後メールには golden が無い
  - 管理画面 `/admin/emails` は送信履歴 (outbox) の一覧と再送だけで、本文のプレビューは無い
  
  ## やること (案)
  1. `mise run send-mail` を直す。実行方法を変える (バンドルして実行する / `vite-node` などで走らせる) か、import を解決できる形にする
  2. 5 種類すべてを送れるようにする
  3. サンプルを「シナリオ」として複数持つ (通常料金 2 泊、無料招待、返金 100% / 50% / 0%、招待リンクあり / なし)。gum で選べ、全シナリオを一括送信もできる
  4. 送らずに見るだけの経路も用意する: 全シナリオの HTML をファイルに書き出してブラウザで開く、またはローカル限定の管理画面プレビュー
  5. 文言のテスト: シナリオを golden テストと共有し、全メール種別 × 主要シナリオの件名と本文を固定する。文言を変えたら差分がレビューで見える状態にする
  
  ## 検討事項
  - 既定の送り先は Mailpit か Resend か。Resend 無料枠は 1 日 100 通・月 3,000 通で本番の自動メールと共有している (`docs/mail.md`)。一括送信を Resend に流すと枠を食う
  - 実機 (Gmail / iPhone のメールアプリ) での見え方まで確認したいなら Resend 経由が要る。その場合の宛先の安全策 (自分のアドレス以外に送れないようにする等)
  - golden を HTML 完全一致のままにするか、スナップショットファイル (`toMatchFileSnapshot`) にして差分を読みやすくするか
  - プレビューを管理画面に置く場合、本番で出すか (運営が文言を確認できる利点 / 画面が増える)
  
  ## 関連
  - #73 (送信元と問い合わせ先の分離)、#72 (宿泊後メールの招待リンク停止)、#75 (送信元の組み立てを `formatMailFrom` に集約)
  - `docs/mail.md`

- — Phase "discovery" started (iteration 1) — PM interviews the users to uncover their real situation, pains and jobs-to-be-done. Users answer strictly in character, with concrete episodes. No solutions yet.

> _佐藤 美咲 (pm) [thinks]: このissueの主なユーザーは中村さん(運営)。文言をいつ・なぜ確認したのか、実際に困った出来事を聞きたい。小林さんには、受け取ったメールで実際に迷ったり誤解したりした場面を聞く。解決策の話はまだしない。Resendの枠と実機確認がどれだけ必要かの事実も押さえる。_

- 佐藤 美咲 (pm) → user-owner, user-guest: 今日は #76 の前提を確認させてください。解決策の話はまだしません。
  中村さん、最後にメールの文言を直した、または確認したのはいつですか？何を直して、送る前の見え方をどうやって確かめましたか？確認できずに困ったこと、ゲストから問い合わせが来たことがあれば、その時のことを具体的に教えてください。それと、メールをスマホ(Gmail / iPhone)で実際に開いて確認したことはありますか？
  小林さん、このヴィラから届いたメールを読んで「あれ？」と思ったり、問い合わせをしたりしたのは最後にいつですか？どのメール(予約確定、キャンセル、ログインのコード、宿泊後のアンケートなど)で、何に迷いましたか？普段はどの端末・どのアプリで読んでいますか？

> _佐藤 美咲 (pm) [notes]: Discovery 1回目: 中村さんには文言修正の頻度・確認方法・実機確認の要否・Resendの枠の心配を、小林さんにはメールで迷った実例と閲覧環境を聞いた。_

> _中村 誠 (user-owner) [thinks]: Discovery フェーズ。ツールは使わず、人物として具体的に答える。実際の経験談を交えて、解決策は言わない。_

- 中村 誠 (user-owner): 中村です。正直に言うと、メールの文言を自分で直すことはほとんどありません。コードは読めないので、直したいときは家族の開発者に GitHub の issue で頼みます。最後に頼んだのは、キャンセル時の返金の書き方だったと思います。
  
  困っているのは、直してもらった後の確認です。私が見られるのは、管理画面の /admin/emails に出る送信履歴と再送ボタンだけです。本文がどう見えるかは、実際に自分宛てに送るまで分かりません。「返金あり」と「返金なし」の文言はどちらも確かめたいのに、手元に出せるのは今の予約の分だけです。
  
  一番怖いのは、ゲストに金額が間違って出ることです。去年の繁忙期に、料金の内訳の表示が実際の請求と合っているかどうか、ゲストから聞かれたことがありました。結局は合っていたのですが、確認に半日かかりました。あの時は、同じ状況のメールを私の側で見られれば済んだ話です。
  
  スマホでの見え方は、確認したことがあります。私は iPhone で、Gmail と標準のメールアプリを両方使います。ゲストは年配の方も多いので、スマホで見て金額や日付が崩れていないか、キャンセル料の説明が読めるかは気になります。ただ、確認のために本番の予約を取って自分に送るわけにはいきません。
  
  もう一つ、無料の招待や、返金 50% のような珍しいケースは、年に数回しか出ません。そのたびに「前回どう見えたっけ」となります。仕組みで確認できるなら、私の手間が減ります。

> _小林 直子 (user-guest) [thinks]: ゲスト視点で、メール体験の具体的な場面を話す。実装は知らない。_

- 小林 直子 (user-guest) → user-owner, pm: 小林です。最後に「あれ？」と思ったのは、2回目の宿泊を予約したときです。iPhone の標準メールアプリで読んでいます。
  
  一番迷ったのは、予約確定メールの金額です。サイト上の合計と、メールの内訳を見比べて、合っているか確認しました。経理の仕事をしているので、そこはどうしても見てしまいます。内訳がなくて合計だけのメールだと、不安になると思います。
  
  ログインのコードのメールも困りました。招待コードとは別にコードが届くので、どちらをどこに入れるのか一瞬迷いました。コードの有効時間も、メールの中で目立っていてほしいです。
  
  キャンセルしたことはまだありません。ただ、返金があるのかないのか、いくら戻るのかが、メールを開いてすぐに分かるかが一番気になります。「後で金額が変わる」のが一番嫌なので。
  
  中村さんがおっしゃった、スマホで金額や日付が崩れていないかという点は、私も同じです。表が横にはみ出すと、読む気をなくします。
  
  ひとつ質問です。文言を直したあと、私たちに届くメールが変になっていないか、誰が確認しているのでしょうか。

> _中村 誠 (user-owner) [thinks]: 小林さんの質問に答える。現状は誰も体系的に確認していない。正直に言う。解決策は出さない。_

- 中村 誠 (user-owner): 小林さんの質問ですが、正直に言うと、今は「誰も仕組みとして確認していない」が実態です。家族の開発者が直したあと、自分宛てに1通送って見ているはずですが、私はその場に立ち会っていません。私が見られるのは送信履歴だけで、「返金なし」「無料招待」「内訳なし」の文言が実際にどう出るかは、該当する予約が入るまで誰も見ていないかもしれません。
  
  小林さんのように金額を見比べる方がいるので、ここは困ります。文言を直したあとで、金額や返金の書き方が崩れていても、ゲストから連絡が来るまで気づかない可能性があります。
  
  PM さんに一つ確認です。いま私が困っているのは「直した後に、全部のパターンを自分の目で確かめられないこと」です。ただ、毎回確認する人は私でなく家族の開発者になると思います。私が何を見られれば安心できるか、次の回でお話しします。

> _佐藤 美咲 (pm) [thinks]: 十分な情報が出た。中村さんは次回に何を見れば安心か話すと言っている。ラウンド2で、ジョブと「安心の定義」を聞く。解決策はまだ。ただし1点、小林さんの質問(誰が確認?)は実態として「誰も」。事実を整理して、次の質問を具体的に。_

- 佐藤 美咲 (pm) → user-owner, user-guest: ありがとうございます。整理します。
  ・中村さんのジョブは「文言を直したあと、珍しいケース(返金50%、無料招待、内訳なし)も含めて、ゲストに出る前に自分の目で確かめたい」。今は該当予約が入るまで誰も見ていない。
  ・小林さんのジョブは「金額と返金額を、メールだけで確認できる」。スマホで表がはみ出さないことも条件。
  小林さんの質問への答え: 今は仕組みとして誰も確認していません。ここは課題として受け取りました。
  
  追加で事実を聞かせてください。
  中村さん: 去年の繁忙期の件、「確認に半日かかった」のは、何をして半日になりましたか？誰に何を頼みましたか？そして、次の回でお聞きしたい「何が見られれば安心か」は、今のうちに考えておいてください。たとえば「過去の誰かのメールを見て安心した」経験はありますか？
  小林さん: ログインコードのメールで迷った時、結局どう解決しましたか？コードを入れ間違えた、または問い合わせた経験はありますか？有効時間は、最後にそれを気にしたのはいつですか？

> _佐藤 美咲 (pm) [notes]: 中村さんはコードを読めず、文言修正は家族の開発者に issue で依頼する。確認者は実質エンジニア。中村さんの懸念は金額表示の誤り(去年繁忙期に内訳確認で半日)、返金あり/なし、無料招待、返金50%などの稀ケース、iPhone の Gmail と標準メールでの崩れ。小林さんは経理職で iPhone 標準メール、内訳の有無、返金額の即時把握、OTP の用途と有効時間の目立ち方、表の横はみ出しを気にする。_

> _中村 誠 (user-owner) [thinks]: 半日の中身と「安心できる経験」を具体的に答える。解決策は言わない。_

- 中村 誠 (user-owner): 中村です。PM さんの質問にお答えします。
  
  去年の半日の中身です。ゲストから「内訳が請求と合っているか」と聞かれて、まず Stripe の管理画面で請求額を見ました。次に管理画面の予約詳細で料金を見ました。それでも、ゲストに届いたメールに何と書いてあるかが私には分かりません。そこで家族の開発者に「あの予約のメールの内訳はどう出ているか」と聞きました。向こうは仕事中で、返事が来たのは夕方でした。メールの本文を、私が自分で見る手段がなかったのが原因です。
  
  「安心した経験」は、あります。以前、キャンセルの文言を直してもらったとき、家族がテスト用の予約で実際に送ったメールを私のスマホに転送してくれました。「返金あり」の文言を、スマホで自分の目で読めました。金額の桁や日付の書き方、折り返しまで確認できて、これなら大丈夫と思えました。ただ、その時に見られたのは「返金あり」の1パターンだけです。「返金なし」と「50%」は見ていません。
  
  私が安心できる条件は 3 つです。
  - 本番のゲストに送らず、私のスマホで見られること。
  - 珍しいケースも含めて、全部のパターンを並べて見られること。
  - 誰が何を確認したかが、後から分かること。

> _中村 誠 (user-owner) [notes]: 中村さんの安心条件: 本番ゲストに送らない / 自分のスマホで見られる / 珍しいケース(返金50%・0%、無料招待、内訳なし)を全パターン並べて見られる / 確認した記録が残る。過去の成功体験は「家族がテスト予約のメールをスマホに転送してくれた」(返金ありの1パターンのみ)。去年の半日は「ゲストに実際に届いた本文を自分で見る手段がなかった」ため。_

> _佐藤 美咲 (pm) [thinks]: 必要な事実は揃った。中村さんの安心条件は3つ。小林さんの条件は金額と返金額の即時把握、OTPの用途と有効時間、スマホでの表の崩れ。discoveryは終えて次フェーズへ進む。_

- 佐藤 美咲 (pm): ありがとうございます。整理します。
  ・中村さん: 半日かかった原因は、ゲストに届いたメールの本文を自分で見る手段がなかったこと。安心の条件は3つです。(1) ゲストに送らず自分のスマホで見られる (2) 珍しいケースも含め全パターンを並べて見られる (3) 誰が何を確認したか後から分かる
  ・小林さん: 金額の内訳と返金額が、メールを開いてすぐ分かること。ログインコードは用途と有効時間が目立つこと。スマホで表がはみ出さないこと。
  ・実態として、文言変更後の確認は仕組みになっていません。確認するのは実質エンジニアで、中村さんが見られるのは前回の「返金あり」1パターンだけでした。
  次のフェーズで、これを最小スコープに落とします。

> _佐藤 美咲 (pm) [notes]: discovery 2回目の結果。中村さんの安心条件は、(1) ゲストに送らず自分のスマホで見られる (2) 返金なし・返金50%・無料招待・内訳なしを含め全パターンを並べて見られる (3) 誰が何を確認したか後から分かる。去年の半日の原因は、ゲストに届いた本文を自分で見られなかったこと。以前の「返金あり」確認は、家族の開発者が転送した1通だけだった。小林さんの条件は、内訳と返金額が一目で分かる、OTPの用途と有効時間が目立つ、iPhone標準メールで表が横にはみ出さない。確認者は実質エンジニアで、確認は仕組み化されていない。_

- 佐藤 美咲 (pm) [DECISION]: 解決の中心は「送る」ではなく「送らずに全シナリオの本文を並べて見られる」ことに置く。送信は Mailpit を既定にし、Resend は実機確認用に宛先を自分のアドレスに限って明示的に選んだときだけ使う。理由: ゲストへの誤送信と Resend 無料枠の消費を避けるため。トレードオフは、実機確認に一手間かかること。

- 佐藤 美咲 (pm) [ADVANCE]: End of phase "discovery".

### iteration 1 · planning

- — Phase "planning" started (iteration 1) — PM turns findings into a small, shippable scope: [TASK] items with clear acceptance criteria, each assigned to an engineer. Engineers challenge feasibility, split or re-assign tasks, and agree on tech choices.

> _佐藤 美咲 (pm) [thinks]: 最小スコープに絞る。優先は、送らずに全シナリオを並べて見られること、タスクが動くこと、文言を固定すること。管理画面プレビュー、スマホで開く導線、誰が確認したかの記録は次イテレーションに回す。_

- 佐藤 美咲 (pm) → eng-backend, eng-frontend: 佐藤です。このイテレーションの範囲は次の4つです。
  1. シナリオを1か所にまとめる
  2. send-mail を直す
  3. 送らずに全部並べて見られる HTML 書き出し
  4. golden テストをシナリオ共有にする
  
  管理画面プレビューは今回やりません。本番に出すかの判断が要るためです。ゲストに送らず見られることを最優先にします。
  技術選択で懸念があれば先に言ってください。特に次の2点です。
  - 実行方法: 依存は増やさずに、`mail.ts` の拡張子なし import を解決できるか。
  - 外部 API キーが無い環境で、何を未検証として残すか。

- 佐藤 美咲 (pm) [TASK]: T1 owner=eng-backend: メールシナリオを1か所に定義し、5種類すべてを網羅する
  - `app/lib/` 配下に、メール種別・シナリオ名・入力データ・期待する件名を持つ定義ファイルを1つ置く。スクリプト・プレビュー・テストはすべてここを参照する。
  - 5種類 (予約確定、キャンセル、ログイン OTP、予約前メール確認 OTP、宿泊後) を含む。
  - 予約確定: 通常料金2泊(内訳あり)、内訳なし、無料招待(0円)。
  - キャンセル: 返金100%、返金50%、返金0%(返金なし)。
  - 宿泊後: 招待リンクあり、なし(`postStayEnabled` の切替)。
  - 各シナリオは `buildXxx` を呼んで件名と HTML/テキスト本文を返せる。
  - サンプルに実在のゲスト情報を使わない。
  - `pnpm test:run` と `npx tsc --noEmit` が通る。
  - 実装前に spec (`docs/specs/`) へ Business Risk Review 5カテゴリを書く。

- 佐藤 美咲 (pm) [TASK]: T2 owner=eng-backend: `mise run send-mail` を動くようにし、5種類・シナリオ指定・一括送信に対応する
  - `mise run send-mail` が `ERR_MODULE_NOT_FOUND` で落ちずに起動する。依存追加はしない。
  - gum で種類とシナリオを選べる。「全シナリオ一括」も選べる。
  - 既定の送信先は Mailpit(`MAILPIT_URL`)。
  - Resend で送るのは明示的に選んだときだけ。宛先は環境変数で指定した自分のアドレス1件に限り、それ以外は送信前にエラーで止まる。
  - 一括送信で Resend は使えない。
  - 実 API キーがないため Resend 経路は未検証。モックのユニットテストで宛先制限だけ確認し、未検証である旨を `docs/mail.md` に書く。
  - 個人情報・メールに触れるので pii-review の観点で差分を確認する。

- 佐藤 美咲 (pm) [TASK]: T3 owner=eng-frontend: 全シナリオを送らずに並べて見られる HTML を書き出す (`mise run preview-mail`)
  - 1コマンドで全シナリオの HTML を1つの一覧ページに書き出し、ブラウザで開ける。送信は一切しない。
  - 各シナリオに、種類、シナリオ名、件名を表示する。
  - 本文は幅375pxの枠(iPhone 想定)で並べて表示し、表の横はみ出しがあればその場で分かる。
  - キャンセルの返金100% / 50% / 0%、内訳なし、無料招待、OTP 2種が同じ画面で見比べられる。
  - 出力先は git 管理外のディレクトリにする。
  - 書き出した本文のうち、金額・返金額・OTP の用途と有効時間が読める位置にあるか、エンジニアが目視確認する。確認結果を完了報告に書く。

- 佐藤 美咲 (pm) [TASK]: T4 owner=eng-backend: 全メール種別 × 主要シナリオを golden テストで固定する (シナリオ共有)
  - 上記シナリオ定義を使い、全シナリオの件名と本文を固定する。OTP 2種と宿泊後メールの golden も新規に追加する。
  - 既存の `mail-golden.test.ts` の2パターンは、新しい仕組みに移して内容が変わらないことを確認する。
  - 形式は `toMatchFileSnapshot` を推奨する。文言を変えると差分がファイル単位で PR に見える。理由: HTML 完全一致の文字列より、レビューで読みやすい。反対意見があれば教えてください。
  - 文言をわざと1語変えるとテストが落ち、スナップショット更新で差分が出ることを確認する。
  - `pnpm test:run` が通る。

- 佐藤 美咲 (pm) [DECISION]: 今回のイテレーションは (1) シナリオ定義 (2) send-mail 修復と5種類対応 (3) 送らず並べて見る HTML 書き出し (4) golden をシナリオ共有で固定、の4つに絞る。管理画面プレビュー、誰が何を確認したかの記録、中村さんが自分のスマホで見る導線は次イテレーションに回す。理由: 先に文言を安全に確認できる土台を作るため。トレードオフは、中村さんが直接見られるのは次回以降になること。

> _佐藤 美咲 (pm) [notes]: iteration 1 の範囲は、シナリオ定義、send-mail 修復と5種類対応、HTML 書き出しプレビュー、golden のシナリオ共有。Mailpit 既定で、Resend は宛先を自分1件に限定する。未着手で次に回すのは、管理画面プレビュー(本番に出すか未決)、中村さんがスマホで見る導線、誰が何を確認したかの記録。_

> _田中 健 (eng-backend) [thinks]: vite は直接の devDependency、vite-node は無い (vitest 4 は同梱しない)。vite の ssrLoadModule なら依存追加なしで拡張子なし import と `~` エイリアスを解決できるはず。ただし未検証。_

- 田中 健 (eng-backend): 田中です。結論から言います。4つとも着手できます。T1・T2・T4 は私が持ちます。懸念は3点です。
  
  1. **実行方法 (T2/T3 共通)**: `vite-node` は `package.json` にありません。vitest 4 も同梱していないので、使うと依存追加になります。代わりに、直接の devDependency である `vite` (^7.3.6) の `createServer` と `ssrLoadModule` で `mail.ts` を読み込みます。これで拡張子なし import と `~` エイリアスを vite config 経由で解決できます。依存追加はゼロです。実装の最初に、この方法で5種類ぶんのビルドが通るか試します。通らなければ `vite build --ssr` で1ファイルにまとめる方法に切り替えます。
     - 共通ローダーを `scripts/lib/load-mail.ts` に1つ置きます。T3 の preview-mail も同じものを使ってください (鈴木さん)。T3 はシナリオ定義 (T1) とこのローダーが前提です。私が先に出します。
  
  2. **Resend の安全策 (T2)**: 宛先は `MAIL_PREVIEW_TO` のような環境変数1件だけにします。これと一致しない宛先は、API を呼ぶ前に例外で止めます。さらに「一括送信 × Resend」は、コード上で組み合わせ自体を拒否します (gum で選べない、というだけにはしません)。既存の `isRecipientAllowed` と `LOCAL_MAIL_BLOCKED_MESSAGE` が使えるか確認し、再利用できれば流用します。Resend 経路は実キーが無いので未検証です。検証するのは宛先制限のモックテストだけで、その旨を `docs/mail.md` に書きます。
  
  3. **golden (T4)**: `toMatchFileSnapshot` に賛成です。ファイルは `app/lib/__snapshots__/mail/<種別>-<シナリオ>.html` と `.subject.txt` に分けます。件名とテキスト本文は別ファイルにします。リスクは1つあります。HTML が1行に潰れていると、スナップショットにしても差分が読めません。書き出すときに最小限の整形 (タグ単位の改行) を入れるか、実物を見て判断します。既存2パターンは、移行前後でバイト一致することを確認してから、旧テストを消します。
  
  補足: サンプルのゲスト名・メールは `example.com` / `.test` などの架空値に固定し、シナリオ定義に載せます。着手順は T1 (spec の Business Risk Review → シナリオ定義)、T4、T2 です。

> _田中 健 (eng-backend) [notes]: 実行方法の方針: vite-node は package.json に無く vitest 4 も同梱しない。scripts は vite の createServer + ssrLoadModule で mail.ts を読む案 (依存追加なし、未検証)。Resend は宛先を環境変数1件に限定し、一括送信×Resend はコードで拒否する。golden は toMatchFileSnapshot で件名とHTMLを別ファイルにする。_

> _鈴木 ひかり (eng-frontend) [thinks]: Planning phase, no file edits. Respond with feasibility, agree on the loader, raise concerns on T3, and note the dependency on T1/loader._

- 鈴木 ひかり (eng-frontend): 鈴木です。T3 は着手できます。田中さんの方針(vite の `ssrLoadModule` で共通ローダー `scripts/lib/load-mail.ts`)に乗ります。T3 は T1 のシナリオ定義とそのローダーが前提なので、それが出るまでは一覧ページ側の HTML/CSS の骨組みを先に作ります。懸念と提案は4点です。
  
  1. **375px の枠は iframe の `srcdoc` で作ります。** 一覧ページの CSS が本文に混ざると、見え方が実機とズレます。iframe なら幅375pxで本文だけが折り返されるので、表のはみ出しも実機に近い形で分かります。はみ出しは iframe 内に横スクロールが出るので目で分かります。さらに `scrollWidth > clientWidth` を小さな JS で測り、「横はみ出しあり」の赤いバッジを付けます。目視だけに頼らないためです。
  2. **メールクライアントは再現しません。** iframe はブラウザの描画です。Gmail や iPhone のメールアプリは CSS の扱いが違います(`<style>` の一部が無視されるなど)。この一覧で分かるのは「文言・金額の位置・折り返し」までで、実機の見え方は Resend 経由の確認が要ります。完了報告にも、そう書きます。
  3. **一覧ページの使い勝手。** 上にシナリオ目次(種類ごとにグループ、キーボードで飛べるリンク)を置き、返金100/50/0%の見比べ用に「種類で絞り込み」を付けます。JS が動かなくても全件が見えるようにします。件名は枠の上に大きく出し、本文のテキスト版(text/plain)は折りたたみで見られるようにします。
  4. **出力先は `.preview/mail/index.html`** にします。`.gitignore` への追加が要るので、T2 の田中さんと衝突しないよう、`.gitignore` は私が触ります。
  
  田中さんに確認です。
  
  - 各シナリオから `{ kind, scenario, subject, html, text }` が取れる形(T1 の戻り値)で良いですか。ラベルに使う日本語名(例:「キャンセル / 返金50%」)も定義側に持たせてほしいです。
  - `.preview/` を出力先にして良いですか。
  
  中村さんの「3つ目の条件」(誰が何を確認したか)は今回やりませんが、一覧に生成日時とコミットのハッシュを出しておけば、次回の記録に使えます。これは小さいので T3 に含めます。

> _佐藤 美咲 (pm) [thinks]: 田中さんと鈴木さんの提案はどれも範囲内で、反対する点はない。ここで確定する事項は、ローダー、戻り値の形、出力先、スナップショット形式、着手順。T3 の追加分(生成日時とハッシュ、はみ出しバッジ)は小さいので認める。タスクは作り直さず、変更点をここで明記して計画を終える。_

- 佐藤 美咲 (pm) → eng-backend, eng-frontend: 提案どおりで進めてください。確定事項と、タスクへの追加です。
  
  1. 共通ローダー `scripts/lib/load-mail.ts` は田中さんが最初に出します。vite の `ssrLoadModule` で、依存追加なしです。5種類のビルドが通らなければ `vite build --ssr` に切り替えます。切り替えたら、その理由を完了報告に書いてください。
  2. T1 の戻り値は `{ kind, scenario, label(日本語名), subject, html, text }` で OK です。鈴木さんの要望どおり、日本語ラベルも定義側に持たせます。
  3. 出力先は `.preview/mail/index.html` で OK です。`.gitignore` は鈴木さんだけが触ります。
  4. T3 への追加を認めます。
     - 生成日時とコミットのハッシュを一覧に出します。
     - 横はみ出しの検出バッジを付けます。
     - JS なしでも全件が見えるようにします。
  
     バッジは補助で、目視確認は残します。iframe はブラウザの描画なので、Gmail と iPhone 標準メールの見え方は保証しません。完了報告にそう書いてください。
  5. golden は `toMatchFileSnapshot` で進めます。件名と本文は別ファイルにします。HTML が1行で差分が読めない場合は、タグ単位の改行を入れてよいです。ただし、整形は golden と preview の両方で同じ関数を使ってください。
  6. 既存2パターンは、バイト一致を確認してから旧テストを消します。確認結果を完了報告に書いてください。
  7. 着手順は T1(spec の Business Risk Review → シナリオ定義)→ ローダー → T4 / T2 / T3 を並行、です。
  
  完了報告に必ず書くこと:
  - 実行したゲスト向けの金額・返金額・OTP の目視確認結果
  - Resend 経路が未検証であること

- 佐藤 美咲 (pm) [DECISION]: golden は `toMatchFileSnapshot` を採用する。ファイルは `app/lib/__snapshots__/mail/<種別>-<シナリオ>.html` と `.subject.txt`、`.text.txt` に分ける。HTML の整形関数は golden と preview で共有する。理由: 文言変更の差分を PR で読めるようにするため。トレードオフは、スナップショット更新を雑に承認すると文言変更を見逃すこと。レビューでは差分を必ず読む。

- 佐藤 美咲 (pm) [DECISION]: メールの読み込みは、直接の devDependency である vite の `ssrLoadModule` を使った共通ローダー `scripts/lib/load-mail.ts` に統一する。send-mail と preview-mail はこれを使う。依存は追加しない。プレビューの出力先は `.preview/mail/` で、git 管理外とする。理由: 依存を増やさず、拡張子なし import の問題を直すため。トレードオフは、vite の内部 API に依存すること。

> _佐藤 美咲 (pm) [notes]: planning round 2 で技術選択が確定した。ローダーは vite の `ssrLoadModule`(失敗時は `vite build --ssr`)。golden は `toMatchFileSnapshot` で、件名・html・text を別ファイルにする。プレビューの出力先は `.preview/mail/index.html` で、生成日時・コミットのハッシュ・横はみ出しバッジを付ける。iframe の描画は実機のメールクライアントと同じではない。Resend 経路は実キーがなく未検証。次イテレーションに回すのは、管理画面プレビュー(本番に出すか未決)、中村さんがスマホで見る導線、誰が何を確認したかの記録。_

- 佐藤 美咲 (pm) [ADVANCE]: End of phase "planning": 4つのタスクと技術選択が確定した。

### iteration 1 · build

- — Phase "build" started (iteration 1) — Engineers implement their own tasks in the workspace (real files, runnable code, tests when sensible), coordinate interfaces with each other, and mark finished work with [TASK_DONE].

- 田中 健 (eng-backend) [TASK_UPDATE]: T1 → doing

- 田中 健 (eng-backend) [TASK_UPDATE]: T2 → doing

- 田中 健 (eng-backend) [TASK_UPDATE]: T4 → doing

> _田中 健 (eng-backend) [notes]: T1・T2・T4 完了。シナリオ定義は `app/lib/mail-scenarios.ts`、ローダーは `scripts/lib/load-mail.ts`。Resend 経路は実キーが無く未検証で、モックの宛先制限テストのみ。`npx tsc --noEmit` の `dist/.vite/manifest.json` 不在エラーは今回の変更とは無関係の既存エラー (build 前のため)。_

- 田中 健 (eng-backend) [TASK_UPDATE]: T1 → done: シナリオを 1 か所に定義した。spec は `docs/specs/2026-10-16-mail-preview-design.md` に Business Risk Review 5 カテゴリで書いた。
  - 定義は `app/lib/mail-scenarios.ts`。5 種類で計 11 シナリオ。
    - 予約確定: breakdown / no-breakdown / free-invitation
    - キャンセル: refund-100 / refund-50 / refund-0
    - ログイン OTP: magic-link / code-only
    - 予約前メール確認 OTP: code
    - 宿泊後: with-invitations / without-invitations
  - 各シナリオは `kind`、`scenario`、`label` (日本語名)、`expectedSubject`、`build()` を持つ。`buildMailScenario(s)` が `{ kind, scenario, label, subject, html, text }` を返す。
  - 宿泊後の招待あり/なしは `buildPostStayEmail` の引数で切り替える。`villaConfig` は書き換えない。
  - サンプルは架空値に固定した (山田花子、`example.com`、OTP は `000000`)。テストで、HTML 内の URL が `example.com` と `share.google` 以外にならないことも確認している。
  - 鈴木さんへ: `MAIL_SCENARIOS`、`buildMailScenario`、`formatHtmlForSnapshot`、`scenarioId` を使ってください。HTML の整形は golden と同じ `formatHtmlForSnapshot` です。ただし、プレビューの本文 iframe には整形前の生 HTML (`html`) を入れてください。ローダーは `loadMailModules()` で `{ mail, scenarios, mailFrom, close }` を返します。使い終わったら `close()` が必要です。
  - `text` は HTML から機械的に作った確認用です。`mail.ts` に text 版はありません。

- 田中 健 (eng-backend) [TASK_UPDATE]: T2 → done: `send-mail` を直し、5 種類・シナリオ指定・一括送信に対応した。
  - 原因は、素の `node` では `mail.ts` の拡張子なし import と `~` エイリアスを解決できないこと。`scripts/lib/load-mail.ts` で、vite の `createServer` + `ssrLoadModule` に統一した。`vite.config.ts` は使わず (honox などで重い)、alias だけを渡す。依存は追加していない。`vite build --ssr` への切り替えは不要だった。
  - 実行確認は Node v22.22 まで。issue の v25.6.1 では未実行。
  - 使い方は、`mise run send-mail`、または `node scripts/send-template-mail.ts <all|種類-シナリオ> [宛先] [--resend]`。`--list` で一覧を出す。
  - gum は「Mailpit: 全シナリオ一括」「Mailpit: シナリオを選ぶ」「Resend: シナリオを選ぶ」の 3 択。
  - 既定は Mailpit。`MAILPIT_URL` が無いときは、Resend に切り替えずエラーで止まる。
  - Resend は `--resend` を明示したときだけ。宛先は `.dev.vars` の `MAIL_PREVIEW_TO` 1 件に限る。次のどれも API を呼ぶ前に止まる。
    - 宛先の不一致
    - カンマ区切り
    - `Name <addr>` 形式
    - `all` との組み合わせ
    - 例外メッセージに宛先は含めない。
  - `.dev.vars` の `MAGIC_LINK_BASE_URL` が本番の値でも、スクリプト側でローカル判定に固定する。`sendMail` 既存の歯止めを迂回できないようにするため。
  - テストは `scripts/lib/send.test.ts` に 10 件以上。fetch をモックし、宛先制限、一括×Resend 拒否、Mailpit にフォールバックしないこと、全件が Mailpit に届くことを確認した。
  - 疑似 Mailpit (127.0.0.1:8025) に対して `all` を実行し、11 通が届くことを確認した。誤宛先、`all --resend`、`MAILPIT_URL` なしは、すべて exit 1 で止まる。
  - `docs/mail.md` に「文言の確認」と「未検証」の節を追加した。
  - pii-review の観点で自己確認した。実在のゲスト情報や宛先をエラー・ログ・snapshot に出していない。本番コードの `mail.ts` ほかは無変更。独立したレビューはまだ受けていない。
  - **未検証**
    - Resend 経路は実キーが無く、実際には送っていない。
    - gum の対話部分は実行していない。mise の bash は構文チェックのみで、中で呼ぶ `node` コマンドは実行した。
    - Gmail / iPhone での見え方も未確認。

- 田中 健 (eng-backend) [TASK_UPDATE]: T4 → done: 全シナリオを `toMatchFileSnapshot` で固定した。
  - テストは `app/lib/mail-scenarios.test.ts`。snapshot は `app/lib/__snapshots__/mail/<種別>-<シナリオ>.{subject.txt,html,text.txt}` で、計 33 ファイル。OTP 2 種と宿泊後の golden も新規に入った。
  - **旧 golden との一致**: 旧 `mail-golden.test.ts` の予約確定 (内訳なし) とキャンセル (50%) の期待文字列を、一時テストで新シナリオの HTML と `toBe` 比較し、バイト一致を確認した。確認後に旧テストを削除した。旧の「内訳あり」テストは breakdown シナリオの snapshot に置き換わった。
  - **文言変更の検知**: `mail.ts` の「ご予約が確定しました」を 1 語変えると、予約確定の 3 シナリオが落ちた。`-u` で 6 ファイル (html と text) が更新された。確認後に文言を戻し、snapshot も戻した。
  - 補足の文言テストも追加した。
    - 返金 50% の金額と率が表示されること
    - 返金 0% で「返金はございません」が出ること
    - OTP の用途と「10分間有効」が出ること
    - 招待なしの宿泊後メールに「招待」が出ないこと
  - `.oxfmtrc.json` の ignore に `app/lib/__snapshots__` を追加した。これを入れないと `pnpm lint` が snapshot を整形しようとして落ちる。
  - 品質ゲートの結果
    - `pnpm test:run`: 160 ファイル / 1518 テスト通過 (最終変更前に実行)
    - `pnpm lint`: 通過
    - `npx tsc --noEmit`: 上記の既存エラー以外なし
  - 雑に `-u` で承認すると文言変更を見逃す。レビューでは snapshot の差分を必ず読んでください。

- 田中 健 (eng-backend) → eng-frontend, pm: 田中です。T1・T2・T4 は完了です。詳細は各完了報告にあります。
  - 鈴木さん: T3 は `MAIL_SCENARIOS` と `loadMailModules()` をそのまま使えます。`.preview/mail/index.html` の出力先で問題ありません。本文には整形前の `html` を入れてください。
  - 注意: 金額・返金額・OTP の用途と有効時間の目視確認は T3 の完了条件です。text 版 snapshot (`.text.txt`) は、本文が読める順に並んでいるかの確認に使えます。
  - PM さん: Resend 経路は未検証のまま残ります。完了報告と `docs/mail.md` に明記しました。

- 鈴木 ひかり (eng-frontend) [TASK_UPDATE]: T3 → doing: 一覧ページの描画部分に着手しました。

- 鈴木 ひかり (eng-frontend) → eng-backend: 鈴木です。T3 は、一覧ページを組み立てる部分まで出来ています。まだ完了にはしていません。
  
  - できたもの:
    - `scripts/lib/render-preview.ts`: 純粋関数 `renderPreviewPage(entries, {generatedAt, commit})` です。
    - 本文は 375px の iframe `srcdoc` に入れます。
    - 横はみ出し検出バッジ、種類での絞り込み、テキスト版の折りたたみ、シナリオ目次を付けました。
    - JS を止めても全件が見えます。
    - 単体テストは 2 件で、通っています。
    - `.gitignore` に `.preview/` を追加しました。
    - `mise.toml` に `preview-mail` タスクを追加しました。このタスクは `node scripts/preview-mail.ts` を呼びます。
  - まだのもの:
    - 実データでの生成と、金額・返金額・OTP の目視確認ができていません。
    - T1 のシナリオ定義と `scripts/lib/load-mail.ts` がワークスペースにまだ無いためです。
  - 田中さんへのお願い:
    - 出す順は、シナリオ定義、ローダーの順でお願いします。
    - 入力は `{ kind, scenario, label, subject, html, text }` の配列を想定しています。
    - `kind` は表示にそのまま出ます。日本語名の種別が使えるなら、定義側に持たせてください。
    - 配列を返す関数名とローダーの呼び方が決まったら教えてください。`scripts/preview-mail.ts` はそれに合わせて書きます。
    - 整形関数は、あなたが golden 用に作る方を `html` に適用して渡してもらえれば、こちらは何もしません。
  - コミットのハッシュは `git rev-parse --short HEAD` で取ります。取れなければ `unknown` と表示します。

> _鈴木 ひかり (eng-frontend) [notes]: T3 の進捗: `scripts/lib/render-preview.ts` とそのテスト、`.gitignore` の `.preview/`、`mise.toml` の `preview-mail` は作成済み。残りは `scripts/preview-mail.ts`(T1 のシナリオ定義と `scripts/lib/load-mail.ts` が前提)、実データでの生成、目視確認、完了報告。完了報告には、Resend 経路が未検証であることと、iframe は Gmail / iPhone 標準メールの見え方を保証しないことを必ず書く。_

- 田中 健 (eng-backend) → eng-frontend: 田中です。ワークスペースで実物を確認しました。`scripts/preview-mail.ts` は次の呼び方で書けます。
  - `import { loadMailModules } from './lib/load-mail.ts'`
  - `const { scenarios, mail, close } = await loadMailModules()`。使い終わったら `close()` を呼んでください。
  - `scenarios` から `MAIL_SCENARIOS` を取り、`buildMailScenario(s)` で `{ kind, scenario, label, subject, html, text }` を得ます。
  - `scenarios` にはほかに `MAIL_KIND_LABELS`（種別の日本語名）、`scenarioId(s)`、`formatHtmlForSnapshot` があります。種別は `kind` の ID（例: `cancellation`）で入るので、表示には `MAIL_KIND_LABELS[kind]` を使ってください。
  - 本文の iframe には整形前の `html` を入れてください。`formatHtmlForSnapshot` は snapshot 専用です。
  - 実行確認は Node v22 までです。`.preview/` の生成と目視確認は鈴木さんの T3 の範囲です。値の確認は、生成後に私も `.text.txt` と見比べます。

- 鈴木 ひかり (eng-frontend) [TASK_UPDATE]: T3 → done: `mise run preview-mail` で全 11 シナリオを `.preview/mail/index.html` に書き出せます。送信処理は一切呼びません。ただし、ブラウザで開いての確認とはみ出しバッジの動作は未確認です。この環境にはブラウザの実体が無く、playwright は実行できませんでした。
  
  **ファイル**
  - `scripts/preview-mail.ts`(新規): `loadMailModules()` で `MAIL_SCENARIOS` を読み、`buildMailScenario` の結果を渡します。
    - iframe には整形前の生 HTML を入れています。
    - 生成日時と `git rev-parse --short HEAD` のハッシュを一覧に出します。ハッシュが取れなければ `unknown` です。
  - `scripts/lib/render-preview.ts`: 種類の日本語名(`MAIL_KIND_LABELS`)を出すため `kindLabel` を追加しました。
  - `.gitignore` に `.preview/`、`mise.toml` に `preview-mail` を追加しました。
  - 実行は `mise run preview-mail` か `node scripts/preview-mail.ts` です。
  - `pnpm exec vitest run scripts/lib` は 15 件通りました。このコマンドは `scripts/lib` 配下のテスト全体を対象にしているため、`render-preview.test.ts` と、田中さんの `send.test.ts` の両方を含みます。
  - `kindLabel` 追加後の `pnpm test:run` 全体、`pnpm lint` は実行していません。
  
  **目視確認(`.text.txt` snapshot と HTML のスタイルを読んだ結果)**
  - 金額: 予約確定は合計金額が内訳なしで `¥123,456`、無料招待で「無料」と読めます。
    - キャンセルは「お支払い金額」「返金金額」「適用返金率」が上から並びます。
    - 50% は `¥61,728` と `50%`、0% は `¥0` と `0%` です。
  - 返金の説明: 50% は「返金はお支払い時のカードに対して行われます」、0% は「キャンセルポリシーに基づき、返金はございません」が出ます。
    - 気づいた点が 1 つあります。0% の「返金はございません」は、キャンセルポリシー表の下にあります。小林さんは返金の有無をすぐ知りたいので、表の上に出す案を次の回で PM に相談したいです。今回は文言を変えていません。
  - OTP: 2 種とも見出しの直下に用途と「10分間有効」があり、コードの前に読めます。
    - ログイン用は「以下の認証コードを入力してください。このコードは10分間有効です。」です。
    - 予約前確認用は「ご予約の確認メールをお送りするため、…メールアドレスをご確認ください。」と、有効時間が同じ段落に入っています。
    - コードは 36px、letter-spacing 8px の 6 桁です。幅は約 180px で、375px に収まる計算です。
  - 横はみ出し: 全 table が `width:100%` で、固定幅と `nowrap` はありません。本文は `max-width:600px` です。静的には、はみ出す要因は見当たりません。
    - 実際の `mypage` URL は長くなります。サンプルの `example.com` では再現しないので、実機で確認が必要です。
  
  **未検証**
  - ブラウザでの表示、`scrollWidth` による「横はみ出しあり」バッジの動作、本文高さの自動調整は未確認です。生成された HTML とテストまでしか確認できていません。ブラウザのある環境で開いて確認してください。
  - iframe はブラウザの描画なので、Gmail や iPhone 標準メールの見え方は保証しません。実機確認は Resend 経由が必要です。
  - Resend 経路は、田中さんの報告どおり実キーが無く未検証です。

> _鈴木 ひかり (eng-frontend) [notes]: T3 は `scripts/preview-mail.ts` まで実装し、`.preview/mail/index.html` の生成は確認済み。ブラウザが無く、はみ出しバッジの動作と iframe 表示は未確認。返金 0% の「返金はございません」はポリシー表の下にある。次回、表の上に出すかを PM と相談する。_

### iteration 1 · review

- — Phase "review" started (iteration 1) — Engineers review each other's work against the acceptance criteria and fix issues. PM checks every task against its acceptance criteria and states what is ready for users.

- 田中 健 (eng-backend): 田中です。T3 をレビューしました。結論は、受け入れ条件は満たしています。ただし、ブラウザでの確認は残っています。
  
  確認したのは次の4点です。
  - `pnpm test:run` は 160 ファイル / 1518 テストが通りました。`pnpm lint` も通りました。
  - `npx tsc --noEmit` のエラーは、`dist/.vite/manifest.json` が無いという既存の1件だけです。build 前なので今回の変更とは無関係です。
  - `node scripts/preview-mail.ts` で iframe が 11 個の一覧ができました。送信処理は呼んでいません。
  - iframe の `srcdoc` は `esc()` を通しています。`sandbox="allow-same-origin"` でスクリプトも動きません。メール本文が一覧ページを壊すことはありません。
  
  指摘は2点です。どちらも修正の必要はありません。
  1. はみ出しバッジは、この環境にブラウザが無いため動作を確認できていません。ブラウザのある環境で、実際の `mypage` URL に近い長い URL を入れて確認してください。
  2. 鈴木さんが挙げた0%の「返金はございません」の位置は、文言の変更になります。今回は動かさず、次のイテレーションで佐藤さんが判断してください。
  
  私の T1・T2・T4 は、鈴木さんから修正依頼を受けていません。引き続き未検証なのは次の3点です。
  - Resend 経路
  - gum の対話部分
  - Gmail / iPhone での見え方

- 鈴木 ひかり (eng-frontend): 鈴木です。田中さんの T1・T2・T4 を、画面側の視点でレビューしました。ワークスペースで実際に `node scripts/preview-mail.ts` を再実行して確認しています。
  
  **確認できたこと**
  - 11 シナリオ分の iframe が書き出されました。送信は呼んでいません。
  - OTP の 3 シナリオ(ログイン用 2 種、予約前確認 1 種)で、用途と「10分間有効」がコードより前の同じ段落にあります。小林さんの「有効時間が目立ってほしい」は、位置の面では満たしています。
  - 返金 0% の「返金はございません」が `.text.txt` の 13 行目にあることを再確認しました。
  
  **田中さんへの修正依頼はありません。** `kindLabel` を追加した後の私の変更は、田中さんが `pnpm test:run` と `pnpm lint` で通してくれています。私の実行は `pnpm exec vitest run scripts/lib` までです。
  
  **次回に回す提案**
  1. 返金 0% の文言を、キャンセルポリシー表の上に出すか決めます。文言の変更なので、golden の差分が出ます。この回は動かしません。
  2. 中村さんの 3 つ目の条件(誰が何を確認したか)は、一覧に出した生成日時とコミットのハッシュを土台にします。
  3. 中村さんが自分のスマホで見る導線を作ります。ローカル限定の管理画面プレビューか、Resend 経由で自分宛てに送る運用のどちらかです。
  
  **まだ未検証のもの**
  - ブラウザでの表示。はみ出しバッジの動作も含みます。
  - 実際の `mypage` URL のように長い URL でのはみ出し。
  - Gmail と iPhone 標準メールの見え方。iframe はブラウザの描画なので、保証しません。
  - Resend 経路と gum の対話部分。

> _鈴木 ひかり (eng-frontend) [notes]: レビュー(iteration 1)で、T1・T2・T4 に修正依頼は出なかった。次回に回すもの: 返金 0% の文言位置、確認記録、中村さんのスマホ導線。ブラウザ表示・長い URL でのはみ出し・実機・Resend・gum 対話は未検証のまま残る。_

> _佐藤 美咲 (pm) [thinks]: 受け入れ条件に照らして T1〜T4 を確認した。未検証が残る点は、完了と混ぜずに明記する。レビューは 1 ラウンドなので、ここで締めて次に回す。_

- 佐藤 美咲 (pm): 佐藤です。T1〜T4 を受け入れ条件で確認しました。
  
  **受け入れる(条件を満たしています)**
  - T1: 5 種類 11 シナリオが 1 か所にあり、サンプルは架空値です。spec に Business Risk Review も書かれています。
  - T2: 既定は Mailpit です。Resend は `--resend` と `MAIL_PREVIEW_TO` 1 件に限られ、一括送信との組み合わせは拒否されます。モックのテストで確認済みです。
  - T3: 1 コマンドで 11 シナリオが 375px の枠で並びます。送信はしません。金額・返金額・OTP の目視結果も報告にあります。
  - T4: `toMatchFileSnapshot` で全シナリオを固定しました。旧 2 パターンのバイト一致と、1 語変更でテストが落ちることも確認済みです。田中さんが再実行して `pnpm test:run`(1518 件)と `pnpm lint` が通りました。`tsc` は既存の 1 件だけです。
  
  **使える状態になったこと**
  - エンジニアは、ゲストに送らずに全パターンの本文を並べて確認できます。
  - 文言を変えると、PR で差分が見えます。
  - 実機で見たいときは、自分宛て 1 件に限って Resend で送れます。
  
  **まだ言えないこと(未検証)**
  - ブラウザでの表示と、はみ出しバッジの動作。
  - 実際の `mypage` のような長い URL でのはみ出し。
  - Resend 経路、gum の対話部分、Node v25.6.1 での実行。
  - Gmail と iPhone 標準メールの見え方。
  - 中村さんが自分のスマホで見る導線は、まだありません。中村さんの 3 条件のうち満たせているのは「全パターンを並べて見られる」までで、見るのはまだエンジニア経由です。
  
  **小林さん・中村さんへ**
  OTP の用途と「10分間有効」はコードの前にあります。内訳と返金額も上から読める位置にあります。実機での崩れは、まだ保証できません。

- 佐藤 美咲 (pm) [DECISION]: 返金 0% の「返金はございません」をキャンセルポリシー表の上に出すかどうかは、次イテレーションで扱う。今回は文言を動かさない。理由: 小林さんは返金の有無を先に知りたいが、これは文言変更であり、golden の差分をレビューする作業が要る。トレードオフは、次回まで現状の位置が残ること。

- 佐藤 美咲 (pm) [DECISION]: 次イテレーションの先頭に、ブラウザのある環境での確認を置く。確認するのは、はみ出しバッジの動作、長い URL でのはみ出し、Node v25 での `send-mail` の実行の 3 つ。理由: 今回の「完了」にはこれらの未検証が残っているため。その後に、中村さんがスマホで見る導線を決める(ローカル限定の管理画面プレビューか、自分宛て Resend か)。

> _佐藤 美咲 (pm) [notes]: iteration 1 のレビュー結果: T1〜T4 は受け入れ済みで、未検証が残る。
  - 未検証: ブラウザ表示とはみ出しバッジ、長い mypage URL、Resend 経路、gum の対話部分、Node v25.6.1 での実行、Gmail と iPhone 標準メール。
  - 次イテレーションの候補: 返金 0% の文言位置(golden 差分あり)、中村さんがスマホで見る導線(管理画面プレビューを本番に出すかは未決)、誰が何を確認したかの記録(生成日時とコミットのハッシュが土台)。_

- 佐藤 美咲 (pm) [ADVANCE]: End of phase "review": T1〜T4 を受け入れた。未検証は明記して次イテレーションに回す。

### iteration 1 · acceptance

- — Phase "acceptance" started (iteration 1) — Users try what was built (read the workspace, run it if possible) and judge it from their own needs. Each user gives a [VERDICT accept|reject] with reasons. PM summarizes and decides next steps.

> _小林 直子 (user-guest) [thinks]: 私はターミナルを使わないので、直接は試せない。報告の範囲で、自分の困りごとに効くかを判断する。_

- 小林 直子 (user-guest) [VERDICT]: ACCEPT: 私が直接触れるものではありませんが、「直したあとに誰も確認していない」という私の不安には、土台として答えてくれていると思います。
  
  - 返金100% / 50% / 0%、内訳なし、無料招待、ログインコードのメールを、ゲストに送らず全部並べて見られるようになりました。
  - 金額や返金額が上から読める位置にあること、ログインコードの用途と「10分間有効」がコードより前にあることを、確認した結果として報告してもらえました。
  - 文言を変えるとテストが落ち、差分がレビューで見えます。金額の書き方が黙って変わる心配は、かなり減りました。
  - 実際に送るのは Mailpit が既定で、Resend は自分宛て1件に限られています。個人情報に敏感な私は、ここは安心できます。
  
  まだ満足はしていません。次回、次の点をお願いします。
  
  1. **返金0%の「返金はございません」の位置。** 今はキャンセルポリシー表の下にあります。私が一番知りたいのは、返金があるかないかです。表の上に出してください。次回に回すという判断は理解しますが、優先度は高いです。
  2. **スマホでの崩れの確認。** ブラウザでの表示、実際の長い URL でのはみ出し、iPhone 標準メールでの見え方が、まだ確認されていません。私は iPhone の標準メールで読むので、ここが崩れていたら使えません。「確認済み」と言えるのは、実機で見てからにしてください。
  3. **「確認済み」という表現。** 今回確認できたのは文言と位置までで、見た目はまだです。そこを区別して書いてください。

- 中村 誠 (user-owner): 中村です。正直に言います。今回できたものは、私自身はまだ使えません。ただ、土台としては筋が通っています。
  
  良かった点です。
  - 返金100%・50%・0%、内訳なし、無料招待を、ゲストに送らず並べて見られます。去年の半日は、これが見られなかったために潰れました。
  - 既定の送信先が Mailpit です。Resend は自分宛て1件に限られ、一括送信とは組み合わせられません。誤送信で一番怖いのはここなので、安心しました。
  - 文言を変えるとテストが落ち、差分が PR に出ます。
  
  足りない点です。
  1. **私のスマホで見る手段がまだありません。** 見られるのは今もエンジニア経由です。去年と同じで、家族の返事を夕方まで待つことになります。次回の最優先にしてください。
  2. **確認した記録がありません。** 日時とハッシュが出るだけでは、誰が何を確認したかは分かりません。何か起きたときに後から追えないと、私は安心できません。
  3. **ブラウザの表示と Gmail・iPhone での見え方が未確認です。** 小林さんと同じ意見です。「確認済み」と書くのは、実機で見てからにしてください。
  4. **返金0%の「返金はございません」が、キャンセルポリシー表の下にあります。** 返金なしの案内が一番読まれる場面です。ここを間違えるとクレームになります。表の上に出してください。変えるときは、変更前後を並べて見せてください。
  
  スマホで見る方法は、管理画面の中より自分宛ての Resend のほうが私は好みです。外部サービスへの依存が増えないからです。ただし送り先が自分のアドレスに限られることが前提です。管理画面に置く場合は、本番で誤って出ない作りにしてください。

> _中村 誠 (user-owner) [notes]: 中村さんのスマホ導線の好みは、自分宛て Resend（宛先は自分1件に限定）。管理画面に置くなら、本番で出ない保証が必須。確認記録（誰が・いつ・何を）も必須。返金0%の「返金はございません」は表の上に出すよう要望済み。変更時は変更前後を並べて見たい。_

- 中村 誠 (user-owner) [VERDICT]: ACCEPT: 土台として受け入れます。ゲストに送らず、珍しいパターンも含めて全部並べて見られる点は、去年の半日の原因に効きます。誤送信を防ぐ歯止めも納得できます。ただし、私の3つの安心条件のうち満たされたのは「全パターンを並べて見られる」だけです。しかも、見るのはまだエンジニア経由です。スマホで見る手段、確認の記録、実機での確認は、次回の必須条件です。

> _佐藤 美咲 (pm) [thinks]: 両ユーザーとも ACCEPT だが、次回の条件が明確。受け入れ結果をまとめ、次イテレーションの優先順位を決める。ここで新たな事実確認は不要。_

- 佐藤 美咲 (pm): 佐藤です。両名とも ACCEPT でした。今回は「土台として受け入れ」で、「確認済み」とは言いません。
  
  **今回言えること**
  - 文言・金額・返金額・OTP の位置は、ゲストに送らず並べて確認できます。
  - 文言を変えると PR で差分が見えます。
  - 誤送信の歯止めがあります。既定は Mailpit で、Resend は自分宛て 1 件だけです。
  
  **言えないこと**
  - 見た目(ブラウザ、長い URL、Gmail / iPhone 標準メール)は未確認です。「確認済み」と書くのは実機で見てからにします。
  - 中村さんがご自身のスマホで見る導線は、まだありません。
  - 誰が何を確認したかの記録も、まだありません。
  
  **次イテレーションの優先順位**
  1. ブラウザのある環境での確認。はみ出しバッジ、長い URL、Node v25 の `send-mail`。
  2. 返金 0% の「返金はございません」を表の上に出す。小林さんと中村さんの両方から要望がありました。中村さんの希望どおり、変更前後を並べて見せます。
  3. 中村さんがスマホで見る導線。
  4. 確認の記録。
  
  **スマホ導線の方向**
  中村さんのご意見を踏まえ、自分宛て Resend を第一候補にします。外部依存が増えず、宛先は自分 1 件に限れるためです。管理画面に置く場合は、本番で出ない作りにすることを条件にします。ただし Resend は実キーがなく未検証です。実キーでの確認が前提になります。

- 佐藤 美咲 (pm) [DECISION]: 次イテレーションの優先順位は、(1) ブラウザ環境での未検証 3 点の確認 (2) 返金 0% 文言を表の上へ移す。変更前後を並べて見せ、golden 差分をレビューする (3) 中村さんのスマホ導線 (4) 確認の記録、とする。スマホ導線は自分宛て Resend を第一候補とし、管理画面に置く場合は本番で出ない作りを条件にする。理由: 両ユーザーの要望が一致し、最も誤りが高くつく場面を先に解消するため。トレードオフは、スマホ導線と記録が 3 番目以降になること。

> _佐藤 美咲 (pm) [notes]: iteration 1 の acceptance: 小林さん・中村さんとも ACCEPT(土台として)。次回の必須条件は、(1) 実機・ブラウザでの確認と、確認済みと見た目未確認の区別 (2) 返金 0% 文言を表の上へ(変更前後を並べて提示) (3) 中村さんのスマホ導線(自分宛て Resend 優先、管理画面なら本番で出さない) (4) 確認の記録。「確認済み」は実機確認後にのみ使う。_

- 佐藤 美咲 (pm) [ADVANCE]: End of phase "acceptance": 両ユーザーが ACCEPT。未検証と次回の優先順位を明記した。

- — Session finished after iteration 1. 2/2 users accepted.
