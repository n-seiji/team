// --item "名称:金額[:源泉]" の解釈。最後の2要素だけを金額・源泉として読む(名称に「:」可)。
export type ItemInput = { name: string; amount: number; withholding: boolean };

export function parseItem(raw: string): ItemInput {
  const parts = raw.split(":").map((s) => s.trim());
  let withholding = false;
  if (parts.length >= 3 && parts[parts.length - 1] === "源泉") {
    withholding = true;
    parts.pop();
  }
  const amountText = (parts.pop() ?? "").replace(/[,，円¥]/g, "");
  const name = parts.join(":").trim();
  if (!name || !/^\d+$/.test(amountText)) {
    throw new Error(`明細「${raw}」を読めませんでした。例: --item "顧問料:50000" / --item "記帳代行:60000:源泉"`);
  }
  return { name, amount: Number(amountText), withholding };
}
