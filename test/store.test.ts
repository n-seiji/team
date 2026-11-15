import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Store } from "../src/store.ts";

/** A store whose session `s` has this transcript.jsonl (or none, for undefined). */
function storeWith(transcript: string | undefined): Store {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "team-store-"));
  const dir = path.join(root, ".team/sessions/s");
  fs.mkdirSync(dir, { recursive: true });
  if (transcript !== undefined) fs.writeFileSync(path.join(dir, "transcript.jsonl"), transcript);
  return new Store(root);
}

const line = (at: string, text = "x") => JSON.stringify({ turn: 1, at, phase: "p", iteration: 1, from: "pm", kind: "say", text }) + "\n";

test("the last activity is the time of the last transcript entry", () => {
  assert.equal(storeWith(line("2026-01-01T00:00:00.000Z") + line("2026-01-02T00:00:00.000Z")).lastActivity("s"), "2026-01-02T00:00:00.000Z");
});

test("a transcript far bigger than what is read still gives the last entry", () => {
  const filler = Array.from({ length: 2000 }, (_, i) => line(`2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`, "filler ".repeat(20))).join("");
  assert.ok(filler.length > 200_000);
  assert.equal(storeWith(filler + line("2026-03-04T05:06:07.000Z")).lastActivity("s"), "2026-03-04T05:06:07.000Z");
});

test("a last line that is only half written is passed over for the entry before it", () => {
  const half = '{"turn":2,"at":"2026-02-02T00:00:0';
  assert.equal(storeWith(line("2026-01-01T00:00:00.000Z") + half).lastActivity("s"), "2026-01-01T00:00:00.000Z");
});

test("a broken line in the middle does not matter, and a broken last line is passed over", () => {
  const out = storeWith(line("2026-01-01T00:00:00.000Z") + "not json\n" + line("2026-01-03T00:00:00.000Z"));
  assert.equal(out.lastActivity("s"), "2026-01-03T00:00:00.000Z");
  assert.equal(storeWith(line("2026-01-01T00:00:00.000Z") + "not json\n").lastActivity("s"), "2026-01-01T00:00:00.000Z");
});

test("when the part that is read holds no whole line there is no last activity, however many entries came before", () => {
  const huge = line("2026-02-02T00:00:00.000Z", "y".repeat(200_000));
  assert.equal(storeWith(line("2026-01-01T00:00:00.000Z") + huge).lastActivity("s"), undefined);
});

test("a session with no transcript, or an empty one, has no last activity", () => {
  assert.equal(storeWith(undefined).lastActivity("s"), undefined);
  assert.equal(storeWith("").lastActivity("s"), undefined);
});

test("an entry whose time is not text does not count", () => {
  assert.equal(storeWith(line("2026-01-01T00:00:00.000Z") + JSON.stringify({ turn: 2, at: 5 }) + "\n").lastActivity("s"), "2026-01-01T00:00:00.000Z");
});
