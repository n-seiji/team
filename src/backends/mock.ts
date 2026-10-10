// Deterministic, offline backend. Walks a whole iteration so the engine,
// CLI and transcript can be exercised in tests and demos without any LLM.
import type { TurnPrompt } from "../prompt.ts";
import type { Backend, TurnContext } from "./index.ts";
import { currentPhase, findMember } from "../world.ts";

export class MockBackend implements Backend {
  async respond(p: TurnPrompt, { state: s }: TurnContext): Promise<string> {
    const phase = currentPhase(s).id;
    const users = s.members.filter((m) => m.role === "user");
    const engineers = s.members.filter((m) => m.role === "engineer");
    const me = findMember(s, p.member)!;
    switch (`${p.role}:${phase}`) {
      case "pm:discovery":
        return `[THINK] Ask about concrete recent episodes.\n[SAY to=${users.map((u) => u.id).join(",") || "all"}] 最近「${s.brief}」に関して困ったことを具体的に教えてください。`;
      case "user:discovery":
        return `[SAY to=pm] ${me.persona.name}です。毎回手作業でやっていて時間がかかるのが一番の不満です。`;
      case "pm:planning": {
        if (s.tasks.length > 0) return "[ADVANCE] スコープ確定。";
        const tasks = engineers.map(
          (e, i) => `[TASK owner=${e.id}] 機能${i + 1}を実装する\n- ユーザーが手作業なしで結果を得られる`,
        );
        return `[DECISION] 最小スコープで1イテレーション回す。\n${tasks.join("\n")}`;
      }
      case "engineer:planning":
        return "[SAY to=all] 実装可能です。インターフェースはJSONで合わせましょう。";
      case "engineer:build": {
        const mine = s.tasks.filter((t) => t.owner === me.id && t.status !== "done");
        return mine.length
          ? mine.map((t) => `[TASK_DONE ${t.id}] ${t.title} を実装し、テストを追加しました。`).join("\n")
          : "[SAY to=all] 自分のタスクは完了済みです。";
      }
      case "engineer:review":
        return "[SAY to=all] 相互レビュー完了。受け入れ基準を満たしています。";
      case "pm:review":
        return "[SAY to=all] 全タスクが受け入れ基準を満たしているので、ユーザーに見てもらいます。";
      case "user:acceptance":
        return `[VERDICT accept] 手作業が減りそうなので使ってみたいです。`;
      case "pm:acceptance":
        return "[DECISION] このイテレーションはリリース可。";
      default:
        return "[SAY to=all] 了解です。";
    }
  }
}
