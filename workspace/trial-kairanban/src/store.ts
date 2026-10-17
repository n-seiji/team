import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";

export type Status = "unread" | "self" | "proxy";

export interface Circular { id: number; title: string; body: string; createdAt: string }
export interface Household { id: number; name: string; token: string }
export interface Reading { status: Status; readAt: string | null }

export const newToken = (): string => randomBytes(24).toString("base64url");

export class Store {
  private db: DatabaseSync;
  private now: () => Date;

  constructor(path: string, now: () => Date = () => new Date()) {
    this.db = new DatabaseSync(path);
    this.now = now;
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS circulars (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS households (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE
      );
      CREATE TABLE IF NOT EXISTS readings (
        circular_id INTEGER NOT NULL REFERENCES circulars(id),
        household_id INTEGER NOT NULL REFERENCES households(id),
        status TEXT NOT NULL CHECK (status IN ('self', 'proxy')),
        read_at TEXT NOT NULL,
        PRIMARY KEY (circular_id, household_id)
      );
    `);
  }

  close(): void { this.db.close(); }

  addCircular(title: string, body: string): Circular {
    const createdAt = this.now().toISOString();
    const r = this.db.prepare("INSERT INTO circulars (title, body, created_at) VALUES (?, ?, ?)").run(title, body, createdAt);
    return { id: Number(r.lastInsertRowid), title, body, createdAt };
  }

  listCirculars(): Circular[] {
    return (this.db.prepare("SELECT id, title, body, created_at AS createdAt FROM circulars ORDER BY id DESC").all() as unknown) as Circular[];
  }

  getCircular(id: number): Circular | undefined {
    return this.db.prepare("SELECT id, title, body, created_at AS createdAt FROM circulars WHERE id = ?").get(id) as unknown as Circular | undefined;
  }

  latestCircular(): Circular | undefined {
    return this.db.prepare("SELECT id, title, body, created_at AS createdAt FROM circulars ORDER BY id DESC LIMIT 1").get() as unknown as Circular | undefined;
  }

  /** 世帯がまだ読んでいない（本人記録も代理記録もない）回覧を古い順に返す。 */
  unreadCirculars(householdId: number): Circular[] {
    return this.db.prepare(`
      SELECT c.id, c.title, c.body, c.created_at AS createdAt
      FROM circulars c
      LEFT JOIN readings r ON r.circular_id = c.id AND r.household_id = ?
      WHERE r.circular_id IS NULL
      ORDER BY c.id
    `).all(householdId) as unknown as Circular[];
  }

  addHousehold(name: string): Household {
    const token = newToken();
    const r = this.db.prepare("INSERT INTO households (name, token) VALUES (?, ?)").run(name, token);
    return { id: Number(r.lastInsertRowid), name, token };
  }

  listHouseholds(): Household[] {
    return this.db.prepare("SELECT id, name, token FROM households ORDER BY id").all() as unknown as Household[];
  }

  getHouseholdByToken(token: string): Household | undefined {
    return this.db.prepare("SELECT id, name, token FROM households WHERE token = ?").get(token) as unknown as Household | undefined;
  }

  /** 新しいトークンを発行する。古いトークンはその場で無効になる。 */
  reissueToken(householdId: number): Household | undefined {
    const token = newToken();
    const r = this.db.prepare("UPDATE households SET token = ? WHERE id = ?").run(token, householdId);
    if (r.changes === 0) return undefined;
    return this.db.prepare("SELECT id, name, token FROM households WHERE id = ?").get(householdId) as unknown as Household;
  }

  getReading(circularId: number, householdId: number): Reading {
    const row = this.db
      .prepare("SELECT status, read_at AS readAt FROM readings WHERE circular_id = ? AND household_id = ?")
      .get(circularId, householdId) as unknown as Reading | undefined;
    return row ?? { status: "unread", readAt: null };
  }

  /** 本人の「読みました」。最初の本人記録の日時を保つ。代理記録は本人記録で上書きする。 */
  markSelfRead(circularId: number, householdId: number): Reading {
    const at = this.now().toISOString();
    this.db.prepare(`
      INSERT INTO readings (circular_id, household_id, status, read_at) VALUES (?, ?, 'self', ?)
      ON CONFLICT (circular_id, household_id) DO UPDATE
        SET status = 'self', read_at = excluded.read_at
        WHERE readings.status <> 'self'
    `).run(circularId, householdId, at);
    return this.getReading(circularId, householdId);
  }

  /** 班長の代理記録。本人が読んだ世帯、記録済みの世帯は変えない。 */
  markProxyRead(circularId: number, householdId: number): Reading {
    const at = this.now().toISOString();
    this.db.prepare(`
      INSERT INTO readings (circular_id, household_id, status, read_at) VALUES (?, ?, 'proxy', ?)
      ON CONFLICT (circular_id, household_id) DO NOTHING
    `).run(circularId, householdId, at);
    return this.getReading(circularId, householdId);
  }

  /** 全世帯の状態を1回で返す。 */
  statusBoard(circularId: number): { household: Household; reading: Reading }[] {
    const rows = this.db.prepare(`
      SELECT h.id, h.name, h.token, r.status, r.read_at AS readAt
      FROM households h
      LEFT JOIN readings r ON r.household_id = h.id AND r.circular_id = ?
      ORDER BY h.id
    `).all(circularId) as unknown as (Household & { status: Status | null; readAt: string | null })[];
    return rows.map((r) => ({
      household: { id: r.id, name: r.name, token: r.token },
      reading: { status: r.status ?? "unread", readAt: r.readAt },
    }));
  }
}
