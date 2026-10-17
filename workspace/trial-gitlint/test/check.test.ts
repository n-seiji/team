import { test } from "node:test";
import assert from "node:assert/strict";
import { check, TYPE_HINT } from "../src/check.ts";

// 正常 3 件
test("ok: feat: 説明", () => {
  const r = check("feat: ログイン画面を追加する");
  assert.equal(r.ok, true);
  assert.deepEqual(r.problems, []);
});
test("ok: scope 付き", () => {
  assert.equal(check("fix(ui): ログイン画面の余白を直す").ok, true);
});
test("ok: fix: ログイン画面の余白を直す (曖昧語は単独のときだけ)", () => {
  assert.equal(check("fix: ログイン画面の余白を直す").ok, true);
});

// 異常 5 件
test("ng: 曖昧語 fix / update / wip2", () => {
  for (const m of ["fix", "update", "wip2"]) {
    const r = check(m);
    assert.equal(r.ok, false, m);
    assert.equal(r.problems.length, 1, m);
    assert.ok(r.suggestions.length >= 1, m);
  }
  assert.equal(check("fix").suggestions[0], "fix: <説明>");
  assert.equal(check("wip2").suggestions[0], `${TYPE_HINT}: <説明>`);
});
test("ng: type なし", () => {
  const r = check("ログイン画面の余白を調整した");
  assert.equal(r.ok, false);
  assert.match(r.problems[0].why, /先頭に『何をしたか』の種類\(feat や fix\)がありません/);
  assert.equal(r.suggestions[0], `${TYPE_HINT}: ログイン画面の余白を調整した`);
});
test("ng: コロン後の空白なし", () => {
  const r = check("feat:ボタンを追加");
  assert.equal(r.ok, false);
  assert.equal(r.suggestions[0], "feat: ボタンを追加");
});
test("ng: 説明が空", () => {
  const r = check("feat: ");
  assert.equal(r.ok, false);
  assert.equal(r.suggestions[0], "feat: <説明>");
});
test("ng: type が不正", () => {
  const r = check("foo: ボタンを追加");
  assert.equal(r.ok, false);
  assert.equal(r.suggestions[0], `${TYPE_HINT}: ボタンを追加`);
  assert.equal(check("feature: ボタン").suggestions[0], "feat: ボタン");
});

// type 推定
test("suggest: 先頭の語から type を推定できるときだけ埋める", () => {
  assert.equal(check("add login button").suggestions[0], "feat: login button");
  assert.equal(check("追加 ボタン").suggestions[0], "feat: ボタン");
  assert.equal(check("修正 余白").suggestions[0], "fix: 余白");
  assert.equal(check("readme を更新").suggestions[0], "docs: を更新");
  assert.equal(check("hello world").suggestions[0], `${TYPE_HINT}: hello world`);
});

// 仕様用語を出さない
test("文言に仕様用語を出さない", () => {
  for (const m of ["fix", "x", "feat:a", "feat: ", "foo: a"]) {
    const text = JSON.stringify(check(m));
    assert.doesNotMatch(text, /footer|BREAKING|scope|body/i, m);
  }
});

// free
test("free: type なしでも通る", () => {
  const r = check("ログイン画面を直した", { style: "free" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.problems, []);
});
test("free: 1語だけは警告 (ok のまま)", () => {
  const r = check("wip", { style: "free" });
  assert.equal(r.ok, true);
  assert.equal(r.problems.length, 1);
});

// 自動生成メッセージ・空
test("merge / revert / fixup は通す", () => {
  for (const m of ["Merge branch 'a' into b", 'Revert "feat: x"', "fixup! feat: x"]) {
    assert.equal(check(m).ok, true, m);
  }
});
test("複数行は 1 行目だけ見る", () => {
  assert.equal(check("feat: a\n\nfix").ok, true);
});
test("空メッセージは問題あり", () => {
  assert.equal(check("").ok, false);
  assert.equal(check("  ", { style: "free" }).ok, false);
});

// T9: 日本語の末尾から推定する
test("T9: 末尾の「修正」→ fix", () => {
  const r = check("ヘッダー修正");
  assert.equal(r.ok, false);
  assert.equal(r.suggestions[0], "fix: ヘッダー");
});
test("T9: 末尾の「追加」→ feat", () => {
  const r = check("ボタン追加");
  assert.equal(r.ok, false);
  assert.equal(r.suggestions[0], "feat: ボタン");
});
test("T9: 辞書にない末尾は雛形のまま", () => {
  assert.equal(check("ヘッダー削除").suggestions[0], `${TYPE_HINT}: ヘッダー削除`);
});
test("T9: 雛形の文言は種類の説明付き", () => {
  assert.equal(TYPE_HINT, "<種類(feat=追加 / fix=修正)>");
  assert.equal(check("update").suggestions[0], "<種類(feat=追加 / fix=修正)>: <説明>");
  assert.equal(check("wip2").suggestions[0], "<種類(feat=追加 / fix=修正)>: <説明>");
});

// T10: <type> が出るすべての場所と、1 語だけの場合
test("T10: 本文付きで推定できないとき", () => {
  assert.equal(check("ログイン画面直した").suggestions[0], "<種類(feat=追加 / fix=修正)>: ログイン画面直した");
});
test("T10: 別名の type は直し案が変わらない", () => {
  assert.equal(check("feature: x").suggestions[0], "feat: x");
});
test("T10: 別名にない不正な type", () => {
  assert.equal(check("foo: x").suggestions[0], "<種類(feat=追加 / fix=修正)>: x");
});
test("T10: 1語だけの「修正」「追加」", () => {
  for (const [m, want] of [["修正", "fix: <説明>"], ["追加", "feat: <説明>"]]) {
    const r = check(m);
    assert.equal(r.ok, false, m);
    assert.equal(r.suggestions[0], want, m);
  }
});
test("T10: 「ヘッダーを修正」は末尾の推定の対象外", () => {
  assert.equal(check("ヘッダーを修正").suggestions[0], "<種類(feat=追加 / fix=修正)>: ヘッダーを修正");
});
test("T10: suggestions に半角の <type> が出ない", () => {
  const msgs = ["", "fix", "update", "wip2", "x", "ログイン画面直した", "foo: x", "Foo:x", "feat: ", "修正", "ヘッダーを修正", "ヘッダー修正"];
  for (const m of msgs) {
    const r = check(m);
    assert.deepEqual(Object.keys(r), ["ok", "problems", "suggestions"], m);
    assert.doesNotMatch(JSON.stringify(r), /<type>/, m);
  }
});
test("T12: 末尾の「調整」→ fix", () => {
  const r = check("レイアウト調整");
  assert.equal(r.ok, false);
  assert.equal(r.suggestions[0], "fix: レイアウト");
});
test("T12: 末尾の「差し替え」→ fix", () => {
  const r = check("画像差し替え");
  assert.equal(r.ok, false);
  assert.equal(r.suggestions[0], "fix: 画像");
});
test("T12: 末尾の「変更」→ fix", () => {
  const r = check("文言変更");
  assert.equal(r.ok, false);
  assert.equal(r.suggestions[0], "fix: 文言");
});
test("T12: 末尾の「対応」→ feat", () => {
  const r = check("ログイン対応");
  assert.equal(r.ok, false);
  assert.equal(r.suggestions[0], "feat: ログイン");
});
test("T12: 「画像を差し替え」は末尾の推定の対象外", () => {
  assert.equal(check("画像を差し替え").suggestions[0], "<種類(feat=追加 / fix=修正)>: 画像を差し替え");
});
