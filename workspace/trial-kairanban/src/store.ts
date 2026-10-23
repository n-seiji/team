import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export const STATUSES = ["未着", "受取済", "次へ渡した", "不在で保留"] as const;
export type Status = (typeof STATUSES)[number];
export const IMPORTANCES = ["通常", "重要"] as const;
export type Importance = (typeof IMPORTANCES)[number];
export type Mode = "paper" | "digital";

export interface House { id: string; name: string; mode: Mode }
export interface Group { id: string; name: string; leaders: string[]; passphrase: string; houses: House[] }
export interface Roster { admin: { names: string[]; passphrase: string }; groups: Group[] }

export interface Circular { id: string; title: string; importance: Importance; createdAt: string; order: Record<string, string[]> }
export interface Record_ { circularId: string; houseId: string; status: Status; at: string; by: string }

type Event = { type: "circular"; circular: Circular } | { type: "record"; record: Record_ };

export const STALE_DAYS = 3;
const DAY = 86_400_000;

export class DomainError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export function loadRoster(path: string): Roster {
  const r = JSON.parse(readFileSync(path, "utf8")) as Roster;
  const seen = new Set<string>();
  for (const g of r.groups) for (const h of g.houses) {
    if (seen.has(h.id)) throw new Error(`名簿: 家IDが重複しています ${h.id}`);
    seen.add(h.id);
    if (h.mode !== "paper" && h.mode !== "digital") throw new Error(`名簿: ${h.id} の参加方法が不正です`);
  }
  return r;
}

export class Store {
  roster: Roster;
  circulars: Circular[] = [];
  records: Record_[] = [];
  #logPath?: string;
  #now: () => Date;

  constructor(roster: Roster, opts: { logPath?: string; now?: () => Date } = {}) {
    this.roster = roster;
    this.#now = opts.now ?? (() => new Date());
    this.#logPath = opts.logPath;
    if (opts.logPath) {
      mkdirSync(dirname(opts.logPath), { recursive: true });
      if (existsSync(opts.logPath)) {
        for (const line of readFileSync(opts.logPath, "utf8").split("\n")) {
          if (!line.trim()) continue;
          const e = JSON.parse(line) as Event;
          if (e.type === "circular") this.circulars.push(e.circular);
          else this.records.push(e.record);
        }
      }
    }
  }

  #append(e: Event) {
    if (this.#logPath) appendFileSync(this.#logPath, JSON.stringify(e) + "\n");
  }

