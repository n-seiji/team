import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Style } from "./check.ts";

export const CONFIG_NAME = ".commitrules.json";
export const STYLES: Style[] = ["conventional", "free"];

export class ConfigError extends Error {
  constructor(reason: string) {
    super(`${CONFIG_NAME} を読めません: ${reason}`);
  }
}

// cwd から上へたどり、.git のあるディレクトリ(リポジトリ直下)を返す。なければ null
export function findRepoRoot(from: string): string | null {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

// 設定がなければ conventional。壊れていれば黙って落とさず ConfigError
export function loadStyle(from: string): Style {
  const root = findRepoRoot(from);
  const file = root ? join(root, CONFIG_NAME) : join(resolve(from), CONFIG_NAME);
  if (!existsSync(file)) return "conventional";
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new ConfigError((e as Error).message);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new ConfigError("JSON のオブジェクトではありません");
  }
  const style = (data as { style?: unknown }).style;
  if (style === undefined) return "conventional";
  if (!STYLES.includes(style as Style)) {
    throw new ConfigError(`style は "conventional" か "free" にしてください (現在: ${JSON.stringify(style)})`);
  }
  return style as Style;
}
