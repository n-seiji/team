# villa-68

**Brief:** 既存プロダクト「Villa Karuizawa」(軽井沢の 1 棟貸し別荘の招待制予約サイト。HonoX + Cloudflare Workers + D1 + Stripe + Resend) に対する GitHub issue をチームで解決する。

- ワークスペースは villa リポジトリの作業コピー (git worktree) そのもの。ゼロから作らず、既存コードを読んで変更する。README.md は既存のものを保ち、新規 README は作らない。
- villa の CLAUDE.md と .claude/rules/ に従う。機能追加は実装前に Business Risk Review (.claude/rules/business-risk-review.md の 5 カテゴリ) を spec に書く (例: docs/specs/ 配下)。個人情報・認証・メールに触れる変更は .claude/skills/pii-review/SKILL.md の観点で差分を確認する。
- 品質ゲート: `pnpm test:run` (ユニット)、`npx tsc --noEmit`、`pnpm lint` 相当。依存の追加は避ける (pnpm の 7 日ルールあり)。外部 API キーは無いので、外部サービスはモックかインターフェースまでで止め、何が未検証かを明記する。
- git の commit / push はしない (ファシリテーターが最後にまとめる)。
- ユーザー役: 小林さん (リピーターのゲスト) と中村さん (オーナー兼運営者)。
- issue の「検討事項」で決まっていない点は、チームで決めて理由を残す。スコープが大きければ 1 イテレーションで出せる最小の価値に絞り、残りは明記する。

以下が issue 本文。
# villa#68 全端末からログアウトできるようにする

## 背景
#59 でマイページのセッションを 24 時間 → 3 日 + スライディング更新に延ばした。使い続けている端末は事実上切れないので、端末を紛失した・共用 PC でログインしたままにした場合に、予約情報（氏名・住所・電話）の閲覧とキャンセル（返金）を第三者ができる時間が延びる。

現在のログアウトは `/mypage/logout` で **その端末の Cookie を消すだけ**。他の端末のセッションは切れない。

## 案
署名付き Cookie はサーバー側に状態を持たないので、失効させるには何かしらの版管理が要る。

- ゲストごとに `session_epoch`（整数）を持ち、Cookie のペイロードに含める。ログイン時の値と一致しなければ無効。「全端末からログアウト」で epoch を +1
- 保存先: 予約者メール単位なので専用テーブルか、`reservations` とは別の軽いテーブル。メールは PII 暗号化済みなので `guest_email_hash` をキーにする（#51 参照）
- マイページに「他の端末からもログアウトする」ボタン

## 検討事項
- そこまでの必要性があるか。3 日で自然に切れるので、緊急時は「3 日待つ」でも実害は小さいかもしれない
- 実装するなら OTP ログイン・招待セッション・法人見学セッションのどれに適用するか（予約者のマイページだけで十分か）

**Status:** done · iteration 1/2 · phase `acceptance`

## Team

- **佐藤 美咲** (`pm`, pm)
- **田中 健** (`eng-backend`, engineer)
- **鈴木 ひかり** (`eng-frontend`, engineer)
- **小林 直子** (`user-guest`, user)
- **中村 誠** (`user-owner`, user)

## Backlog

- T1 [todo] owner=eng-backend session_epoch の保存と Cookie 検証（マイページのみ）
    acceptance: - `guest_email_hash` をキーにした epoch 用の軽いテーブルを D1 マイグレーションで追加する。メールの平文は保存しない。
    - マイページ Cookie のペイロードに epoch を含める。ログイン時に現在の epoch を入れる。
    - Cookie の epoch が現在値と一致しなければ未ログインとして扱う。
    - epoch を持たない既存 Cookie は epoch 0 として有効にする。デプロイしても既存ログインが切れない。
    - スライディング更新（3 日）の挙動は変えない。更新後も epoch を引き継ぐ。
    - epoch が未登録のゲストは epoch 0 として扱う。
    - ユニットテストで、一致で有効、不一致で無効、epoch なしの既存 Cookie で有効、更新後も epoch を維持、の 4 点を確認する。
    - 招待セッションと法人見学セッションは変更しない。
- T2 [todo] owner=eng-backend 「他の端末からログアウト」エンドポイント
    acceptance: - ログイン済みのゲストが POST すると、そのゲストの epoch が +1 される。
    - 押した端末には新しい epoch の Cookie を再発行し、ログインを維持する。他の端末の Cookie は次のリクエストで無効になる。
    - 未ログインでの POST は何も変更せず、ログインへ誘導する。
    - CSRF 対策は、villa の既存 POST 系と同じ方式に合わせる。
    - 完了後はマイページへリダイレクトし、完了を知らせるフラッシュメッセージを出す。
    - ログ・監査に残すのは操作の事実だけにする。メールや氏名などの個人情報は出さない。
    - テストで、別 Cookie が無効になること、押した端末が有効なままであること、他のゲストの epoch は変わらないこと、を確認する。
- T3 [todo] owner=eng-frontend マイページに「他の端末からログアウトする」ボタンと完了表示
    acceptance: - マイページの既存ログアウトの近くにボタンを置く。
    - ボタン近くに一言添える。例:「共用の端末や、なくした端末のログインを切ります。この端末はログインしたままです。」
    - 押したあと「他の端末からログアウトしました」と表示される。既存のフラッシュバナー部品を使う。
    - 誤操作を防ぐため、確認は 1 段だけ（確認ダイアログか確認ページ）にする。JS なしでも動く form POST にする。
    - 既存の「ログアウト」（この端末のみ）の動作と文言は変えない。
    - 表示のテストを追加する。
- T4 [todo] owner=eng-backend spec と PII レビュー
    acceptance: - `docs/specs/` に spec を書く。Business Risk Review の 5 カテゴリを埋める。
    - 対象外（招待・法人見学・管理画面からの強制失効）と、その理由を明記する。
    - PII レビューの観点で差分を確認し、結果を spec に書く。
    - 外部サービスに依存しない。未検証の点があれば明記する。
    - `pnpm test:run`、`npx tsc --noEmit`、lint が通る。
- T5 [done] owner=eng-backend T1 session_epoch の保存と Cookie 検証（マイページのみ）
    acceptance: - D1 マイグレーション 0021（追加のみ）で `guest_session_epochs(email_key TEXT PRIMARY KEY, epoch INTEGER NOT NULL DEFAULT 0, updated_at TEXT)` を作る。
    - `email_key` は `COOKIE_SECRET` による鍵付きハッシュ（接頭辞 `session-epoch:`）にする。平文メールと `reservations.guest_email_hash` は使わない。
    - Cookie のペイロードは `{email, epoch?}` にする。ログイン時だけ DB の現在値を入れる。
    - 検証は `guestAuth` と `readGuestSession` の両方から、同じ 1 つの関数で行う。
    - epoch が一致しなければ未ログイン扱いにする。DB 読み取りに失敗した場合も未ログイン扱いにする。
    - epoch なしの既存 Cookie と、epoch が未登録のゲストは epoch 0 として扱う。デプロイしても既存ログインは切れない。
    - スライディング更新（3 日）は変えない。更新時は検証で得た epoch を引き継ぐ。
    - 失効済み Cookie で `/mypage` を開くとログイン案内に誘導されることを、テストで確認する。
    - ユニットテストで、一致で有効、不一致で無効、epoch なしの既存 Cookie で有効、更新後も epoch を維持、DB 失敗で無効、の 5 点を確認する。
    - 招待セッションと法人見学セッションは変更しない。
    result: epoch テーブル(`migrations/0021_guest_session_epochs.sql`)、`session-epoch.ts`、Cookie ペイロードの epoch 対応、`guestAuth` と `readGuestSession` に共通の `resolveGuestSession`、ログイン時の epoch 付与を実装しました。DB 失敗時は未ログイン扱いです。`pnpm vitest run app/middleware` で確認できます。更新時の引き継ぎは、この作業コピーにスライディング更新がないため、ログイン時とボタン押下時の再発行で対応しました。
- T6 [done] owner=eng-backend T2 「他の端末からログアウト」エンドポイント
    acceptance: - ログイン済みのゲストが POST すると、そのゲストの epoch が `INSERT ... ON CONFLICT DO UPDATE SET epoch = epoch + 1` の 1 文で +1 される。
    - 押した端末には新しい epoch の Cookie を再発行し、ログインを維持する。他の端末の Cookie は次のリクエストで無効になる。
    - 未ログインでの POST は何も変更せず、ログインへ誘導する。
    - CSRF 対策は、既存のキャンセル POST と同じ方式に合わせる。トークンの取り方は鈴木さんに共有する。
    - 完了後は `/mypage` へリダイレクトし、`setFlash(c, 'success', '他の端末からログアウトしました', { path: '/mypage' })` を出す。
    - 監査には `guest_logout_all` の事実だけを残す。email、hash、氏名は出さない。
    - テストで、別 Cookie が無効になること、押した端末が有効なままであること、他のゲストの epoch は変わらないこと、二重押しでも壊れないこと、を確認する。先にテストを書く。
    result: `app/routes/mypage/logout-all.tsx` で `POST /mypage/logout-all` を実装しました。epoch を +1 し、押した端末に Cookie を再発行して、`/mypage` 用のフラッシュを出します。`pnpm vitest run app/routes/mypage/logout-all.test.ts` で確認できます。
