// invoice CLI: init / client add / new / list。core.js を呼ぶ薄い層。
import { parseArgs } from "node:util";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { openStore, initStore, getIssuer, addClient, findClient, previewInvoice, createInvoice, listInvoices, localDate } from "./core.js";
import { parseItem, type ItemInput } from "./items.ts";
import { renderConfirm, renderMarkdown, renderHtml, yen, type Invoice } from "./render.ts";

export const HELP = `invoice - ターミナルで請求書(Markdown/HTML)を作る

最初は:  invoice init

  invoice init                      発行者名とインボイス登録番号を設定(最初の1回)
  invoice client add <名前>         クライアント登録 [--honorific 様] [--withholding]
  invoice new <クライアント>        請求書を作る
      [--month 2026-09] [--format md|html] [--out ファイル名]
      [--item "顧問料:50000"] [--item "記帳代行:60000:源泉"] (複数可・省略すると対話)
  invoice list                      発行済みの一覧

保存先: ~/.invoice/data.json (環境変数 INVOICE_HOME で変更)
明細は15行程度までが A4 1ページの目安です。
`;

export type IO = { out: (s: string) => void; err: (s: string) => void; ask: (q: string) => Promise<string>; cwd: string };

// core の返り値 -> render 用 Invoice。issuer 未設定は呼び出し側で先に弾く。
function toInvoice(c: any): Invoice {
  return {
    number: c.number, date: c.date, month: c.month,
    clientName: c.client.name, honorific: c.client.honorific, withholdingEnabled: c.client.withholding,
    issuer: { name: c.issuer.name, invoiceNo: c.issuer.invoiceNumber || "(未登録)" },
    items: c.items, subtotal: c.subtotal, tax: c.tax,
    withholdingBase: c.withholdingBase, withholdingTax: c.withholdingTax, total: c.total,
  };
}

const thisMonth = () => localDate().slice(0, 7);

async function askItems(io: IO, withholdingClient: boolean): Promise<ItemInput[]> {
  const items: ItemInput[] = [];
  let bad = 0; // 入力が閉じられた(EOF)ときに無限ループしない
  for (;;) {
    if (bad >= 3) throw new Error("明細を入力できませんでした。--item \"顧問料:50000\" のように指定することもできます。");
    const n = items.length + 1;
    const name = (await io.ask(items.length ? `明細 ${n} の名称は？ (Enter で入力終わり): ` : `明細 ${n} の名称は？: `)).trim();
    if (!name) { if (items.length) return items; io.out("明細が1行も入っていません。"); bad++; continue; }
    const amt = (await io.ask(`  金額(円): `)).replace(/[,，円¥\s]/g, "");
    if (!/^\d+$/.test(amt) || Number(amt) <= 0) { io.out("  金額は1以上の数字で入力してください。もう一度。"); bad++; continue; }
    let withholding = false;
    if (withholdingClient) withholding = /^y/i.test((await io.ask(`  源泉の対象ですか？ [y/N]: `)).trim());
    items.push({ name, amount: Number(amt), withholding });
  }
}

