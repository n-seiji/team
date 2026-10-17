// check --json の結果を、初心者向けの5行以内の画面に並べる。文言は check 側のものをそのまま使う。
export type Problem = { where: string; why: string };
export type CheckResult = { ok: boolean; problems: Problem[]; suggestions: string[] };

const MAX_PROBLEMS = 2;
const PLACEHOLDER = /[<>]/;

// 雛形(<種類(…)>: <説明>)は置き換えに使うとそのまま履歴に残るので、置き換えの対象にしない。
export function replaceable(result: CheckResult): string | undefined {
  const first = result.suggestions[0];
  return first && !PLACEHOLDER.test(first) ? first : undefined;
}

export function render(result: CheckResult, footer?: string): string[] {
  // ok のまま problems があるのは free の警告。止めるもの(✗)と見た目で分ける。
  const mark = result.ok ? "!" : "✗";
  const lines = result.problems.slice(0, MAX_PROBLEMS).map((p) => `${mark} ${p.where}: ${p.why}`);
  const fix = result.suggestions[0];
  if (fix) lines.push(`→ こう直す: ${fix}`);
  if (footer) lines.push(footer);
  return lines;
}