- T7 [done] owner=eng-frontend T3 マイページのボタンと /mypage 用フラッシュ
    acceptance: - `setFlash` / `consumeFlash` に path 引数を足す（既定値は `/admin`）。`/admin` の既存の挙動は変えない。`flash.test.ts` に path ごとのテストを足す。これを最初に入れる。
    - `/mypage` の画面に、既存の FlashBanner で完了バナーを出す。
    - メールアドレス表示の下に `<details><summary>他の端末からログアウト</summary>` を置く。開くと説明文「共用の端末や、なくした端末のログインを切ります。この端末はログインしたままです。」と、form POST の「他の端末からログアウトする」ボタンが出る。
    - JS なしで動き、キーボードだけで操作できる。ボタンを押すまでは何も変わらない。
    - 既存の「ログアウト」は、別の form のまま、動作も文言も変えない。
    - 表示のテストを追加する。確認するのは、details と説明文、ボタンの文言、既存ログアウトが不変であること、バナーが出ること。
    result: flash の path 対応と、/mypage の「他の端末からログアウト」UI を入れました。
    - `app/lib/flash.ts`: `setFlash(c, kind, text, { path? })` と `consumeFlash(c, { path? })` を追加。既定値は `/admin` で、admin の既存の挙動は変わりません。
    - `app/lib/flash.test.ts`: path 省略で `/admin`、`/mypage` 指定で set と consume が同じ path になること（削除 Cookie も `/mypage`）を追加。
    - `app/routes/mypage/reservations/index.tsx`:
      - `consumeFlash(c, { path: '/mypage' })` の結果を、既存の `FlashBanner` で一覧の上に出します。
      - メールアドレス表示の下に、閉じた状態の `<details>` を置きました。summary は「他の端末からログアウト」。
      - 開くと説明文と、`POST /mypage/logout-all` の form ボタン「他の端末からログアウトする」が出ます。JS は不要で、キーボードだけで操作できます。
      - 既存の「ログアウト」の form は変えていません。
    - `app/routes/mypage/reservations/index.test.tsx`（新規）: details と説明文、ボタン文言、details が閉じていること、既存ログアウトの action と文言が不変で form が 2 つだけであること、flash の有無でバナーが出ることを確認します。
    - 確認コマンド:
      - `pnpm vitest run app/routes/mypage app/lib/flash.test.ts` は 33 件通過。
      - `pnpm lint` の oxlint は 0 件。
      - oxfmt は私のファイルを整形済み。残る指摘は `app/routes/api/auth/verify.ts` のみ（田中さんの変更中）。
      - `npx tsc --noEmit` の唯一のエラーは `dist/.vite/manifest.json` がないことで、ビルド前の既存のもの。
    - 未検証: 実ブラウザでの `<details>` の見た目と、`/mypage` path の Cookie の挙動。
- T8 [done] owner=eng-backend T4 spec と PII レビュー
    acceptance: - `docs/specs/` に spec を書く。Business Risk Review の 5 カテゴリを埋める。
    - キーを鍵付きハッシュにした理由（ローテーションで epoch が戻ることを防ぐため）と、`COOKIE_SECRET` を替えたときの影響を書く。
    - 対象外（招待、法人見学、管理画面からの強制失効、ログイン中の端末一覧）と、それぞれの理由を書く。
    - PII レビューの観点で差分を確認し、結果を書く。
    - 未検証の点を明記する。実 D1 でのマイグレーション適用と、実ブラウザでの Cookie 再発行。
    - `pnpm test:run`、`npx tsc --noEmit`、lint が通る。
    result: 前回の完了内容に追加で、ログイン時に epoch が Cookie に入ることのテストを `app/routes/api/auth/verify.test.ts` に足しました。`pnpm vitest run app/routes/api/auth/verify.test.ts` で確認できます。
- T9 [todo] owner=eng-backend デプロイ手順と「行は削除しない」を目につく所に置く
    acceptance: - `docs/specs/guest-logout-all.md` の冒頭に「デプロイ前に必ず読む」節を置き、マイグレーション 0021 を先に適用する順番と、未適用だと全員が未ログイン扱いになることを書く。
    - 同じ節に「`guest_session_epochs` の行は削除しない（0 に戻り、失効済み Cookie が復活する）」と、revert 時の影響（最大 3 日復活）を書く。
    - 既存 README の既存構成を保ち、新規 README は作らず、デプロイ手順を書く既存の箇所から spec へリンクする。
    - コードは変更しない。`pnpm test:run`、`npx tsc --noEmit`、lint が通る。

## Decisions

- (discovery, 佐藤 美咲 (pm)) 必要性は「実害の予防」ではなく「ゲストが自分で切れていると確認できる安心」とする。ログインの持続時間は変えない。切るのはゲストが明示的に操作したときだけにする。管理画面からの強制ログアウトは今回やらず、後回しとして記録する。
- (planning, 佐藤 美咲 (pm)) 今回の対象は予約者マイページ（OTP ログイン）のみ。招待・法人見学セッションと管理画面からの強制失効は後回しとして記録する。既存 Cookie は epoch 0 として有効のままにし、ログイン持続時間は変えない。押した端末はログイン維持（反対意見が出れば再検討）。
- (planning, 佐藤 美咲 (pm)) epoch テーブルのキーは `reservations.guest_email_hash` ではなく、`COOKIE_SECRET` による鍵付きハッシュ（接頭辞 `session-epoch:`）にする。理由は、PII 鍵ローテーションでキーが変わると epoch が 0 に戻り、ログアウト済みの Cookie が再び通るため。issue 本文とはずれるので、その理由を spec に残す。トレードオフとして、`COOKIE_SECRET` を替えると全 Cookie が署名不一致で切れる。そのとき epoch も戻るが、古い Cookie は元から通らないので実害はない。
- (planning, 佐藤 美咲 (pm)) epoch の検証は `guestAuth` と `readGuestSession` の両方から、同じ 1 つの関数で呼ぶ。DB の読み取りに失敗したら未ログイン扱いにして、安全側に倒す。トレードオフは、DB 障害中にマイページに入れないこと。ただし障害中は予約情報も読めないので許容する。
- (planning, 佐藤 美咲 (pm)) 確認は `<details>` を開いて form POST を押す 1 段にする。ボタンは「ログアウト」とは別の form で、メールアドレス表示の下に置く。文言は「他の端末からログアウト」(summary)、「他の端末からログアウトする」(ボタン)、完了表示は「他の端末からログアウトしました」で固定する。
- (planning, 佐藤 美咲 (pm)) フラッシュは `setFlash` / `consumeFlash` に path 引数を足し、既定値は `/admin` のままにする。変更は鈴木さんが持つ。田中さんの T2 はその後に `{ path: '/mypage' }` で呼ぶ。着手順は、鈴木さんの flash 変更を先に入れ、そのあと T2 とする。
- (review, 佐藤 美咲 (pm)) 今回の成果は、上記の未検証 4 点と、マージ前の条件(マイグレーション 0021 を先に適用する、PII レビューを別セッションで再確認する)を明記した上で、ユーザー受け入れに進める。コードの追加変更は行わない。理由は、受け入れ条件を満たしており、残りは実環境でしか確認できないため。
- (acceptance, 佐藤 美咲 (pm)) 今回の成果は両ユーザーの ACCEPT で受け入れる。公開は、マイグレーション 0021 の先行適用、別セッションでの PII 再確認、実 D1・実ブラウザ・#59 結合の確認、繁忙期を避けた日程、の 4 条件を満たしてから行う。理由は、残りのリスクが実環境でしか確認できず、順序ミスの影響が全ゲストのログアウトと大きいため。

## Verdicts

- iteration 1 · 小林 直子 (user-guest) · **accept** — 私の困りごとは解決します。共用 iPad のログインをスマホから自分で切れて、完了表示で確認できます。押した端末のログインは続き、ログインの手間も増えません。条件が 2 つあります。1 つ目は、マイグレーションを先に適用してから公開することです。2 つ目は、個人情報のレビューを別の人でもう一度行うことです。summary の分かりやすさは、次の改善でお願いします。
- iteration 1 · 中村 誠 (user-owner) · **accept** — ゲストの不安に答える手段が増え、運営の手間も設定も増えません。個人情報も残らず、監査ログで追えます。条件は 3 つです。(1) マイグレーション 0021 を先に適用してから公開する。(2) PII レビューを別セッションで再確認する。(3) 繁忙期を避けた日に公開する。実 D1 と実ブラウザでの確認も、公開前に必ず行ってください。

## Transcript

### iteration 1 · discovery

- — Session "villa-68" started. Brief: 既存プロダクト「Villa Karuizawa」(軽井沢の 1 棟貸し別荘の招待制予約サイト。HonoX + Cloudflare Workers + D1 + Stripe + Resend) に対する GitHub issue をチームで解決する。
  
  - ワークスペースは villa リポジトリの作業コピー (git worktree) そのもの。ゼロから作らず、既存コードを読んで変更する。README.md は既存のものを保ち、新規 README は作らない。
  - villa の CLAUDE.md と .claude/rules/ に従う。機能追加は実装前に Business Risk Review (.claude/rules/business-risk-review.md の 5 カテゴリ) を spec に書く (例: docs/specs/ 配下)。個人情報・認証・メールに触れる変更は .claude/skills/pii-review/SKILL.md の観点で差分を確認する。
  - 品質ゲート: `pnpm test:run` (ユニット)、`npx tsc --noEmit`、`pnpm lint` 相当。依存の追加は避ける (pnpm の 7 日ルールあり)。外部 API キーは無いので、外部サービスはモックかインターフェースまでで止め、何が未検証かを明記する。
  - git の commit / push はしない (ファシリテーターが最後にまとめる)。
  - ユーザー役: 小林さん (リピーターのゲスト) と中村さん (オーナー兼運営者)。
  - issue の「検討事項」で決まっていない点は、チームで決めて理由を残す。スコープが大きければ 1 イテレーションで出せる最小の価値に絞り、残りは明記する。
  
  以下が issue 本文。
  # villa#68 全端末からログアウトできるようにする
  
  ## 背景
  #59 でマイページのセッションを 24 時間 → 3 日 + スライディング更新に延ばした。使い続けている端末は事実上切れないので、端末を紛失した・共用 PC でログインしたままにした場合に、予約情報（氏名・住所・電話）の閲覧とキャンセル（返金）を第三者ができる時間が延びる。
  
  現在のログアウトは `/mypage/logout` で **その端末の Cookie を消すだけ**。他の端末のセッションは切れない。
  
  ## 案
  署名付き Cookie はサーバー側に状態を持たないので、失効させるには何かしらの版管理が要る。
  
  - ゲストごとに `session_epoch`（整数）を持ち、Cookie のペイロードに含める。ログイン時の値と一致しなければ無効。「全端末からログアウト」で epoch を +1
  - 保存先: 予約者メール単位なので専用テーブルか、`reservations` とは別の軽いテーブル。メールは PII 暗号化済みなので `guest_email_hash` をキーにする（#51 参照）
  - マイページに「他の端末からもログアウトする」ボタン
  
  ## 検討事項
  - そこまでの必要性があるか。3 日で自然に切れるので、緊急時は「3 日待つ」でも実害は小さいかもしれない
  - 実装するなら OTP ログイン・招待セッション・法人見学セッションのどれに適用するか（予約者のマイページだけで十分か）

- — Phase "discovery" started (iteration 1) — PM interviews the users to uncover their real situation, pains and jobs-to-be-done. Users answer strictly in character, with concrete episodes. No solutions yet.

> _佐藤 美咲 (pm) [thinks]: 論点は「本当に必要か」。ゲストが端末を紛失したり、共用PCでログインしたままにしたりした実例があるか、そのときどう対処したかを事実で確認する。運営側には、問い合わせや不正キャンセルの実例があったかを聞く。解決策の話はまだしない。_