export async function run(argv: string[], io: IO, home = process.env.INVOICE_HOME ?? join(homedir(), ".invoice")): Promise<number> {
  const store = openStore(home);
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") { io.out(HELP); return 0; }
  try {
    if (cmd === "init") {
      const name = (await io.ask("発行者名(屋号または氏名): ")).trim();
      const no = (await io.ask("インボイス登録番号 (T+13桁。なければ Enter): ")).trim();
      initStore(store, { name, invoiceNumber: no });
      io.out(`設定しました。次は invoice client add <クライアント名> で取引先を登録できます。`);
      return 0;
    }
    if (cmd === "client") {
      if (rest[0] !== "add") { io.err("使い方: invoice client add <名前> [--honorific 様] [--withholding]"); return 1; }
      const { values, positionals } = parseArgs({ args: rest.slice(1), allowPositionals: true,
        options: { honorific: { type: "string" }, withholding: { type: "boolean" } } });
      const name = positionals.join(" ");
      if (!name) { io.err("クライアント名を指定してください。例: invoice client add 株式会社サンプル"); return 1; }
      const c = addClient(store, { name, honorific: values.honorific ?? "御中", withholding: !!values.withholding });
      io.out(`登録しました: ${c.name} ${c.honorific} (源泉${c.withholding ? "あり" : "なし"})\n次は invoice new "${c.name}" で請求書を作れます。`);
      return 0;
    }
    if (cmd === "list") {
      const rows = listInvoices(store);
      if (!rows.length) { io.out("まだ請求書がありません。invoice new <クライアント> で最初の1通を作れます。"); return 0; }
      for (const r of rows) io.out(`${r.number}  ${r.date}  ${r.month}  ${r.client}  ${yen(r.total)}`);
      return 0;
    }
    if (cmd === "new") {
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true,
        options: { month: { type: "string" }, format: { type: "string", default: "md" }, out: { type: "string" }, item: { type: "string", multiple: true } } });
      const key = positionals.join(" ");
      if (!key) { io.err("クライアントを指定してください。例: invoice new 株式会社サンプル"); return 1; }
      const format = values.format;
      if (format !== "md" && format !== "html") { io.err("--format は md か html です。"); return 1; }
      if (!getIssuer(store)) { io.err("先に発行者を設定してください: invoice init"); return 1; }
      const client = findClient(store, key);
      if (!client) { io.err(`${key} さんはまだ登録されていません。invoice client add ${key} で登録できます。`); return 1; }
      const month = values.month ?? thisMonth();
      const items = values.item?.length ? values.item.map(parseItem) : await askItems(io, client.withholding);
      const input = { clientId: client.id, month, items };
      io.out(renderConfirm(toInvoice(previewInvoice(store, input))));
      const ans = (await io.ask("この内容で発行しますか？ [y/N] (N・Enter は何も保存しません): ")).trim();
      if (!/^y(es)?$/i.test(ans)) { io.out("発行しませんでした。何も保存していません(番号も使っていません)。"); return 0; }
      const inv = toInvoice(createInvoice(store, input));
      const file = join(io.cwd, values.out ?? `${inv.number}.${format}`);
      writeFileSync(file, format === "html" ? renderHtml(inv) : renderMarkdown(inv));
      io.out(`${inv.number} を発行しました → ${file}`);
      return 0;
    }
    io.err(`「${cmd}」というコマンドはありません。\n\n${HELP}`);
    return 1;
  } catch (e: any) {
    if (e.code === "NO_ISSUER") io.err("先に発行者を設定してください: invoice init");
    else if (e.code === "CLIENT_NOT_FOUND") io.err(`${e.message}。invoice client add で登録できます。`);
    else if (e.code === "CLIENT_EXISTS" || e.code === "INVALID_INPUT") io.err(e.message);
    else if (e instanceof Error && !e.code) io.err(e.message);
    else throw e;
    return 1;
  }
}

if (import.meta.main) {
  // 行入力はキューで受ける(パイプ入力でも取りこぼさない)
  const rl = createInterface({ input: process.stdin });
  const lines: string[] = []; const waiters: ((s: string) => void)[] = []; let closed = false;
  rl.on("line", (l) => (waiters.shift() ?? ((s: string) => lines.push(s)))(l));
  rl.on("close", () => { closed = true; waiters.splice(0).forEach((w) => w("")); });
  const ask = (q: string) => new Promise<string>((res) => {
    process.stdout.write(q);
    if (lines.length) res(lines.shift()!); else if (closed) res(""); else waiters.push(res);
  });
  const code = await run(process.argv.slice(2), { out: (s) => console.log(s), err: (s) => console.error(s), ask, cwd: process.cwd() });
  rl.close();
  process.exitCode = code;
}
