import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type Tokens = { mother: string; family: string };

const valid = (t: string) => /^[A-Za-z0-9_-]{20,}$/.test(t);
const generate = () => randomBytes(24).toString("base64url");

/** 環境変数 > 保存済みファイル > 新規生成 (生成したら保存) */
export const loadTokens = (env: NodeJS.ProcessEnv, file: string): Tokens => {
  const saved: Partial<Tokens> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const mother = env.CARE_MOTHER_TOKEN ?? saved.mother ?? generate();
  const family = env.CARE_FAMILY_TOKEN ?? saved.family ?? generate();

  if (!valid(mother) || !valid(family)) {
    throw new Error("トークンは英数字と - _ だけの20文字以上にしてください");
  }
  if (mother === family) throw new Error("本人用と家族用のトークンは別にしてください");

  if (saved.mother !== mother || saved.family !== family) {
    if (!env.CARE_MOTHER_TOKEN || !env.CARE_FAMILY_TOKEN) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ mother, family }, null, 2), { mode: 0o600 });
    }
  }
  return { mother, family };
};