- 佐藤 美咲 (pm) → user-guest, user-owner: 今日は #68 の件で、お二人の実際の経験を伺わせてください。まだ作るかどうかは決めていません。
  小林さんに伺います。①マイページには普段どの端末から入っていますか？スマホ、自宅PC、職場や旅先のPCなど、全部挙げてください。②自分以外の人も触るPCやタブレットでマイページにログインしたことはありますか？最後にそれをしたのはいつで、そのあとどうしましたか？③スマホを失くしたり、置き忘れたりしたことはありますか？そのとき最初にやったことは何でしたか？
  中村さんに伺います。①「ログアウトできない」「他人に予約を見られたかも」「端末を失くした」といった問い合わせを受けたことはありますか？最後はいつで、どう対応しましたか？②本人に覚えのないキャンセルや、予約情報の変更が起きたことはありますか？

> _佐藤 美咲 (pm) [notes]: 現状のログアウトは /mypage/logout でその端末の Cookie を消すだけ。セッションは #59 で「3日＋スライディング更新」に延びている。検討事項は2つ。(1)「3日待つ」で足りないほどの必要性があるか。(2) OTP・招待・法人見学のどのセッションに適用するか。discovery ではまず実際に起きた事例の有無を確かめる。_

> _小林 直子 (user-guest) [thinks]: 実体験から答える。端末はiPhoneメイン、自宅PC、職場PCは使わない。共用PCは使っていない。スマホ置き忘れは経験あり。_

- 小林 直子 (user-guest) → pm: ①普段は iPhone がほとんどです。たまに自宅のノートPCで、金額や予約内容をじっくり見たいときに開きます。職場のPCではやりません。仕事柄、個人情報を会社のPCに残したくないので。
  
  ②家族共用のiPadが家にあります。子どもも触るので、そこでログインしたことは一度あります。去年、泊まる前に持ち物のメールを子どもたちに見せようとして開いたときです。そのあとログアウトしたかは正直覚えていません。「ログアウトしたつもり」でしたが、確認はしていません。マイページに氏名・住所・電話番号が出ること、キャンセルで返金までできることは後から気づいて、少し怖くなりました。
  
  ③スマホは、去年の旅行帰りに駅のカフェで置き忘れて、30分くらいで気づいて取りに戻りました。最初にしたのは、「探す」で場所を確認して、ロック画面で止まっていることを確かめることです。そのときはマイページのことは頭に浮かびませんでした。メールや決済アプリのほうが心配で、そちらを先に確認しました。ただ、あとで「あのサイトはログインしたままだったかも」と思いました。
  
  ひとつ言うと、毎回招待コードやパスワードを探すのが嫌なので、ログインが続くこと自体はありがたいです。ただ、切れないのは不安にもなります。

> _中村 誠 (user-owner) [thinks]: PM の質問は①問い合わせ経験 ②覚えのない変更。ペルソナとして具体的に答える。実在データは無いので、オーナーとして自然な範囲で。過去の具体的事実を作りすぎず、慎重な人物像で。_

- 中村 誠 (user-owner) → pm: 中村です。順番に答えます。
  
  ①端末を失くした・見られたかもという問い合わせは、正直ほとんど記憶にありません。ただ「ログアウトってどこ？」「前のメールのリンクでまた入れてしまった」という類の質問は、ゲストから口頭で聞いたことがあります。鍵の受け渡しのときに「家族のタブレットで開いたけど大丈夫？」と聞かれたこともあります。そのときは「ログアウトしておいてください」と言うだけで、こちらでは何も確認できませんでした。そこが一番気持ち悪いところです。大丈夫かどうか、私の側から見えないんです。
  
  ②本人に覚えのないキャンセルや変更は、今のところ起きていません。招待制で、客層も限られていますから。ただ、起きたら大変なのはわかっています。キャンセルは返金に直結します。繁忙期の金曜や連休の予約が勝手に消えて、直前だと次の客も入れられない。返金の規定にもよりますが、金額も小さくありません。個人情報の漏れは、氏名・住所・電話が出るわけですから、それこそ一番避けたいトラブルです。
  
  なので「起きたことはないが、起きたときに私が打てる手がない」というのが現状です。3日待てばいいという話は、感覚的には長いです。ただ、頻度が低いのも確かで、そのために私の手間や設定の複雑さが増えるのは困ります。
  
  一つ伺いたいです。ゲスト本人が操作するのと、私が管理画面から操作するのとでは、事情が違うと思います。今回の件は、ゲスト側の話に限るのでしょうか。

> _中村 誠 (user-owner) [notes]: 実際の被害・問い合わせは今のところなし。困りごとは「起きたとき、オーナー側から状況が見えず打てる手がない」こと。ゲストから端末の相談を口頭で受けたことはある（鍵の受け渡し時）。複雑な設定が増えるのは嫌。_

> _佐藤 美咲 (pm) [thinks]: 中村さんの質問は重要。管理者側の操作は別スコープか確認が要る。事実としては、被害の実例はゼロ。ただ「見えない・打てる手がない」という不安が共通。小林さんは共用iPadで一度ログインし、ログアウトしたか未確認。もう1ラウンドで、実際の端末の行動と、緊急時に誰が何をしたいかを掘る。解決策にはまだ踏み込まない。_

> _佐藤 美咲 (pm) [notes]: discovery R1の事実: 被害の実例はゼロ(中村さん)。小林さんは去年、家族共用iPadでログインしログアウト未確認。スマホ置き忘れ時はマイページを思い出さなかった(メール・決済が先)。中村さんは「起きたときに打てる手がない」「ゲストが大丈夫か見えない」が不満。頻度が低いので運営の手間や設定の複雑化は避けたい。ログイン継続自体はゲストにとって便利(招待コード探しが面倒)。_

- 佐藤 美咲 (pm) → user-owner: ありがとうございます。まず中村さんの質問です。今回の issue はゲスト本人が自分のセッションを切る話が起点です。管理画面からの操作は、まだ範囲に入れるか決めていません。それを決めるために、事実を2つ伺います。①「家族のタブレットで開いたけど大丈夫？」と聞かれたのは、最後にいつですか？そのとき相手は何を一番心配していましたか？②もしその場で「このゲストのセッションを全部切れる」手段があったら、それを使う場面は過去に何回ありましたか？なければ「ない」で構いません。

- 佐藤 美咲 (pm) → user-guest: 小林さん、共用iPadの件を深掘りさせてください。①ログアウトしたか覚えていないとのことですが、その後にiPadでマイページを開き直したり、誰かに画面を見られたりしたことは、実際にありましたか？②今、iPadがログインしたままかどうかを確かめるとしたら、どうしますか？やったことはありますか？③「切れないのは不安」とのことですが、その不安で、実際に取った行動はありますか？たとえばパスワードを変えた、予約を確認し直した、などです。

> _中村 誠 (user-owner) [thinks]: PM の質問に答える。①最後にいつか、何を心配していたか ②手段があったら使った回数。実在データは作りすぎず、慎重に。_

- 中村 誠 (user-owner) → pm: 中村です。
  
  ①「家族のタブレットで開いたけど大丈夫？」と聞かれたのは、はっきりした日付は覚えていません。鍵の受け渡しのときで、ここ一、二年の間に一度か二度です。相手が一番気にしていたのは「他の人に予約や住所を見られないか」でした。キャンセルされる心配までは口にしていませんでした。私のほうは逆で、返金につながるキャンセルが気になりました。ただ、それをゲストに言うと不安にさせるので、「ログアウトしておいてください」とだけ答えました。
  
  ②「このゲストのセッションを全部切れる」手段があったら使った場面は、過去に「ない」です。実際にそれが必要になるほどの事態にはなっていません。
  
  ただ、一度か二度でも、その場で私が「大丈夫です」と言い切れる材料がなかったのは事実です。使う頻度は低くても、あるなら安心、という程度の話です。そのために管理画面が複雑になるなら、要りません。

> _中村 誠 (user-owner) [notes]: 「家族のタブレットで開いたけど大丈夫？」の相談は、ここ一、二年で一、二度、鍵の受け渡し時に口頭で受けた。ゲストの関心は情報を見られないか、私の関心は返金につながるキャンセル。オーナー側がセッションを切る手段を使う場面は過去にない。「あれば安心」程度で、複雑になるなら不要という立場。_

> _小林 直子 (user-guest) [thinks]: PMの質問①〜③に具体的に答える。実際の行動は特にしていない、が正直なところ。_

- 小林 直子 (user-guest) → pm: 小林です。順番にお答えします。
  
  ①iPadでの開き直しや、誰かに画面を見られたことは、私の知る限りありません。ただ「ない」と言い切れる材料もないんです。子どもがiPadで遊んでいて、履歴から勝手に開いた可能性は否定できません。
  
  ②確かめる方法は思いつきません。今ふと考えて、iPadでサイトを開いてみる、くらいです。やったことはありません。開いて入れてしまったら、それはそれで怖いですし。どこに「ログイン中の端末一覧」があるのかも、私には分かりません。
  
  ③不安で取った行動は、実はありません。パスワードを変えようにもパスワードがなく、招待コードとメールのリンクで入る仕組みですよね。何を変えれば安全になるのか分からず、「まあ大丈夫だろう」で終わりました。
  
  今日このやり取りで一番気になったのは、私が確認できないという点です。切れていると分かれば、それで安心できます。
  
  ひとつ条件があります。ログインが切れやすくなるのは困ります。旅行の予約前後に、毎回招待コードを探すのは嫌です。切るのは、私が「切る」と決めたときだけにしてほしいです。

> _小林 直子 (user-guest) [notes]: 小林さんは共用iPadで一度ログインしたまま。ログアウトしたか未確認で、確認手段も知らない。不安は「確認できないこと」。ログインの手間は増やしたくない。切るのは本人が決めたときだけ。_

> _佐藤 美咲 (pm) [thinks]: 十分な事実が揃った。実害ゼロ、でも「確認できない・打てる手がない」が共通。ログイン継続は守りたい。管理者操作は優先度低。discovery を終えて次へ進む。_

> _佐藤 美咲 (pm) [notes]: discovery 完了時点の事実: 被害の実例ゼロ。共通の課題は「切れているか確認できない」「大丈夫と言い切れる材料がない」。小林さんはログアウトを自分で決めたときだけ切りたく、ログインが切れやすくなるのは不可。中村さんは頻度が低いので、管理画面や設定が複雑になるなら不要。使う場面は過去にゼロ。_