  #group(id: string): Group {
    const g = this.roster.groups.find((x) => x.id === id);
    if (!g) throw new DomainError(404, `班が見つかりません: ${id}`);
    return g;
  }

  /** 会長のみ。order を省略すると名簿の順番どおり。 */
  createCircular(input: { title: string; importance?: string; order?: Record<string, string[]>; by: string; passphrase: string }, at = this.#now()): Circular {
    const a = this.roster.admin;
    if (!a.names.includes(input.by) || input.passphrase !== a.passphrase) throw new DomainError(403, "合言葉または記録者が違います");
    const title = String(input.title ?? "").trim();
    if (!title) throw new DomainError(400, "題名が必要です");
    const importance = (input.importance ?? "通常") as Importance;
    if (!IMPORTANCES.includes(importance)) throw new DomainError(400, "重要度は 通常/重要 のどちらかです");
    const order: Record<string, string[]> = {};
    for (const g of this.roster.groups) {
      const ids = g.houses.map((h) => h.id);
      const given = input.order?.[g.id];
      if (given) {
        if (given.length !== ids.length || [...given].sort().join() !== [...ids].sort().join())
          throw new DomainError(400, `${g.name}の順番は、名簿の家をすべて1回ずつ含めてください`);
        order[g.id] = given;
      } else order[g.id] = ids;
    }
    const circular: Circular = { id: `c${this.circulars.length + 1}`, title, importance, createdAt: at.toISOString(), order };
    this.circulars.push(circular);
    this.#append({ type: "circular", circular });
    return circular;
  }

  getCircular(id: string): Circular {
    const c = this.circulars.find((x) => x.id === id);
    if (!c) throw new DomainError(404, `回覧が見つかりません: ${id}`);
    return c;
  }

  /** 班長(その班の名簿にある名前+班の合言葉)または会長が記録できる。 */
  record(input: { circularId: string; houseId: string; status: string; by: string; passphrase: string }, at = this.#now()): Record_ {
    const c = this.getCircular(input.circularId);
    const g = this.roster.groups.find((x) => x.houses.some((h) => h.id === input.houseId));
    if (!g) throw new DomainError(404, `家が見つかりません: ${input.houseId}`);
    if (!STATUSES.includes(input.status as Status)) throw new DomainError(400, `状態は ${STATUSES.join("/")} のいずれかです`);
    const a = this.roster.admin;
    const ok = (g.leaders.includes(input.by) && input.passphrase === g.passphrase) || (a.names.includes(input.by) && input.passphrase === a.passphrase);
    if (!ok) throw new DomainError(403, "合言葉または記録者が違います");
    const record: Record_ = { circularId: c.id, houseId: input.houseId, status: input.status as Status, at: at.toISOString(), by: input.by };
    this.records.push(record);
    this.#append({ type: "record", record });
    return record;
  }

  history(circularId: string, houseId?: string): Record_[] {
    this.getCircular(circularId);
    return this.records.filter((r) => r.circularId === circularId && (!houseId || r.houseId === houseId));
  }

  /** 回覧の全体像。班ごとに現在地・留まり日数・完了数を計算する。 */
  view(circularId: string, now = this.#now()) {
    const c = this.getCircular(circularId);
    const recs = this.records.filter((r) => r.circularId === c.id);
    const groups = this.roster.groups.map((g) => {
      const byId = new Map(g.houses.map((h) => [h.id, h]));
      const houses = c.order[g.id].map((id) => {
        const hr = recs.filter((r) => r.houseId === id);
        const last = hr.at(-1);
        const h = byId.get(id)!;
        return { id, name: h.name, mode: h.mode, status: (last?.status ?? "未着") as Status, recordedAt: last?.at ?? null, recordedBy: last?.by ?? null, _recs: hr };
      });
      const completedCount = houses.filter((h) => h.status === "受取済" || h.status === "次へ渡した").length;
      const idx = houses.findIndex((h) => h.status !== "次へ渡した");
      const done = completedCount === houses.length;
      const cur = idx === -1 ? houses.at(-1)! : houses[idx];
      // 留まり開始 = 前の家が「次へ渡した」と記録した最新の日時(先頭の家は回覧作成日)
      const prev = idx > 0 ? houses[idx - 1] : null;
      const since = prev ? [...prev._recs].reverse().find((r) => r.status === "次へ渡した")!.at : c.createdAt;
      const stayDays = Math.max(0, Math.floor((now.getTime() - Date.parse(since)) / DAY));
      // 保留に入った日 = 連続した「不在で保留」の最初の記録
      let holdSince: string | null = null;
      if (cur.status === "不在で保留") {
        for (const r of [...cur._recs].reverse()) { if (r.status !== "不在で保留") break; holdSince = r.at; }
      }
      const holdDays = holdSince ? Math.max(0, Math.floor((now.getTime() - Date.parse(holdSince)) / DAY)) : null;
      return {
        group: g.id, groupName: g.name, leaders: g.leaders,
        current: { id: cur.id, name: cur.name, mode: cur.mode },
        status: cur.status, stayingSince: since, stayDays, stale: !done && stayDays >= STALE_DAYS,
        holdSince, holdDays,
        // 未着のまま3日以上=渡した側の記録忘れか、まだ届いていない。断言せず確認を促す。
        receiptMissing: !done && cur.status === "未着" && stayDays >= STALE_DAYS,
        completedCount, total: houses.length, done,
        houses: houses.map(({ _recs, ...h }) => h),
      };
    });
    return { id: c.id, title: c.title, importance: c.importance, createdAt: c.createdAt, completed: groups.every((x) => x.done), groups };
  }

  list() {
    return this.circulars.map((c) => {
      const v = this.view(c.id);
      return { id: c.id, title: c.title, importance: c.importance, createdAt: c.createdAt, completed: v.completed, doneGroups: v.groups.filter((g) => g.done).length, groupCount: v.groups.length };
    });
  }

  /** 班長選択用。合言葉は出さない。 */
  publicGroups() {
    return this.roster.groups.map((g) => ({ id: g.id, name: g.name, leaders: g.leaders, houseCount: g.houses.length }));
  }
}
