const TZ = "Asia/Tokyo";

const parts = (d: Date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );

/** 日本時間の YYYY-MM-DD */
export const tokyoDate = (d: Date): string => {
  const p = parts(d);
  return `${p.year}-${p.month}-${p.day}`;
};

/** 日本時間の HH:MM (ゼロ埋め) */
export const tokyoTime = (d: Date): string => {
  const p = parts(d);
  return `${p.hour}:${p.minute}`;
};

/** YYYY-MM-DD から n 日前 (日本は夏時間がないので暦の計算だけでよい) */
export const daysBefore = (date: string, n: number): string => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
};
