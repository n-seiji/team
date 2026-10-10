// Agent reply protocol. Like TinyTroupe's THINK / TALK / DONE actions, but as
// plain-text tags so any model (or a human) can produce them reliably:
//
//   [THINK] private reasoning, only you will remember it
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
  [THINK] private reasoning (only you remember it; keep it short)
  [SAY to=all] message to everyone        ([SAY to=<id>,<id>] to address specific members; they will reply next)
  [NOTE] a fact you want to remember for the rest of the project (long-term memory)
  [DONE] end your turn (optional)`;

export const ACTION_HELP: Record<string, string> = {
  TASK: "[TASK owner=<engineer-id>] short title\n  acceptance criteria on the following lines (testable, user-visible)",
  TASK_START: "[TASK_START T1] you started working on task T1",
  TASK_DONE: "[TASK_DONE T1] what you implemented, which files, how to run/verify it",
  DECISION: "[DECISION] a decision the team should follow from now on",
  ADVANCE: "[ADVANCE] end the current phase now because its goal is met (PM only)",
  VERDICT: "[VERDICT accept] or [VERDICT reject] followed by your honest reasons (acceptance phase)",
};
