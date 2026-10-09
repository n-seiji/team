# team

PM・エンジニア・ユーザーペルソナが会話しながら開発するシミュレーター。詳細は README.md。

- チームを動かす依頼（「〜を作って」「セッションを続けて」など）は `team-dev` スキル (`.claude/skills/team-dev/SKILL.md`) の手順に従う。
- エンジン: `node src/main.ts <command>`（Node.js >= 22.18, 実行時依存なし）。状態は `.team/sessions/<name>/` にあり、CLI 経由でのみ変更する。
- シミュレーションで作られるプロダクトは `workspace/`。エンジンのコード (`src/`) とは分ける。
- エンジンを変更したら `npm run typecheck && npm test`。