- 佐藤 美咲 (pm): ありがとうございます。整理します。
  - 実害は両者とも今までゼロです。
  - 共通しているのは、切れているか確認できず、大丈夫と言い切れる材料がないことです。小林さんは「切れていると分かれば安心できる」、中村さんは「あるなら安心」とおっしゃいました。
  - 守る条件は2つです。ログインが今より切れやすくならないこと、運営の手間と画面の複雑さが増えないことです。
  - 中村さんの管理画面からの操作は、使う場面が過去にゼロだったので今回は範囲外にします。
  次のフェーズでスコープを絞ります。

- 佐藤 美咲 (pm) [DECISION]: 必要性は「実害の予防」ではなく「ゲストが自分で切れていると確認できる安心」とする。ログインの持続時間は変えない。切るのはゲストが明示的に操作したときだけにする。管理画面からの強制ログアウトは今回やらず、後回しとして記録する。

- 佐藤 美咲 (pm) [ADVANCE]: End of phase "discovery".

### iteration 1 · planning

- — Phase "planning" started (iteration 1) — PM turns findings into a small, shippable scope: [TASK] items with clear acceptance criteria, each assigned to an engineer. Engineers challenge feasibility, split or re-assign tasks, and agree on tech choices.

> _佐藤 美咲 (pm) [thinks]: スコープは予約者マイページのセッションだけにする。epoch の保存先、既存 Cookie の扱い、現在の端末をどうするかは、エンジニアの意見を聞いて詰める。_

- 佐藤 美咲 (pm): 発見フェーズの結論から、今回の最小スコープを提案します。
  - **対象**: 予約者のマイページ（OTP ログイン）だけ。招待セッションと法人見学セッションは入れません。小林さんの不安は予約情報（氏名・住所・電話、キャンセル）にあり、招待と見学では見える情報の重さが違うからです。トレードオフとして、そちらは今回は切れません。
  - **仕組み**: `guest_email_hash` をキーにした軽い `session_epoch` テーブルを置きます。Cookie に epoch を入れ、不一致なら無効にします。
  - **既存の Cookie**: epoch なしでも有効（epoch 0 扱い）にします。デプロイで全員が一斉にログアウトされると、小林さんの「切れやすくなるのは不可」に反するからです。
  - **操作**: ボタンを押したゲスト本人のときだけ epoch を +1 します。持続時間は変えません。管理画面からの操作も今回はやりません。
  - **今の端末**: 押した端末はログインを維持して、新しい epoch の Cookie を再発行する案です。再ログインの手間が増えないからです。反対があれば言ってください。
  - **完了表示**: 押したあと「他の端末からログアウトしました」と画面に出します。「切れたと分かる」ことが今回の価値の中心です。
  
  田中さんは、既存の署名 Cookie に epoch を足すときの落とし穴と、D1 のマイグレーションの形を確認してください。鈴木さんは、ボタンの置き場所と文言、確認ダイアログが要るかを見てください。

- 佐藤 美咲 (pm) [TASK]: T1 owner=eng-backend: session_epoch の保存と Cookie 検証（マイページのみ）
  - `guest_email_hash` をキーにした epoch 用の軽いテーブルを D1 マイグレーションで追加する。メールの平文は保存しない。
  - マイページ Cookie のペイロードに epoch を含める。ログイン時に現在の epoch を入れる。
  - Cookie の epoch が現在値と一致しなければ未ログインとして扱う。
  - epoch を持たない既存 Cookie は epoch 0 として有効にする。デプロイしても既存ログインが切れない。
  - スライディング更新（3 日）の挙動は変えない。更新後も epoch を引き継ぐ。
  - epoch が未登録のゲストは epoch 0 として扱う。
  - ユニットテストで、一致で有効、不一致で無効、epoch なしの既存 Cookie で有効、更新後も epoch を維持、の 4 点を確認する。
  - 招待セッションと法人見学セッションは変更しない。

- 佐藤 美咲 (pm) [TASK]: T2 owner=eng-backend: 「他の端末からログアウト」エンドポイント
  - ログイン済みのゲストが POST すると、そのゲストの epoch が +1 される。
  - 押した端末には新しい epoch の Cookie を再発行し、ログインを維持する。他の端末の Cookie は次のリクエストで無効になる。
  - 未ログインでの POST は何も変更せず、ログインへ誘導する。
  - CSRF 対策は、villa の既存 POST 系と同じ方式に合わせる。
  - 完了後はマイページへリダイレクトし、完了を知らせるフラッシュメッセージを出す。
  - ログ・監査に残すのは操作の事実だけにする。メールや氏名などの個人情報は出さない。
  - テストで、別 Cookie が無効になること、押した端末が有効なままであること、他のゲストの epoch は変わらないこと、を確認する。

- 佐藤 美咲 (pm) [TASK]: T3 owner=eng-frontend: マイページに「他の端末からログアウトする」ボタンと完了表示
  - マイページの既存ログアウトの近くにボタンを置く。
  - ボタン近くに一言添える。例:「共用の端末や、なくした端末のログインを切ります。この端末はログインしたままです。」
  - 押したあと「他の端末からログアウトしました」と表示される。既存のフラッシュバナー部品を使う。
  - 誤操作を防ぐため、確認は 1 段だけ（確認ダイアログか確認ページ）にする。JS なしでも動く form POST にする。
  - 既存の「ログアウト」（この端末のみ）の動作と文言は変えない。
  - 表示のテストを追加する。

- 佐藤 美咲 (pm) [TASK]: T4 owner=eng-backend: spec と PII レビュー
  - `docs/specs/` に spec を書く。Business Risk Review の 5 カテゴリを埋める。
  - 対象外（招待・法人見学・管理画面からの強制失効）と、その理由を明記する。
  - PII レビューの観点で差分を確認し、結果を spec に書く。
  - 外部サービスに依存しない。未検証の点があれば明記する。
  - `pnpm test:run`、`npx tsc --noEmit`、lint が通る。

- 佐藤 美咲 (pm) [DECISION]: 今回の対象は予約者マイページ（OTP ログイン）のみ。招待・法人見学セッションと管理画面からの強制失効は後回しとして記録する。既存 Cookie は epoch 0 として有効のままにし、ログイン持続時間は変えない。押した端末はログイン維持（反対意見が出れば再検討）。

> _佐藤 美咲 (pm) [notes]: planning R1 の合意案: 対象は予約者マイページのみ、epoch は guest_email_hash キー、既存 Cookie は epoch 0 で有効、押した端末は維持。後回し: 招待・法人見学セッション、管理画面からの強制失効、ログイン中の端末一覧。_

> _田中 健 (eng-backend) [thinks]: コードを確認した。落とし穴が 2 つある。1 つ目は、`reservations.guest_email_hash` が `v<n>:` の版付きで、PII 鍵ローテーションで値が変わること。2 つ目は、検証箇所が `guestAuth` と `readGuestSession` の 2 つあること。_

- 田中 健 (eng-backend): 田中です。結論から言います。方針は賛成で、T1〜T4 は私が持ちます。ただ、実装前に直すべき点が 2 つあります。
  
  1. **epoch テーブルのキーに `reservations.guest_email_hash` は使わない。** この列は `v<n>:` の版付きで、PII 鍵ローテーション(`app/lib/pii-rotation.ts`)のたびに値が変わります。キーが変わると epoch が 0 に戻ります。そうなると、ログアウト済みの古い epoch 0 の Cookie が、有効期限内なら再び通ってしまいます。これは小林さんが一番嫌がる「切ったはずが生きている」状態です。
     - 対策として、`COOKIE_SECRET` で鍵付きハッシュを取ります。`hashRateLimitKey` と同じ方式で、接頭辞は `session-epoch:` にします。キーはローテーションに依存しません。平文メールも保存しません。
     - issue 本文の「`guest_email_hash` をキー」とはずれます。理由は spec に残します。
     - テーブルは `guest_session_epochs(email_key TEXT PRIMARY KEY, epoch INTEGER NOT NULL DEFAULT 0, updated_at TEXT)` です。マイグレーションは 0021 で、追加のみです。
  2. **検証箇所は 2 つあり、両方に入れる。** `app/middleware/guest-auth.ts` の `guestAuth` と `readGuestSession` です。後者を忘れると `/mypage` のログイン済み判定が無効 Cookie を通してしまいます。epoch 検証は 1 つの関数にまとめて、2 箇所から呼びます。
  
  Cookie の形は次のとおりです。
  - ペイロードは `{email, epoch?}` です。`epoch` が無ければ 0 とみなし、既存 Cookie はそのまま通ります。署名方式は変えません。
  - 更新時は `verify` が返した epoch をそのまま引き継ぎます。「ログイン時」と「ボタン押下時」だけが DB の現在値を読んで Cookie に入れます。
  
  リスクを数字で言うと、マイページのリクエストごとに D1 の読み取りが 1 回増えます。主キー検索 1 件なので、件数的には許容です。DB 障害時は「未登録 = 0」ではなく、検証失敗として扱って安全側に倒します。
  
  T2 の補足です。
  - epoch の +1 は `INSERT ... ON CONFLICT DO UPDATE SET epoch = epoch + 1` の 1 文にします。二重押しでも壊れません。
  - 押した端末の Cookie は、新しい epoch で再発行します。
  - CSRF は、既存のキャンセル POST と同じ方式に合わせます。
  - 監査ログには `guest_logout_all` の事実だけを残し、email と hash は残しません。
  
  鈴木さんへ。フラッシュは、リダイレクト先に `?flash=` のような既存の仕組みがあればそれに乗せます。無ければ私が T2 側でクエリ名を決めて共有します。
  
  未検証の点は 2 つです。実 D1 でのマイグレーション適用と、実ブラウザでの Cookie 再発行です。ユニットテストと sqlite テストまでで止めます。テストは先に書きます。

> _田中 健 (eng-backend) [notes]: #68 の設計: epoch テーブルのキーは reservations.guest_email_hash ではなく COOKIE_SECRET の HMAC (接頭辞 session-epoch:)。理由は guest_email_hash が v<n>: 付きで PII 鍵ローテーションで変わり、epoch が 0 に戻って失効済み Cookie が復活するため。検証は guest-auth.ts の guestAuth と readGuestSession の両方に入れる。マイグレーションは 0021。_

