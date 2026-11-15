import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSessionList } from "../src/session-list.ts";
import type { SessionState } from "../src/types.ts";
import { newState, verdict } from "./session-state.ts";
import { isWellFormed } from "./well-formed.ts";

// Times are built from local parts and read back as local time, so these hold in any time zone.
const at = (hour: number, minute: number) => new Date(2026, 10, 15, hour, minute).toISOString();

type Row = Parameters<typeof formatSessionList>[0][number];

/** A session as read from a folder called `name`; `patch` changes its state, and `lastAt` is its last activity (`null` for none). */
const row = (name: string, patch: Partial<SessionState> = {}, lastAt: string | null = at(9, 5)): Row => ({ name, state: newState({ name, ...patch }), lastAt: lastAt ?? undefined });

/** The cells of the line for `name`, in the order of the columns (the current mark is not one). */
function cells(out: string, name: string): string[] {
  const line = out.split("\n").find((l) => l.slice(2).startsWith(name + " "))!;
  return line.slice(2).split(/ {2,}/);
}

test("a running session shows its phase, iteration and last activity, and no result yet", () => {
  assert.deepEqual(cells(formatSessionList([row("a")], ""), "a"), ["a", "running", "discovery", "1/2", "-", "2026-11-15 09:05", "A tool for invoices"]);
});

test("a finished session's result is how many users accepted in its last iteration", () => {
  const verdicts = [verdict("u1", "reject", "no", 1), verdict("u2", "reject", "no", 1), verdict("u1", "accept", "ok", 2), verdict("u2", "reject", "no", 2)];
  assert.equal(cells(formatSessionList([row("a", { status: "done", iteration: 2, verdicts })], ""), "a")[4], "1/2 accepted");
});

test("a user's later verdict in the same iteration replaces the earlier one in the result", () => {
  const verdicts = [verdict("u1", "reject", "no"), verdict("u1", "accept", "ok now"), verdict("u2", "accept", "ok")];
  assert.equal(cells(formatSessionList([row("a", { status: "done", verdicts })], ""), "a")[4], "2/2 accepted");
});

test("a finished session without a verdict in its last iteration says so, whatever an earlier iteration had", () => {
  assert.equal(cells(formatSessionList([row("a", { status: "done" })], ""), "a")[4], "no verdict");
  const earlier = row("b", { status: "done", iteration: 2, verdicts: [verdict("u1", "accept", "ok", 1)] });
  assert.equal(cells(formatSessionList([earlier], ""), "b")[4], "no verdict");
});

test("a session with no readable last activity is dated by when it was created, or by a dash when that is not a time either", () => {
  const created = new Date(2026, 10, 14, 23, 59).toISOString();
  assert.equal(cells(formatSessionList([row("a", { createdAt: created }, null)], ""), "a")[5], "2026-11-14 23:59");
  assert.equal(cells(formatSessionList([row("b", { createdAt: "" }, null)], ""), "b")[5], "-");
  assert.equal(cells(formatSessionList([row("c", {}, "not a time")], ""), "c")[5], "-");
});

test("the brief is cut to one short line, whole characters only", () => {
  const out = formatSessionList([row("a", { brief: "割り勘を計算する\nCLI " + "あ".repeat(100) + "𠮷" })], "");
  const brief = cells(out, "a")[6];
  assert.ok(!brief.includes("\n"));
  assert.ok(brief.endsWith("…"));
  assert.ok(isWellFormed(brief));
  assert.ok(brief.length <= 60);
});

test("the list has a header, one line per session, and marks the current one", () => {
  const out = formatSessionList([row("alpha"), row("beta-long-name", { status: "done", verdicts: [verdict("u1", "accept", "ok")] })], "beta-long-name");
  const lines = out.split("\n");
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^ {2}NAME +STATUS +PHASE +ITER +RESULT +UPDATED +BRIEF$/);
  assert.match(lines[1], /^ {2}alpha +running +discovery +1\/2 +- +2026-11-15 09:05 +A tool for invoices$/);
  assert.match(lines[2], /^\* beta-long-name +done +discovery +1\/2 +1\/1 accepted +2026-11-15 09:05 +A tool for invoices$/);
});

test("the columns line up whatever the lengths of the names and results are", () => {
  const out = formatSessionList([row("a"), row("much-longer-name", { status: "done" }), row("mid", { status: "done", verdicts: [verdict("u1", "reject", "x")] })], "a");
  const [, a, b, c] = out.split("\n");
  for (const text of ["2026-11-15", "A tool"]) {
    assert.equal(a.indexOf(text), b.indexOf(text));
    assert.equal(b.indexOf(text), c.indexOf(text));
  }
  assert.equal(b.indexOf("done"), c.indexOf("done"));
});

test("the name is the folder's, and a state that says another name is pointed out on its line", () => {
  const copy: Row = { name: "a-copy", state: newState({ name: "a" }), lastAt: at(9, 5) };
  const out = formatSessionList([row("a"), copy], "a-copy");
  const [, original, copied] = out.split("\n");
  assert.match(original, /^ {2}a +running/);
  assert.doesNotMatch(original, /state\.json says/);
  assert.match(copied, /^\* a-copy +running .* \(state\.json says "a"\) A tool for invoices$/);
});

test("a session that cannot be read has its own line saying so, and the rest of the list is intact", () => {
  const out = formatSessionList([row("good"), { name: "broken", unreadable: "state.json: Unexpected end of JSON input" }], "good");
  const lines = out.split("\n");
  assert.equal(lines.length, 3);
  assert.match(lines[1], /^\* good +running/);
  assert.match(lines[2], /^ {2}broken +\(unreadable: state\.json: Unexpected end of JSON input\)$/);
});

test("a state that is not a session state is shown as unreadable, not as a crash", () => {
  const out = formatSessionList([row("good"), { name: "weird", state: {} as unknown as SessionState, lastAt: undefined }, { name: "nothing", state: null as unknown as SessionState, lastAt: undefined }], "good");
  const lines = out.split("\n");
  assert.equal(lines.length, 4);
  assert.match(lines[2], /^ {2}weird +\(unreadable: .+\)$/);
  assert.match(lines[3], /^ {2}nothing +\(unreadable: .+\)$/);
});

test("nothing that could disturb a terminal gets through from a brief or from a reason a session could not be read", () => {
  const bad = "\u001b[31mred\u202ereversed\u0007";
  const out = formatSessionList([row("a", { brief: `brief ${bad}` }), { name: "broken", unreadable: `oops ${bad}` }], "");
  assert.doesNotMatch(out, /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/);
  assert.match(out, /brief \[31mredreversed/);
  assert.match(out, /\(unreadable: oops \[31mredreversed\)/);
});

test("with no session the list says how to start one", () => {
  assert.match(formatSessionList([], ""), /no sessions yet.*team init/);
});
