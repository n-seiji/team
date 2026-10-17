export type Style = "conventional" | "free";
export type Problem = { where: string; why: string };
export type CheckResult = { ok: boolean; problems: Problem[]; suggestions: string[] };

// 標準の type 一式
export const TYPES = ["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert"];

// 曖昧語: 1 語だけで、数字が付いていてもよい。ここ 1 か所だけで管理する
export const VAGUE = /^(fix|update|wip|tmp|test|misc|changes?)\d*$/i;

// 語 → type の推定。英語は先頭の 1 語一致、日本語は前方一致と末尾一致を同じ辞書で引く
const GUESS_EN: Record<string, string> = { add: "feat", fix: "fix", doc: "docs", docs: "docs", readme: "docs" };
const GUESS_JA: Record<string, string> = { 追加: "feat", 対応: "feat", 修正: "fix", 調整: "fix", 変更: "fix", 差し替え: "fix" };
const ALIAS: Record<string, string> = { feature: "feat", bugfix: "fix", hotfix: "fix", doc: "docs" };

// 種類が分からないときに入れる雛形。「type」という語は出さない
export const TYPE_HINT = "<種類(feat=追加 / fix=修正)>";
const TEMPLATE = `${TYPE_HINT}: <説明>`;
const GENERATED = /^(Merge |Revert "|fixup! |squash! )/;
const CONVENTIONAL = /^([^\s:()!]+)(?:\(([^)]*)\))?!?:(.*)$/;

function guess(subject: string): string {
  const word = subject.split(/\s+/)[0] ?? "";
  let type = GUESS_EN[word.toLowerCase()];
  let rest = subject.slice(word.length).trim();
  if (!type) {
    const key = Object.keys(GUESS_JA).find((k) => subject.startsWith(k));
    if (key) {
      type = GUESS_JA[key];
      rest = subject.slice(key.length).trim();
    }
  }
  if (!type) {
    // 「ヘッダー修正」のような末尾の語。「ヘッダーを修正」は対象外
    const key = Object.keys(GUESS_JA).find((k) => subject.endsWith(k));
    const head = key ? subject.slice(0, -key.length).trim() : "";
    if (key && !head.endsWith("を")) {
      type = GUESS_JA[key];
      rest = head;
    }
  }
  // 推定できないときは type だけ空け、1 語の曖昧語以外は本人の文面を説明に残す
  if (!type) return VAGUE.test(subject) ? TEMPLATE : `${TYPE_HINT}: ${subject}`;
  return `${type}: ${rest || "<説明>"}`;
}

function result(problems: Problem[], suggestions: string[], ok = problems.length === 0): CheckResult {
  return { ok, problems, suggestions };
}

// 純関数。設定ファイルは読まない。free のときの 1 語警告は ok=true のまま problems に入れる
export function check(message: string, opts: { style?: Style } = {}): CheckResult {
  const style = opts.style ?? "conventional";
  const subject = (message.split("\n")[0] ?? "").trim();

  if (!subject) {
    return result([{ where: "メッセージ全体", why: "メッセージが空です" }], [TEMPLATE]);
  }
  if (GENERATED.test(subject)) return result([], []);

  if (VAGUE.test(subject)) {
    const p = { where: "メッセージ全体", why: `「${subject}」だけでは、何をしたのか後から分かりません` };
    return result([p], [guess(subject)], style === "free" ? true : false);
  }
  if (style === "free") return result([], []);

  const m = CONVENTIONAL.exec(subject);
  if (!m) {
    return result(
      [{ where: "メッセージの先頭", why: "先頭に『何をしたか』の種類(feat や fix)がありません" }],
      [guess(subject)],
    );
  }
  const [, type, , after] = m;
  const known = TYPES.includes(type);
  const fixed = known ? type : (ALIAS[type] ?? (TYPES.includes(type.toLowerCase()) ? type.toLowerCase() : TYPE_HINT));
  const desc = after.trim();
  const problems: Problem[] = [];

  if (!known) {
    problems.push({
      where: `先頭の「${type}」`,
      why: `「${type}」は使える種類ではありません(feat、fix、docs など)`,
    });
  }
  if (!desc) {
    problems.push({ where: "「:」のあと", why: "何をしたかの説明が空です" });
  } else if (!after.startsWith(" ")) {
    problems.push({ where: "「:」のあと", why: "「:」のあとに半角スペースがありません" });
  }
  const scope = m[2] !== undefined ? `(${m[2]})` : "";
  return result(problems, problems.length ? [`${fixed}${scope}: ${desc || "<説明>"}`] : []);
}
