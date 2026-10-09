// invoice CLI: init / client add / new / list。core.js を呼ぶ薄い層。
import { parseArgs } from "node:util";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { openStore, initStore, getIssuer, addClient, listClients, findClient, previewInvoice, createInvoice, listInvoices, invoicesToCsv, localDate, getTemplate, setTemplate } from "./core.js";
import { parseItem, type ItemInput } from "./items.ts";
import { renderConfirm, renderMarkdown, renderHtml, yen, type Invoice } from "./render.ts";

export const HELP = `invoice - ターミナルで請求書(Markdown/HTML)を作る

最初は:  invoice init

  invoice init                      発行者名とインボイス登録番号を設定(最初の1回)
  invoice client add <名前>         クライアント登録 [--honorific 様] [--withholding]
  invoice new <クライアント>        請求書を作る
      [--month 2026-09] [--format md|html] [--out ファイル名]
      [--item "顧問料:50000"] [--item "記帳代行:60000:源泉"] (複数可・省略すると対話)
  invoice list [--csv [--out ファイル名]]  発行済みの一覧(--csv は Excel 用)

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

// 空でない答えが返るまで聞く。入力が閉じられたとき(EOF)に無限ループしないよう3回で諦める。
async function askRequired(io: IO, q: string): Promise<string> {
  for (let i = 0; i < 3; i++) {
    const a = (await io.ask(q)).trim();
    if (a) return a;
    io.out("  入力が空です。もう一度お願いします。");
  }
  throw new Error("入力を受け取れませんでした。");
}

const isYes = (s: string) => /^(y|yes|はい|ｙ)$/i.test(s.trim());

async function askItems(io: IO, withholdingClient: boolean, offset = 0): Promise<ItemInput[]> {
  const items: ItemInput[] = [];
  let bad = 0; // 入力が閉じられた(EOF)ときに無限ループしない
  for (;;) {
    if (bad >= 3) throw new Error("明細を入力できませんでした。--item \"顧問料:50000\" のように指定することもできます。");
    const n = items.length + 1 + offset;
    const name = (await io.ask(items.length || offset ? `明細 ${n} の名称は？ (Enter で入力終わり): ` : `明細 ${n} の名称は？: `)).trim();
    if (!name) { if (items.length || offset) return items; io.out("明細が1行も入っていません。"); bad++; continue; }
    const amt = (await io.ask(`  金額(円): `)).replace(/[,，円¥\s]/g, "");
    if (!/^\d+$/.test(amt) || Number(amt) <= 0) { io.out("  金額は1以上の数字で入力してください。もう一度。"); bad++; continue; }
    let withholding = false;
    if (withholdingClient) withholding = /^y/i.test((await io.ask(`  源泉の対象ですか？ [y/N]: `)).trim());
    items.push({ name, amount: Number(amt), withholding });
  }
}

const fmtItem = (i: ItemInput) => `${i.name}  ${yen(i.amount)}${i.withholding ? "  (源泉対象)" : ""}`;
const sameItems = (a: ItemInput[], b: ItemInput[]) =>
  a.length === b.length && a.every((x, i) => x.name === b[i].name && x.amount === b[i].amount && !!x.withholding === !!b[i].withholding);

// 定番を1行ずつ直す。Enter で前回の値のまま、「-」で行を削除、最後に行を足せる。
async function editItems(io: IO, base: ItemInput[], withholdingClient: boolean): Promise<ItemInput[]> {
  const out: ItemInput[] = [];
  for (const [i, it] of base.entries()) {
    const name = (await io.ask(`明細 ${i + 1} の名称 [${it.name}] (Enter でそのまま、- で削除): `)).trim();
    if (name === "-") continue;
    const amt = (await io.ask(`  金額(円) [${it.amount}]: `)).replace(/[,，円¥\s]/g, "");
    const amount = /^\d+$/.test(amt) && Number(amt) > 0 ? Number(amt) : it.amount;
    let withholding = it.withholding;
    if (withholdingClient) {
      const w = (await io.ask(`  源泉の対象ですか？ [${it.withholding ? "Y/n" : "y/N"}]: `)).trim();
      if (w) withholding = isYes(w);
    }
    out.push({ name: name || it.name, amount, withholding });
  }
  if (!out.length || isYes(await io.ask("明細を追加しますか？ [y/N]: "))) out.push(...(await askItems(io, withholdingClient, out.length)));
  return out;
}

export async function run(argv: string[], io: IO, home = process.env.INVOICE_HOME ?? join(homedir(), ".invoice")): Promise<number> {
  const store = openStore(home);
  const [cmd, ...rest] = argv;
  let key = "";
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") { io.out(HELP); return 0; }
  try {
    if (cmd === "init") {
      const name = await askRequired(io, "あなたの名前(屋号でも可)は？ 請求書の発行者として表示されます: ");
      const no = (await io.ask("インボイス登録番号は？ T から始まる14文字です。なければそのまま Enter: ")).trim();
      initStore(store, { name, invoiceNumber: no });
      io.out(`設定しました。次は invoice client add <クライアント名> で取引先を登録できます。`);
      return 0;
    }
    if (cmd === "client") {
      if (rest[0] !== "add") { io.err("取引先を登録するには invoice client add と入力してください。名前は後から質問します。"); return 1; }
      const { values, positionals } = parseArgs({ args: rest.slice(1), allowPositionals: true,
        options: { honorific: { type: "string" }, withholding: { type: "boolean" } } });
      let name = positionals.join(" ");
      let honorific = values.honorific ?? "御中";
      let withholding = !!values.withholding;
      const interactiveAdd = !name;
      if (!name) { // 引数なし: 1つずつ質問する
        name = await askRequired(io, "取引先の名前は？ 例: 株式会社サンプル: ");
        honorific = (await io.ask("宛名の敬称は？ 会社なら御中、個人なら様。そのまま Enter なら「御中」: ")).trim() || "御中";
        withholding = isYes(await io.ask(`${name} への請求から源泉徴収しますか？ 報酬が源泉の対象なら y、そうでなければそのまま Enter: `));
      }
      const c = addClient(store, { name, honorific, withholding });
      io.out(`登録しました: ${c.name} ${c.honorific} (源泉${c.withholding ? "あり" : "なし"})`);
      if (interactiveAdd && isYes(await io.ask("定番の明細を登録しますか？ 毎月同じ内容なら便利です [y/N]: "))) {
        setTemplate(store, c.id, await askItems(io, c.withholding));
        io.out("定番を保存しました。invoice new のとき下書きに出ます。");
      }
      io.out(`次は invoice new "${c.name}" で請求書を作れます。`);
      return 0;
    }
    if (cmd === "list") {
      const { values } = parseArgs({ args: rest, options: { csv: { type: "boolean" }, out: { type: "string" } } });
      if (values.csv) {
        const csv = invoicesToCsv(store);
        if (values.out) { writeFileSync(join(io.cwd, values.out), csv); io.out(`一覧を書き出しました → ${join(io.cwd, values.out)}`); }
        else io.out(csv.replace(/\r\n$/, "")); // out が改行を足すので末尾の CRLF だけ外す
        return 0;
      }
      const rows = listInvoices(store);
      if (!rows.length) { io.out("まだ請求書がありません。invoice new <クライアント> で最初の1通を作れます。"); return 0; }
      for (const r of rows) io.out(`${r.number}  ${r.date}  ${r.month}  ${r.client}  ${yen(r.total)}`);
      return 0;
    }
    if (cmd === "new") {
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true,
        options: { month: { type: "string" }, format: { type: "string", default: "md" }, out: { type: "string" }, item: { type: "string", multiple: true } } });
      key = positionals.join(" ");
      const format = values.format;
      if (format !== "md" && format !== "html") { io.err("出力形式は md か html で指定してください。"); return 1; }
      if (!getIssuer(store)) { io.err("先に発行者を設定してください: invoice init"); return 1; }
      if (!key) { // 引数なし: 登録済みの取引先から選ぶ
        const clients = listClients(store);
        if (!clients.length) { io.err("取引先がまだ登録されていません。invoice client add で登録できます。"); return 1; }
        io.out("どの取引先に請求しますか？");
        clients.forEach((c: any, i: number) => io.out(`  ${i + 1}. ${c.name} ${c.honorific}`));
        const a = (await askRequired(io, "番号か名前を入力: ")).replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10));
        key = /^\d+$/.test(a) && clients[Number(a) - 1] ? clients[Number(a) - 1].name : a;
      }
      const client = findClient(store, key);
      if (!client) { io.err(`「${key}」はまだ登録されていません。invoice client add ${key} で登録できます。`); return 1; }
      const interactive = !values.item?.length;
      let month = values.month ?? thisMonth();
      if (interactive && !values.month) month = (await io.ask(`何月分の請求ですか？ 例: ${month}。そのまま Enter なら ${month}: `)).trim() || month;
      const saved: ItemInput[] = getTemplate(store, client.id);
      let items: ItemInput[];
      if (values.item?.length) items = values.item.map(parseItem);
      else if (saved.length) {
        io.out("前回までの定番の明細です:");
        saved.forEach((it, i) => io.out(`  ${i + 1}. ${fmtItem(it)}`));
        const c = (await io.ask("どうしますか？ 1 そのまま使う / 2 直す / 3 最初から入力 [1]: ")).trim();
        if (c === "3") items = await askItems(io, client.withholding);
        else if (c === "2") items = await editItems(io, saved, client.withholding);
        else items = saved;
      } else items = await askItems(io, client.withholding);
      const input = { clientId: client.id, month, items };
      io.out(renderConfirm(toInvoice(previewInvoice(store, input))));
      const ans = (await io.ask("この内容で発行しますか？ [y/N] (N・Enter は何も保存しません): ")).trim();
      if (!/^y(es)?$/i.test(ans)) { io.out("発行しませんでした。何も保存していません(番号も使っていません)。"); return 0; }
      const inv = toInvoice(createInvoice(store, input));
      if (interactive && !sameItems(items, saved) && isYes(await io.ask("この明細を、次回からの定番にしますか？ [y/N]: "))) {
        setTemplate(store, client.id, items);
        io.out("定番を保存しました。");
      }
      const file = join(io.cwd, values.out ?? `${inv.number}.${format}`);
      writeFileSync(file, format === "html" ? renderHtml(inv) : renderMarkdown(inv));
      io.out(`${inv.number} を発行しました → ${file}`);
      return 0;
    }
    io.err(`「${cmd}」というコマンドはありません。\n\n${HELP}`);
    return 1;
  } catch (e: any) {
    if (e.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION" || e.code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE") io.err("使えない指定があります。invoice と入力すると使い方を見られます。");
    else if (e.code === "NO_ISSUER") io.err("先に発行者を設定してください: invoice init");
    else if (e.code === "CLIENT_NOT_FOUND") io.err(`${e.message}。invoice client add ${key} で登録できます。`);
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