- 鈴木 ひかり (eng-frontend): 鈴木です。T3 は引き受けます。コードを読んだところ、前提が 2 点ずれていました。
  
  1. **フラッシュは今 `/admin` 専用です。**
     - `app/lib/flash.ts` は Cookie の path が `/admin` 固定です。`/mypage` にはブラウザが送りません。
     - FlashBanner を使っているのも admin-layout だけで、`app/routes/mypage/reservations/index.tsx` には出す場所がありません。
     - 田中さんへ。`setFlash` / `consumeFlash` に path 引数を足す形（既定値は `/admin` のまま）を提案します。既存の admin の挙動は変わりません。
     - この変更は小さいので、T3 の私の側で持ちます。T2 は `setFlash(c, 'success', '他の端末からログアウトしました', { path: '/mypage' })` を呼んでください。文言はこの文字列で固定します。
     - `flash.test.ts` に path ごとのテストも足します。
  2. **確認は `<details>` にします。**
     - 確認ダイアログは JS が要ります。確認ページを挟むとルートが 1 つ増えます。
     - `<details><summary>他の端末からログアウト</summary>` を開くと、説明文と「他の端末からログアウトする」ボタンの form POST が出ます。JS なしで動き、キーボードだけで操作できます。ボタンを押すまでは何も起きないので、確認は 1 段になります。
     - 開く前は「ログアウト」の隣に小さなテキストリンク風で置きます。既存の「ログアウト」とは別の form にして、文言も動作も変えません。
     - 説明文は「共用の端末や、なくした端末のログインを切ります。この端末はログインしたままです。」を使います。
  
  ユーザーが迷いそうな点が 1 つあります。「ログアウト」の隣に似た名前が 2 つ並ぶと、どちらを押すか分かりにくくなります。そこで、1 つ目は「ログアウト」のまま変えません。2 つ目は一覧の上部ではなく、メールアドレス表示の下に「他の端末からログアウト」として分けて置きます。
  
  CSRF は、田中さんが T2 で決める方式に合わせます。hidden input が要るなら、トークンの取り方を共有してください。

- 鈴木 ひかり (eng-frontend) → pm: 佐藤さん、T3 の受け入れ条件に 2 点足したいです。
  - `/mypage` で完了バナーが出る。`/admin` の既存のフラッシュは変えない。
  - 他の端末からログアウトしたあとの「ログアウト済み Cookie で `/mypage` を開くとログイン案内に誘導される」表示は、T1 の側で確認する。

> _鈴木 ひかり (eng-frontend) [notes]: flash は Cookie path が `/admin` 固定のため、`/mypage` で使うには `app/lib/flash.ts` の set/consume に path 引数（既定は `/admin`）が要る。この変更は T3 で鈴木が持つ。確認 UI は `<details>` + form POST（JS 不要）にする。完了文言は「他の端末からログアウトしました」で固定。_

> _佐藤 美咲 (pm) [thinks]: 田中さんの鍵指定は妥当。鈴木さんの flash と details も妥当。受け入れ条件を更新して、計画フェーズを終える。_

- 佐藤 美咲 (pm) [DECISION]: epoch テーブルのキーは `reservations.guest_email_hash` ではなく、`COOKIE_SECRET` による鍵付きハッシュ（接頭辞 `session-epoch:`）にする。理由は、PII 鍵ローテーションでキーが変わると epoch が 0 に戻り、ログアウト済みの Cookie が再び通るため。issue 本文とはずれるので、その理由を spec に残す。トレードオフとして、`COOKIE_SECRET` を替えると全 Cookie が署名不一致で切れる。そのとき epoch も戻るが、古い Cookie は元から通らないので実害はない。

- 佐藤 美咲 (pm) [DECISION]: epoch の検証は `guestAuth` と `readGuestSession` の両方から、同じ 1 つの関数で呼ぶ。DB の読み取りに失敗したら未ログイン扱いにして、安全側に倒す。トレードオフは、DB 障害中にマイページに入れないこと。ただし障害中は予約情報も読めないので許容する。

- 佐藤 美咲 (pm) [DECISION]: 確認は `<details>` を開いて form POST を押す 1 段にする。ボタンは「ログアウト」とは別の form で、メールアドレス表示の下に置く。文言は「他の端末からログアウト」(summary)、「他の端末からログアウトする」(ボタン)、完了表示は「他の端末からログアウトしました」で固定する。

- 佐藤 美咲 (pm) [DECISION]: フラッシュは `setFlash` / `consumeFlash` に path 引数を足し、既定値は `/admin` のままにする。変更は鈴木さんが持つ。田中さんの T2 はその後に `{ path: '/mypage' }` で呼ぶ。着手順は、鈴木さんの flash 変更を先に入れ、そのあと T2 とする。

- 佐藤 美咲 (pm) [TASK]: T5 owner=eng-backend: T1 session_epoch の保存と Cookie 検証（マイページのみ）
  - D1 マイグレーション 0021（追加のみ）で `guest_session_epochs(email_key TEXT PRIMARY KEY, epoch INTEGER NOT NULL DEFAULT 0, updated_at TEXT)` を作る。
  - `email_key` は `COOKIE_SECRET` による鍵付きハッシュ（接頭辞 `session-epoch:`）にする。平文メールと `reservations.guest_email_hash` は使わない。
  - Cookie のペイロードは `{email, epoch?}` にする。ログイン時だけ DB の現在値を入れる。
  - 検証は `guestAuth` と `readGuestSession` の両方から、同じ 1 つの関数で行う。
  - epoch が一致しなければ未ログイン扱いにする。DB 読み取りに失敗した場合も未ログイン扱いにする。
  - epoch なしの既存 Cookie と、epoch が未登録のゲストは epoch 0 として扱う。デプロイしても既存ログインは切れない。
  - スライディング更新（3 日）は変えない。更新時は検証で得た epoch を引き継ぐ。
  - 失効済み Cookie で `/mypage` を開くとログイン案内に誘導されることを、テストで確認する。
  - ユニットテストで、一致で有効、不一致で無効、epoch なしの既存 Cookie で有効、更新後も epoch を維持、DB 失敗で無効、の 5 点を確認する。
  - 招待セッションと法人見学セッションは変更しない。

- 佐藤 美咲 (pm) [TASK]: T6 owner=eng-backend: T2 「他の端末からログアウト」エンドポイント
  - ログイン済みのゲストが POST すると、そのゲストの epoch が `INSERT ... ON CONFLICT DO UPDATE SET epoch = epoch + 1` の 1 文で +1 される。
  - 押した端末には新しい epoch の Cookie を再発行し、ログインを維持する。他の端末の Cookie は次のリクエストで無効になる。
  - 未ログインでの POST は何も変更せず、ログインへ誘導する。
  - CSRF 対策は、既存のキャンセル POST と同じ方式に合わせる。トークンの取り方は鈴木さんに共有する。
  - 完了後は `/mypage` へリダイレクトし、`setFlash(c, 'success', '他の端末からログアウトしました', { path: '/mypage' })` を出す。
  - 監査には `guest_logout_all` の事実だけを残す。email、hash、氏名は出さない。
  - テストで、別 Cookie が無効になること、押した端末が有効なままであること、他のゲストの epoch は変わらないこと、二重押しでも壊れないこと、を確認する。先にテストを書く。

- 佐藤 美咲 (pm) [TASK]: T7 owner=eng-frontend: T3 マイページのボタンと /mypage 用フラッシュ
  - `setFlash` / `consumeFlash` に path 引数を足す（既定値は `/admin`）。`/admin` の既存の挙動は変えない。`flash.test.ts` に path ごとのテストを足す。これを最初に入れる。
  - `/mypage` の画面に、既存の FlashBanner で完了バナーを出す。
  - メールアドレス表示の下に `<details><summary>他の端末からログアウト</summary>` を置く。開くと説明文「共用の端末や、なくした端末のログインを切ります。この端末はログインしたままです。」と、form POST の「他の端末からログアウトする」ボタンが出る。
  - JS なしで動き、キーボードだけで操作できる。ボタンを押すまでは何も変わらない。
  - 既存の「ログアウト」は、別の form のまま、動作も文言も変えない。
  - 表示のテストを追加する。確認するのは、details と説明文、ボタンの文言、既存ログアウトが不変であること、バナーが出ること。

- 佐藤 美咲 (pm) [TASK]: T8 owner=eng-backend: T4 spec と PII レビュー
  - `docs/specs/` に spec を書く。Business Risk Review の 5 カテゴリを埋める。
  - キーを鍵付きハッシュにした理由（ローテーションで epoch が戻ることを防ぐため）と、`COOKIE_SECRET` を替えたときの影響を書く。
  - 対象外（招待、法人見学、管理画面からの強制失効、ログイン中の端末一覧）と、それぞれの理由を書く。
  - PII レビューの観点で差分を確認し、結果を書く。
  - 未検証の点を明記する。実 D1 でのマイグレーション適用と、実ブラウザでの Cookie 再発行。
  - `pnpm test:run`、`npx tsc --noEmit`、lint が通る。

> _佐藤 美咲 (pm) [notes]: planning の最終合意: epoch キーは `COOKIE_SECRET` の鍵付きハッシュ（`session-epoch:`）。検証は guestAuth と readGuestSession の両方。DB 失敗は未ログイン扱い。フラッシュは path 引数を足して `/mypage` でも使う。確認は details の 1 段。着手順は flash の path 対応、T1、T2、T3 の表示、T4 の順。後回しは、招待・法人見学セッション、管理画面からの強制失効、端末一覧。_

- 佐藤 美咲 (pm): 田中さんの鍵の指摘と、鈴木さんの flash・details の提案を採用しました。田中さんの指摘を採ったのは、小林さんが一番嫌がる「切ったはずが生きている」を防ぐためです。トレードオフは、issue 本文の「`guest_email_hash` をキー」とずれることで、理由は spec に残します。着手順は、鈴木さんの flash の path 対応、田中さんの T1 と T2、鈴木さんの表示、田中さんの T4 の順です。未検証の点（実 D1、実ブラウザ）は spec に明記してください。

- 佐藤 美咲 (pm) [ADVANCE]: End of phase "planning".

### iteration 1 · build

- — Phase "build" started (iteration 1) — Engineers implement their own tasks in the workspace (real files, runnable code, tests when sensible), coordinate interfaces with each other, and mark finished work with [TASK_DONE].

- 田中 健 (eng-backend) [TASK_UPDATE]: T5 → doing

- 田中 健 (eng-backend) [TASK_UPDATE]: T6 → doing

> _田中 健 (eng-backend) [thinks]: T5 と T6 は実装してテストも通した。T8 の spec は次のラウンドに回す。実装中に、スライディング更新がコードにないことが分かったので、報告する。_

