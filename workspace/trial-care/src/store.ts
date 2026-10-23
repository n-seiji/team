import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type Record = { at: string };

export type Store = {
  get(date: string): Record | undefined;
  /** 先着を保持する。すでにあればその記録を返し、上書きしない。 */
  record(date: string, at: string): Record;
};

export const openStore = (file: string): Store => {
  // 壊れたファイルは空として扱わず例外にする (黙って記録を消さない)
  const data: { [date: string]: Record } = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};

  const save = () => {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, file);
  };

  return {
    get: (date) => data[date],
    record(date, at) {
      if (!data[date]) {
        data[date] = { at };
        save();
      }
      return data[date];
    },
  };
};
