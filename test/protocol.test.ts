import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReply } from "../src/protocol.ts";

test("parses tags, attributes, positional args and multi-line bodies", () => {
  const a = parseReply(`[THINK] hmm
[SAY to=pm,eng-a] hello
second line
[TASK owner=eng-a] Build CLI
- prints help
[TASK_DONE T1] done it
[VERDICT reject] too slow
[DONE]`);
  assert.deepEqual(
    a.map((x) => x.type),
    ["THINK", "SAY", "TASK", "TASK_DONE", "VERDICT", "DONE"],
  );
  assert.equal(a[1].attrs.to, "pm,eng-a");
  assert.equal(a[1].text, "hello\nsecond line");
  assert.equal(a[2].attrs.owner, "eng-a");
  assert.equal(a[2].text, "Build CLI\n- prints help");
  assert.equal(a[3].arg, "T1");
  assert.equal(a[4].arg, "reject");
});

test("untagged text becomes SAY; tags inside code fences are not parsed", () => {
  const a = parseReply("just talking\n```\n[TASK] not a task\n```\n");
  assert.equal(a.length, 1);
  assert.equal(a[0].type, "SAY");
  assert.match(a[0].text, /\[TASK\] not a task/);
});

test("handles CRLF line endings (Windows)", () => {
  const a = parseReply("[SAY to=all] hi\r\n[DONE]\r\n");
  assert.deepEqual(a.map((x) => x.type), ["SAY", "DONE"]);
  assert.equal(a[0].text, "hi");
});

test("a colon copied from the transcript format right after a tag is dropped", () => {
  const a = parseReply("[DECISION]: 日付は ISO 形式\n[NOTE] : 覚えておく\n[SAY to=pm]:\nこんにちは\n[VERDICT accept]:  OK");
  assert.deepEqual(
    a.map((x) => [x.type, x.text]),
    [["DECISION", "日付は ISO 形式"], ["NOTE", "覚えておく"], ["SAY", "こんにちは"], ["VERDICT", "OK"]],
  );
  assert.equal(a[2].attrs.to, "pm");
  assert.equal(a[3].arg, "accept");
});

test("[ADVANCE]: with nothing after the colon is an empty ADVANCE", () => {
  const a = parseReply("[ADVANCE]:");
  assert.deepEqual(a.map((x) => [x.type, x.text]), [["ADVANCE", ""]]);
});

test("colons that are not right after a tag stay in the text", () => {
  const a = parseReply("[SAY to=all] 10:30 です\n[NOTE] :smile: ok\n[DECISION] 期限: 金曜\n[SAY] http://x:80");
  assert.deepEqual(
    a.map((x) => x.text),
    ["10:30 です", ":smile: ok", "期限: 金曜", "http://x:80"],
  );
});