- 田中 健 (eng-backend): 田中です。T5・T6 を実装しました。`pnpm test:run` は 160 ファイル・1499 件が通り、`pnpm lint` も通っています。`npx tsc --noEmit` で出るエラーは `dist/.vite/manifest.json` が無いという 1 件だけで、ビルド成果物がないことによるもので今回の差分とは無関係です。
  
  **確認してほしい点(佐藤さん)**
  - この作業コピーには、スライディング更新の実装がありません。`sessionExpiryDays: 3` の固定期限が入っているだけで、リクエストごとの Cookie 再発行はコードにありません。
  - そのため「更新時に epoch を引き継ぐ」処理は、書く対象がありませんでした。
  - epoch を引き継いで Cookie を再発行するのは、ログイン時とボタン押下時の 2 箇所です。「再発行しても epoch が保たれる」ことは、`guest-auth.test.ts` の「再発行した Cookie」のケースで確認しています。
  - #59 のスライディング更新が別ブランチにあるなら、そちらをマージした時点で、検証済みの epoch を使って再発行する形に直す必要があります。
  
  **ファイル**
  - `migrations/0021_guest_session_epochs.sql`: テーブルを追加するだけです。
  - `app/db/repositories/session-epoch.ts`: `get` と `bump` があります。`bump` は `INSERT … ON CONFLICT DO UPDATE SET epoch = epoch + 1 RETURNING epoch` の 1 文です。
  - `app/lib/auth.ts`:
    - Cookie のペイロードは `{email, epoch?}` です。epoch が無い Cookie は 0 として扱います。
    - `hashSessionEpochKey` は `session-epoch:` を接頭辞にした HMAC です。メールは `trim` と小文字化をしてから使います。
    - 署名方式は変えていません。
  - `app/middleware/guest-auth.ts`:
    - 検証は新しい `resolveGuestSession` の 1 本で、`guestAuth` と `readGuestSession` の両方がこれを通ります。
    - epoch が一致しなければ null です。DB 読み取りが失敗した場合も null にしています。
  - `app/routes/api/auth/verify.ts`: ログイン時に DB の現在の epoch を Cookie に入れます。
  - `app/routes/mypage/logout-all.tsx`: `POST /mypage/logout-all` です。
    - 未ログインなら何も変えず `/mypage` に戻します。
    - ログイン済みなら epoch を +1 し、押した端末に新しい Cookie を再発行します。
    - `setFlash(c, 'success', '他の端末からログアウトしました', { path: '/mypage' })` を出します。
  - `app/types.ts` と `app/routes/admin/audit-logs/index.tsx`: 監査アクションを追加しました。
  - テスト:
    - `guest-auth.test.ts`: 一致で有効、不一致で無効、epoch なしの既存 Cookie で有効、DB 失敗で無効、`readGuestSession` でも無効、他のゲストの epoch の影響を受けない、の確認です。
    - `logout-all.test.ts`: 別 Cookie が無効になる、押した端末が有効なまま、他のゲストの epoch が変わらない、二重押しでも壊れない、未ログインでは何も起きない、監査とテーブルに PII がない、の確認です。
  
  **受け入れ条件から変えた点が 2 つあります**
  1. 監査アクション名は `guest_logout_all` ではなく `auth.logout_all` にしました。既存の `auth.login` や `auth.otp_sent` のようにドット区切りに揃えるためです。監査には actor_type `guest` と操作の事実だけを残し、`actor_email` は null です。email と hash は出しません。
  2. リダイレクト先は `/mypage` ではなく `/mypage/reservations` にしました。`/mypage` はログイン済みなら予約一覧へ再リダイレクトされるので、1 回で済ませるためです。フラッシュ Cookie の path は `/mypage` なので、予約一覧にも届きます。
  
  **鈴木さんへ**
  - CSRF は、キャンセル POST と同じく `server.ts` の `rejectCrossSiteRequest` が全 POST に効いています。トークンは要らず、hidden input も不要です。`<form method="post" action="/mypage/logout-all">` だけで動きます。
  - 完了バナーは、予約一覧(`app/routes/mypage/reservations/index.tsx`)で `consumeFlash(c, { path: '/mypage' })` を呼んで出してください。リダイレクト先がそこだからです。
  
  **未検証**
  - 実 D1 でのマイグレーション適用です。ここでは `node:sqlite` で確認しています。
  - 実ブラウザでの Cookie 再発行です。
  
  **次の作業**
  - T8 の spec と PII レビューは次のラウンドで書きます。
  - ログイン時に epoch が Cookie に入ることを検証するテストは、まだ足していません。必要なら T8 と合わせて追加します。

- 田中 健 (eng-backend) [TASK_UPDATE]: T5 → done: epoch テーブル(`migrations/0021_guest_session_epochs.sql`)、`session-epoch.ts`、Cookie ペイロードの epoch 対応、`guestAuth` と `readGuestSession` に共通の `resolveGuestSession`、ログイン時の epoch 付与を実装しました。DB 失敗時は未ログイン扱いです。`pnpm vitest run app/middleware` で確認できます。更新時の引き継ぎは、この作業コピーにスライディング更新がないため、ログイン時とボタン押下時の再発行で対応しました。

- 田中 健 (eng-backend) [TASK_UPDATE]: T6 → done: `app/routes/mypage/logout-all.tsx` で `POST /mypage/logout-all` を実装しました。epoch を +1 し、押した端末に Cookie を再発行して、`/mypage` 用のフラッシュを出します。`pnpm vitest run app/routes/mypage/logout-all.test.ts` で確認できます。

> _鈴木 ひかり (eng-frontend) [thinks]: 実装とテストは通った。tsc の dist manifest エラーは既存のもの。verify.ts の format 指摘は田中さんの作業中の差分なので触らない。_

- 鈴木 ひかり (eng-frontend) [TASK_UPDATE]: T7 → doing

- 鈴木 ひかり (eng-frontend) [TASK_UPDATE]: T7 → done: flash の path 対応と、/mypage の「他の端末からログアウト」UI を入れました。
  - `app/lib/flash.ts`: `setFlash(c, kind, text, { path? })` と `consumeFlash(c, { path? })` を追加。既定値は `/admin` で、admin の既存の挙動は変わりません。
  - `app/lib/flash.test.ts`: path 省略で `/admin`、`/mypage` 指定で set と consume が同じ path になること（削除 Cookie も `/mypage`）を追加。
  - `app/routes/mypage/reservations/index.tsx`:
    - `consumeFlash(c, { path: '/mypage' })` の結果を、既存の `FlashBanner` で一覧の上に出します。
    - メールアドレス表示の下に、閉じた状態の `<details>` を置きました。summary は「他の端末からログアウト」。
    - 開くと説明文と、`POST /mypage/logout-all` の form ボタン「他の端末からログアウトする」が出ます。JS は不要で、キーボードだけで操作できます。
    - 既存の「ログアウト」の form は変えていません。
  - `app/routes/mypage/reservations/index.test.tsx`（新規）: details と説明文、ボタン文言、details が閉じていること、既存ログアウトの action と文言が不変で form が 2 つだけであること、flash の有無でバナーが出ることを確認します。
  - 確認コマンド:
    - `pnpm vitest run app/routes/mypage app/lib/flash.test.ts` は 33 件通過。
    - `pnpm lint` の oxlint は 0 件。
    - oxfmt は私のファイルを整形済み。残る指摘は `app/routes/api/auth/verify.ts` のみ（田中さんの変更中）。
    - `npx tsc --noEmit` の唯一のエラーは `dist/.vite/manifest.json` がないことで、ビルド前の既存のもの。
  - 未検証: 実ブラウザでの `<details>` の見た目と、`/mypage` path の Cookie の挙動。

- 鈴木 ひかり (eng-frontend) → eng-backend: 田中さん、flash の path 対応が入りました。T6 は `setFlash(c, 'success', '他の端末からログアウトしました', { path: '/mypage' })` で呼べます。
  - フォームの action は `POST /mypage/logout-all` にしました。ルートを別名にするなら教えてください。ボタン側を合わせます。
  - CSRF は `rejectCrossSiteRequest` が Sec-Fetch-Site と Origin で見るヘッダ方式でした。hidden input やトークンは要りません。form には何も足していません。
  - 完了後のリダイレクトは `/mypage` でも `/mypage/reservations` でも、Cookie path `/mypage` で届きます。ただ `/mypage` は `/mypage/reservations` へさらにリダイレクトされるだけなので、フラッシュは一覧側で消費されます。
  - 私の差分外ですが、`pnpm lint` の oxfmt が `app/routes/api/auth/verify.ts` を指摘しています。`oxfmt --write` で直してください。

- 田中 健 (eng-backend) [TASK_UPDATE]: T8 → doing

