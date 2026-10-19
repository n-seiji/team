// Agent reply protocol. Like TinyTroupe's THINK / TALK / DONE actions, but as
// plain-text tags so any model (or a human) can produce them reliably:
//
//   [THINK] a short private memo, only its author sees it
//   [SAY to=pm,eng-a] message (to=all when omitted)
//   [TASK owner=eng-a] title
//   acceptance criteria (following lines)
//   [TASK_DONE T1] what was done
//   [VERDICT accept] reason
//   [DONE]
//
// Text before the first tag is treated as [SAY].

export interface Action {
  type: string;
  attrs: Record<string, string>;
  /** Positional argument after the tag name, e.g. "T1" in [TASK_DONE T1]. */
  arg?: string;
  text: string;
}

const TAG = /^\s*\[([A-Z_]+)((?:\s+[^\]]*)?)\]\s?(.*)$/;

export function parseReply(raw: string): Action[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const actions: Action[] = [];
  let cur: Action | null = null;
  let inFence = false;

  const flush = () => {
    if (cur) {
      cur.text = cur.text.replace(/^\n+|\s+$/g, "");
      actions.push(cur);
    }
    cur = null;
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const m = inFence ? null : TAG.exec(line);
    if (m) {
      flush();
      const { attrs, arg } = parseAttrs(m[2] ?? "");
      cur = { type: m[1], attrs, arg, text: m[3] ?? "" };
      continue;
    }
    if (!cur) {
      if (line.trim() === "") continue;
      cur = { type: "SAY", attrs: {}, text: "" };
    }
    cur.text += (cur.text ? "\n" : "") + line;
  }
  flush();
  return actions.filter((a) => a.type === "DONE" || a.type === "ADVANCE" || a.text.length > 0 || a.arg);
}

function parseAttrs(s: string): { attrs: Record<string, string>; arg?: string } {
  const attrs: Record<string, string> = {};
  let arg: string | undefined;
  for (const tok of s.split(/\s+/).filter(Boolean)) {
    const eq = tok.indexOf("=");
    if (eq > 0) attrs[tok.slice(0, eq).toLowerCase()] = tok.slice(eq + 1).replace(/^["']|["']$/g, "");
    else if (arg === undefined) arg = tok;
  }
  return { attrs, arg };
}

export const PROTOCOL_HELP = `Reply ONLY with action tags. Each tag starts a line; its content runs until the next tag.
  [THINK] a short private memo to yourself (only you see it)
  [SAY to=all] message to everyone        ([SAY to=<id>,<id>] to address specific members; they will reply next)
  [NOTE] a fact you want to remember for the rest of the project (long-term memory)
  [DONE] end your turn (optional)`;

export const ACTION_HELP: Record<string, string> = {
  TASK:
    "[TASK owner=<engineer-id>] short title\n  acceptance criteria on the following lines (testable, user-visible)\n" +
    "  ([TASK owner=<id> replaces=T1] when it supersedes T1; T1 is then closed)",
  TASK_START: "[TASK_START T1] you started working on task T1",
  TASK_DONE:
    "[TASK_DONE T1] what you implemented, which files, and how you verified it: the command you ran and its result, " +
    "or \"not run\" (never claim a check you did not run)",
  TASK_BLOCKED:
    "[TASK_BLOCKED T1] only a real person outside the team can finish this (a real device, an account, a permission, " +
    "publishing); say exactly what they must do. The team moves on",
  TASK_DROP: "[TASK_DROP T1] close a task the team will not do, with the reason",
  ASK_HUMAN:
    "[ASK_HUMAN] a question only the real human can answer (a product or preference call, a permission, money, " +
    "anything irreversible), plus the default the team goes ahead with meanwhile. Never for something you can check yourself",
  DEMO:
    "[DEMO T1] what a user does and what they see, with real output you produced (pasted, or the path of a generated file / screenshot)",
  VERIFY:
    "[VERIFY] one shell command, run from the workspace, that tries the product the way a user would and prints what it saw " +
    "(see the phase goal). The latest one counts",
  DECISION: "[DECISION] a decision the team should follow from now on",
  ADVANCE: "[ADVANCE] end the current phase now because its goal is met (PM only)",
  VERDICT:
    "[VERDICT accept] or [VERDICT reject] followed by your honest reasons (acceptance phase), what you based it on " +
    "(which demo or file you read) and what you could not check",
};
