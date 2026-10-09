// 請求書オブジェクト -> Markdown / HTML / 確認画面。純関数(I/Oなし)。
// 想定する Invoice(preview は number/date なし): eng-backend の core と合わせる。
export type Invoice = {
  number?: string;
  date?: string;
  month: string;
  clientName: string;
  honorific: string;
  withholdingEnabled: boolean;
  issuer: { name: string; invoiceNo: string };
  items: { name: string; amount: number; withholding: boolean }[];
  subtotal: number;
  tax: number;
  withholdingBase: number;
  withholdingTax: number;
  total: number;
};

export const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const WH_LABEL = "源泉徴収税額 (円未満切り捨て)";

export function renderConfirm(inv: Invoice): string {
  return [
    "--- 発行前の確認 ---",
    `宛名      : ${inv.clientName} ${inv.honorific}`,
    `対象月    : ${inv.month}`,
    `合計      : ${yen(inv.total)}  (税込・源泉差引後の請求額)`,
    `源泉      : ${inv.withholdingEnabled ? `あり  ${WH_LABEL} -${yen(inv.withholdingTax)}` : "なし"}`,
    "---------------------",
  ].join("\n");
}

export function renderMarkdown(inv: Invoice): string {
  const rows = inv.items.map((i) => `| ${i.name.replace(/\|/g, "\\|")} | ${yen(i.amount)} | ${i.withholding ? "○" : ""} |`);
  const lines = [
    `# 請求書`, "",
    `**${inv.clientName} ${inv.honorific}**`, "",
    `- 請求番号: ${inv.number}`,
    `- 発行日: ${inv.date}`,
    `- 対象月: ${inv.month}`, "",
    "| 明細 | 金額 | 源泉対象 |", "|---|---:|:---:|", ...rows, "",
    `- 小計: ${yen(inv.subtotal)}`,
    `- 消費税 (10%): ${yen(inv.tax)}`,
  ];
  if (inv.withholdingEnabled) lines.push(`- ${WH_LABEL}: -${yen(inv.withholdingTax)}`);
  lines.push(`- **ご請求額: ${yen(inv.total)}**`, "", `発行者: ${inv.issuer.name}`, `適格請求書発行事業者登録番号: ${inv.issuer.invoiceNo}`, "");
  return lines.join("\n");
}

export function renderHtml(inv: Invoice): string {
  const rows = inv.items
    .map((i) => `<tr><td>${esc(i.name)}</td><td class="n">${yen(i.amount)}</td><td class="c">${i.withholding ? "○" : ""}</td></tr>`)
    .join("\n");
  const wh = inv.withholdingEnabled ? `<tr><th>${WH_LABEL}</th><td class="n">-${yen(inv.withholdingTax)}</td></tr>` : "";
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>請求書 ${esc(inv.number ?? "")}</title>
<style>
@page { size: A4; margin: 15mm; }
body { font-family: "Hiragino Sans", "Noto Sans JP", sans-serif; color: #111; max-width: 180mm; margin: 0 auto; padding: 1rem; line-height: 1.5; }
h1 { font-size: 1.6rem; letter-spacing: .3em; text-align: center; }
.meta { display: flex; justify-content: space-between; margin: 1rem 0; }
table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
th, td { border-bottom: 1px solid #999; padding: .35rem .5rem; text-align: left; }
.n { text-align: right; font-variant-numeric: tabular-nums; } .c { text-align: center; width: 5rem; }
.sum { width: 60%; margin-left: auto; } .total th, .total td { font-size: 1.2rem; font-weight: bold; border-bottom: 2px solid #111; }
@media print { body { padding: 0; } tr { break-inside: avoid; } }
</style></head><body>
<h1>請求書</h1>
<div class="meta"><div><strong style="font-size:1.2rem">${esc(inv.clientName)} ${esc(inv.honorific)}</strong></div>
<div>請求番号: ${esc(inv.number ?? "")}<br>発行日: ${esc(inv.date ?? "")}<br>対象月: ${esc(inv.month)}</div></div>
<table><thead><tr><th>明細</th><th class="n">金額</th><th class="c">源泉対象</th></tr></thead><tbody>
${rows}
</tbody></table>
<table class="sum">
<tr><th>小計</th><td class="n">${yen(inv.subtotal)}</td></tr>
<tr><th>消費税 (10%)</th><td class="n">${yen(inv.tax)}</td></tr>
${wh}
<tr class="total"><th>ご請求額</th><td class="n">${yen(inv.total)}</td></tr>
</table>
<p>発行者: ${esc(inv.issuer.name)}<br>適格請求書発行事業者登録番号: ${esc(inv.issuer.invoiceNo)}</p>
</body></html>
`;
}