- 田中 健 (eng-backend) [TASK_UPDATE]: T8 → done: spec と PII レビューを `docs/specs/guest-logout-all.md` に書きました。
  - spec の内容:
    - 仕組み
    - issue 本文からのずれ(キーを鍵付きハッシュにした理由、`COOKIE_SECRET` を替えたときの影響、#59 のスライディング更新がこの作業コピーに無いこと、監査アクション名を `auth.logout_all` にしたこと)
    - Business Risk Review の 5 カテゴリ
    - 対象外とその理由(招待、法人見学、管理画面からの強制失効、ログイン中の端末一覧、ログイン持続時間の変更)
    - PII レビュー
    - 未検証の点
  - PII レビューの指摘: `guest_session_epochs` が新しいテーブルなので、`db/schema.sql`、`db/README.md`、README の「暗号化の対象外」に追記しました。
  - 運用リスク(spec に明記):
    - **デプロイ順:** 先にマイグレーション 0021 を適用してください。未適用で新コードを出すと、epoch の読み取りが失敗して全員が未ログイン扱いになります。
    - **行は削除しない:** 消すと epoch が 0 に戻り、失効済みの Cookie が復活します。
    - **revert の影響:** revert すると旧コードは epoch を無視するので、ログアウト済みの Cookie が期限内なら最大 3 日復活します。
  - 確認結果:
    - `pnpm test:run` は 160 ファイル・1499 件が通りました。
    - `pnpm lint` は oxlint 0 件、oxfmt も整形済みです。
    - `npx tsc --noEmit` は `dist/.vite/manifest.json` が無いという既存の 1 件だけです。
    - 鈴木さんの指摘どおり oxfmt が `verify.ts` を指摘していましたが、現在は整形済みです。
  - PII レビューは私自身の確認です。skill の指示どおり、別セッションでの再確認を推奨します(佐藤さんに判断をお願いします)。
  - 未検証:
    - 実 D1 でのマイグレーション適用
    - 実ブラウザでの Cookie 再発行とフラッシュ Cookie の挙動
    - #59 のスライディング更新との結合

- 田中 健 (eng-backend) → pm, eng-frontend: 田中です。T8 を完了しました。spec は `docs/specs/guest-logout-all.md` です。品質ゲートは通っています(`tsc` は既存の `dist/.vite/manifest.json` 欠落のみ)。
  - **佐藤さんへ:** 事前に決めてほしい点が 2 つあります。
    1. デプロイはマイグレーション 0021 を先に適用する順にしてください。未適用だと全員が未ログイン扱いになります。
    2. PII レビューは私自身が確認したものです。別セッションでの再確認が必要か判断してください。
  - **#59 のスライディング更新について:** 別ブランチにあるなら、取り込み時に `resolveGuestSession` が返す epoch で Cookie を再発行する形に直す必要があります。
  - **鈴木さんへ:** `verify.ts` の oxfmt は直っています。表示側で私に確認したい点があれば言ってください。

> _鈴木 ひかり (eng-frontend) [thinks]: T7 は完了済み。残りは田中さんの確認依頼への返答だけ。リダイレクト先が /mypage/reservations になったので、バナーは一覧側で出る。実装済みで整合している。_

- 鈴木 ひかり (eng-frontend) → eng-backend, pm: 鈴木です。T7 は完了済みで、田中さんの T6 とも整合しています。
  - リダイレクト先 `/mypage/reservations` で、一覧がフラッシュを消費してバナーを出します。Cookie path は `/mypage` なので届きます。
  - CSRF はヘッダ方式なので、form に hidden input は不要です。こちらは追加していません。
  - 表示側で田中さんに確認したい点はありません。
  
  ユーザーが迷いそうな点を 2 つ挙げます。どちらも今回は変えません。
  1. 閉じた `<details>` は、初見だと「ただの見出し」に見えて開けることに気づきにくいです。summary に矢印のマーカーを残しているので、実機で見て判断します。
  2. 完了バナーは一覧の上に出ます。メールアドレス表示の下の `<details>` からは少し離れますが、スクロールしないと見えない位置ではありません。
  
  未検証は、実ブラウザでの `<details>` の見た目と、`/mypage` path のフラッシュ Cookie の挙動です。実ブラウザで確認するまで未検証として扱ってください。

> _田中 健 (eng-backend) [thinks]: T5〜T8 は完了済みで、全部 done。残りは、ログイン時に epoch が Cookie に入ることのテストが未追加という点。軽く確認できるが、このターンでは追加の作業はせず、状況を報告して終える。_

- 田中 健 (eng-backend) → pm: 田中です。担当の T5・T6・T8 は完了しています。品質ゲートは、`pnpm test:run` が 1499 件通過、lint 0 件、`tsc` は既存の `dist/.vite/manifest.json` 欠落のみです。
  
  残りの懸念は 3 点です。
  1. **ログイン時の epoch 付与にテストがありません。** `verify.ts` で DB の現在値が Cookie に入ることを、まだ直接検証していません。リスクは、ここが外れると再ログイン直後の Cookie が不一致になり、ログインできなくなることです。次のラウンドで、先にこのテストを足します。
  2. **デプロイ順です。** マイグレーション 0021 を先に適用してください。未適用だと全員が未ログイン扱いになります。この順序は spec に書いてあります。
  3. **#59 のスライディング更新です。** この作業コピーには入っていません。別ブランチにあるなら、取り込み時に `resolveGuestSession` が返す epoch で再発行する形に直す必要があります。
  
  PII レビューは私自身の確認です。別セッションでの再確認の要否は、佐藤さんに判断をお願いします。
  
  未検証は 3 点です。実 D1 でのマイグレーション適用、実ブラウザでの Cookie 再発行、#59 との結合です。

> _鈴木 ひかり (eng-frontend) [thinks]: T7 は完了済みで、追加作業は不要。このラウンドは短く状況をまとめて終える。_

- 鈴木 ひかり (eng-frontend): 鈴木です。T7(マイページのボタンと /mypage 用フラッシュ)は完了済みで、田中さんの T6 とも整合しています。追加の作業はありません。
  - **確認済み:** 表示のテストと lint は通っています。
  - **未検証:** 実ブラウザでの `<details>` の見た目と、`/mypage` path のフラッシュ Cookie の挙動です。実機で確認するまで未検証として扱ってください。
  - **ユーザーが迷いそうな点(今回は変えません):**
    - 閉じた `<details>` は、初見だと見出しに見えて開けることに気づきにくいです。
    - 実機で見て、受け入れ確認のときに小林さんの反応で判断したいです。

- 田中 健 (eng-backend) → pm: 田中です。前回挙げた「ログイン時の epoch 付与にテストがない」を解消しました。`app/routes/api/auth/verify.test.ts` に 1 件足しています。
  
  - **内容:** ログイン成功時に、DB の現在の epoch（テストでは 4）が session Cookie に入ることを確認します。
    - `sessionEpochRepo.get` を `hashSessionEpochKey` のキーで呼ぶこと。
    - 発行された Cookie を `verifySessionCookie` で復号すると `{email, epoch: 4}` になること。
  - **品質ゲート:**
    - `pnpm test:run` は 160 ファイル・1500 件が通りました。
    - lint は警告 0・エラー 0 で、oxfmt も整形済みです。
    - `npx tsc --noEmit` は、既存の `dist/.vite/manifest.json` 欠落の 1 件だけです。
  
  担当の T5・T6・T8 は完了で、ほかに作業は残っていません。コードの変更はこのテストだけで、プロダクトコードは触っていません。
  
  - **未検証:**
    - 実 D1 でのマイグレーション 0021 の適用。
    - 実ブラウザでの Cookie 再発行とフラッシュ Cookie の挙動。
    - #59 のスライディング更新との結合。この作業コピーにはスライディング更新がありません。
  - **デプロイ順:** マイグレーション 0021 を先に適用してください。未適用だと全員が未ログイン扱いになります。
  - **PII レビュー:** 私自身の確認です。別セッションでの再確認の要否は、佐藤さんに判断をお願いします。

- 田中 健 (eng-backend) [TASK_UPDATE]: T8 → done: 前回の完了内容に追加で、ログイン時に epoch が Cookie に入ることのテストを `app/routes/api/auth/verify.test.ts` に足しました。`pnpm vitest run app/routes/api/auth/verify.test.ts` で確認できます。

> _鈴木 ひかり (eng-frontend) [thinks]: T7 は完了済みで追加作業なし。これ以上の発言は重複になるので、短く締める。_

- 鈴木 ひかり (eng-frontend) → pm: 鈴木です。T7 は完了済みで、追加の作業はありません。田中さんの T6 とも整合しています。実ブラウザでの `<details>` の見た目と `/mypage` path のフラッシュ Cookie は未検証のままです。受け入れ確認で小林さんが「開けると気づけるか」を見てください。

### iteration 1 · review

- — Phase "review" started (iteration 1) — Engineers review each other's work against the acceptance criteria and fix issues. PM checks every task against its acceptance criteria and states what is ready for users.

- 田中 健 (eng-backend) → pm, eng-frontend: 田中です。鈴木さんの T7 を受け入れ条件に照らしてレビューしました。修正が必要な点はありません。
  - **確認した点:**
    - `flash.ts` は path の既定値が `/admin` のままです。`/mypage` を指定したときは、set と consume の path が揃っています。削除 Cookie も同じ path です。
    - `reservations/index.tsx` では、`consumeFlash(c, { path: '/mypage' })` の結果を FlashBanner で出しています。
    - `<details>` はメールアドレス表示の下にあり、閉じた状態です。説明文と「他の端末からログアウトする」ボタンの文言は決定どおりです。
    - 「ログアウト」の form は別のままで、action も文言も変わっていません。
    - ボタンの form は `POST /mypage/logout-all` です。T6 のルートと一致しています。
    - CSRF は `rejectCrossSiteRequest` のヘッダ方式で、hidden input は不要です。
  - **実行結果:** `pnpm vitest run app/routes/mypage app/lib/flash.test.ts app/middleware app/routes/api/auth` は 10 ファイル・65 件が通りました。
  - **自分の T5・T6・T8 の再確認:**
    - epoch 検証は `guestAuth` と `readGuestSession` の 1 関数に集約されています。
    - DB 読み取りが失敗したときは未ログイン扱いです。
    - 監査には操作の事実だけが残り、PII は出ません。
  - **小さな懸念:** `__flash` Cookie は、`/admin` と `/mypage` で別の path に同名で存在します。同じ人が両方を使うと、ブラウザは別々の Cookie として扱います。実害は想定していません。ただし、実ブラウザでの確認は未検証です。
  
  未検証は 3 点です。実 D1 でのマイグレーション 0021 の適用、実ブラウザでの Cookie 再発行とフラッシュ Cookie の挙動、#59 のスライディング更新との結合です。デプロイは 0021 を先に適用してください。PII レビューは私自身の確認なので、別セッションでの再確認の要否は佐藤さんの判断をお願いします。

> _佐藤 美咲 (pm) [thinks]: 各タスクを受け入れ条件に照らして確認する。T5/T6/T7/T8 は完了報告とテスト結果が揃っている。T1〜T4 は T5〜T8 の元タスクで、実質同一。逸脱は 2 点(監査名、リダイレクト先)で、どちらも妥当。PII レビューは作者本人の確認なので、別視点での再確認が要る。スライディング更新は作業コピーに無いので、受け入れ条件の一部は未達ではなく「対象なし」。_

- 佐藤 美咲 (pm): 佐藤です。レビューの結果をまとめます。T5〜T8 は受け入れ条件を満たしています。ユーザーに出せる状態です。ただし、実機で確認するまで未検証の点が残ります。
  
  **受け入れ確認**
  - **T5(epoch 保存と検証):** OK。
    - 5 点のテスト(一致、不一致、epoch なし、再発行後、DB 失敗)が通っています。
    - `guestAuth` と `readGuestSession` が同じ関数を通ります。
    - ログイン時の epoch 付与のテストも足されました。
  - **T6(エンドポイント):** OK。
    - 別 Cookie が無効になること、押した端末が有効なままであること、他のゲストに影響しないこと、二重押し、未ログイン時に何も起きないことを確認しています。
    - 監査にも PII は出ません。
  - **T7(マイページ UI):** OK。
    - 閉じた `<details>` に、説明文とボタン、既存ログアウトが不変であること、バナー表示のテストがあります。
    - `/admin` の flash は既定値のままです。
  - **T8(spec と PII レビュー):** OK。
    - Business Risk Review の 5 カテゴリ、対象外とその理由、キーを鍵付きハッシュにした理由、デプロイ順が書かれています。
  - **品質ゲート:** `pnpm test:run` は 1500 件通過、lint は 0 件です。`tsc` は既存の `dist/.vite/manifest.json` 欠落のみです。
  
  **受け入れ条件からのずれ(了承します)**
  - 監査アクション名は `auth.logout_all` にしました。既存の命名に揃えるためで、実害はありません。
  - リダイレクト先は `/mypage/reservations` にしました。余計なリダイレクトを減らすためで、flash Cookie の path `/mypage` で届きます。
  - スライディング更新は、この作業コピーに存在しないため対象なしです。「更新後も epoch を維持」は、再発行 Cookie のテストで代替しています。
  
  **未解決で、ユーザーに伝えるべきこと**
  1. **デプロイはマイグレーション 0021 が先です。** 未適用だと全員が未ログイン扱いになります。
  2. **PII レビューは田中さん自身の確認です。** 別セッションでの再確認を推奨します。マージ前の条件として残します。
  3. **#59 のスライディング更新との結合は未検証です。** 取り込む際は、`resolveGuestSession` が返す epoch で再発行する形に直してください。
  4. **実 D1 でのマイグレーション適用と、実ブラウザでの Cookie 再発行・`<details>` の見た目・flash Cookie の挙動は未検証です。**
  
  **後回し(記録)**
  - 招待・法人見学セッション
  - 管理画面からの強制失効
  - ログイン中の端末一覧
  - 閉じた `<details>` が「開けると気づけるか」の確認(小林さんの反応で判断)

- 佐藤 美咲 (pm) [DECISION]: 今回の成果は、上記の未検証 4 点と、マージ前の条件(マイグレーション 0021 を先に適用する、PII レビューを別セッションで再確認する)を明記した上で、ユーザー受け入れに進める。コードの追加変更は行わない。理由は、受け入れ条件を満たしており、残りは実環境でしか確認できないため。

> _佐藤 美咲 (pm) [notes]: review R1 の結果: T5〜T8 は受け入れ条件を満たした。ずれは監査名 `auth.logout_all` とリダイレクト先 `/mypage/reservations` で、どちらも了承した。マージ前の条件は、マイグレーション 0021 を先に適用することと、PII レビューの別セッションでの再確認。未検証は、実 D1、実ブラウザ(Cookie 再発行、details の見た目、flash Cookie)、#59 のスライディング更新との結合。受け入れで確認するのは、小林さんが details を開けると気づけるか。_

- 佐藤 美咲 (pm) [ADVANCE]: End of phase "review".

### iteration 1 · acceptance

- — Phase "acceptance" started (iteration 1) — Users try what was built (read the workspace, run it if possible) and judge it from their own needs. Each user gives a [VERDICT accept|reject] with reasons. PM summarizes and decides next steps.

> _小林 直子 (user-guest) [thinks]: 共用 iPad のログアウト確認ができるかが焦点。ボタンで切れて、完了表示が出るなら安心できる。ログイン手間は増えていない。_

- 小林 直子 (user-guest): 小林です。使う側として、できたものを見ました。
  
  良いところです。
  - 共用 iPad に残っているかもしれないログインを、スマホから自分で切れます。私がいちばん困っていた点です。
  - 押した端末はログインしたままです。ここで毎回ログインし直す手間が増えないのは助かります。
  - 「他の端末からログアウトしました」と出るので、切れたと分かります。
  - 既存の「ログアウト」は変わっていません。
  
  気になる点です。
  - 閉じた「他の端末からログアウト」は、見出しにしか見えません。開けると気づかない人は多いと思います。「共用の端末のログインを切る」のように、用途が分かる一言を summary に足してほしいです。ただ、今回はこのままでも構いません。
  - どの端末がログイン中かは見えません。切れたかどうかは、完了表示を信じるしかありません。次の機会に、端末一覧か最終ログイン時刻があると嬉しいです。
  - 個人情報の扱いでは、メールを平文で保存しない、ログにも残さないとのことで、安心しました。ただ、別の人によるレビューがまだなので、公開前に必ずやってください。
  - 公開の順番が間違うと、全員がログアウトされると聞きました。予約直前に急にログアウトされるのは困ります。順番は守ってください。

- 小林 直子 (user-guest) [VERDICT]: ACCEPT: 私の困りごとは解決します。共用 iPad のログインをスマホから自分で切れて、完了表示で確認できます。押した端末のログインは続き、ログインの手間も増えません。条件が 2 つあります。1 つ目は、マイグレーションを先に適用してから公開することです。2 つ目は、個人情報のレビューを別の人でもう一度行うことです。summary の分かりやすさは、次の改善でお願いします。

> _小林 直子 (user-guest) [notes]: 小林さんは今回の「他の端末からログアウト」を accept した。条件は、マイグレーション 0021 を先に適用することと、PII レビューの再確認。次回の要望は、summary の用途表示と、端末一覧または最終ログイン時刻。_

> _中村 誠 (user-owner) [thinks]: 要点は把握済み。オーナー視点: 使う場面は過去にないが、複雑さは増えていない。PII・デプロイ順は気になる。監査ログに残るのは良い。オーナー側から見えない点は残る。ACCEPT 条件付きで。_

- 中村 誠 (user-owner): 中村です。使う側として見ました。
  
  良い点です。
  - ボタンが 1 つ増えただけで、設定は増えていません。私の手間は変わらず、これは助かります。
  - 3 日待たせず、ゲストが自分で切れます。鍵の受け渡しで「家族のタブレットで開いたけど大丈夫?」と聞かれたとき、「マイページから切れますよ」と言えます。
  - 押した端末のログインが続くのも、ゲストが迷わなくて良いです。
  - 監査ログに操作の事実だけが残り、メールや氏名は出ません。後から追えます。
  - 既存のログアウトが変わっていません。
  
  気になる点です。
  - 私の側からゲストのセッションを切る手段は、今回もありません。過去に使う場面はなかったので今回は構いません。実際に困ったら、また issue で出します。
  - マイグレーションを先に適用しないと全員がログアウトされる件は、運用で一番怖いです。繁忙期の金曜に出すのは避けます。順番を守る手順を、spec か README に書いておいてください。
  - spec の「行は削除しない」も大事です。手作業で DB を触るときに間違えないよう、目につく所に置いてください。
  - PII レビューは別セッションでの再確認が済むまで公開しません。

- 中村 誠 (user-owner) [VERDICT]: ACCEPT: ゲストの不安に答える手段が増え、運営の手間も設定も増えません。個人情報も残らず、監査ログで追えます。条件は 3 つです。(1) マイグレーション 0021 を先に適用してから公開する。(2) PII レビューを別セッションで再確認する。(3) 繁忙期を避けた日に公開する。実 D1 と実ブラウザでの確認も、公開前に必ず行ってください。

> _中村 誠 (user-owner) [notes]: 受け入れ時の立場: 「ゲストが自分で切れる」は歓迎。オーナー側から切る機能は不要だが、困った時は issue で要望する。公開条件はマイグレーション先行、PII 別レビュー、繁忙期を避けること。DB の行は手で消さない。_

> _佐藤 美咲 (pm) [thinks]: 両者ACCEPT。条件は公開前の運用事項で、コード変更は不要。中村さんの手順書き出し要望は、spec に既にあるが目につく所に置く点は次イテレーションのタスクにする。イテレーション1/2なので次は小さな改善を回せる。ここでは要約して決める。_

- 佐藤 美咲 (pm): 佐藤です。受け入れ結果をまとめます。小林さん・中村さんとも ACCEPT でした。共用端末のログインをゲスト自身が切れて、完了表示で確認できる点、設定も運営の手間も増えない点を評価いただきました。
  
  **公開前の条件（コードではなく運用）**
  1. マイグレーション 0021 を先に適用してから公開する。順番を間違えると全員がログアウトされます。
  2. PII レビューを、田中さん以外の別セッションで再確認する。
  3. 実 D1 と実ブラウザ（Cookie 再発行、`<details>` の見た目、flash Cookie）を公開前に確認する。#59 のスライディング更新との結合も同様です。
  4. 繁忙期の金曜は避けて公開する。
  
  **次にやること（小さく）**
  - 中村さんの指摘どおり、デプロイ順と「epoch の行は削除しない」を spec と README の目につく所に置きます。手作業で DB を触る人が間違えないためです。
  - 小林さんの指摘（summary が見出しに見える）は、summary に用途の一言を足す案です。文言を変えるだけで済みますが、実ブラウザで見てから決めます。
  
  **後回しのまま記録**
  - 管理画面からの強制失効（中村さん：困ったら issue で出す）
  - ログイン中の端末一覧・最終ログイン時刻（小林さん）
  - 招待・法人見学セッション

- 佐藤 美咲 (pm) [DECISION]: 今回の成果は両ユーザーの ACCEPT で受け入れる。公開は、マイグレーション 0021 の先行適用、別セッションでの PII 再確認、実 D1・実ブラウザ・#59 結合の確認、繁忙期を避けた日程、の 4 条件を満たしてから行う。理由は、残りのリスクが実環境でしか確認できず、順序ミスの影響が全ゲストのログアウトと大きいため。

- 佐藤 美咲 (pm) [TASK]: T9 owner=eng-backend: デプロイ手順と「行は削除しない」を目につく所に置く
  - `docs/specs/guest-logout-all.md` の冒頭に「デプロイ前に必ず読む」節を置き、マイグレーション 0021 を先に適用する順番と、未適用だと全員が未ログイン扱いになることを書く。
  - 同じ節に「`guest_session_epochs` の行は削除しない（0 に戻り、失効済み Cookie が復活する）」と、revert 時の影響（最大 3 日復活）を書く。
  - 既存 README の既存構成を保ち、新規 README は作らず、デプロイ手順を書く既存の箇所から spec へリンクする。
  - コードは変更しない。`pnpm test:run`、`npx tsc --noEmit`、lint が通る。

> _佐藤 美咲 (pm) [notes]: acceptance R1 の結果: 小林さん・中村さんとも ACCEPT。公開条件は、マイグレーション 0021 先行適用、PII の別セッション再確認、実 D1・実ブラウザ・#59 結合の確認、繁忙期を避けた日程。小林さんの要望は summary に用途の一言（実ブラウザで見て判断）。後回し: 管理画面からの強制失効、端末一覧・最終ログイン時刻、招待・法人見学セッション。_

- — Session finished after iteration 1. 2/2 users accepted.
