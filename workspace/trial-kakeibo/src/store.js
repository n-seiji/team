import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const EMPTY = () => ({ nextId: 1, entries: [], batches: [] });

// JSONファイル保存。書き込みは一時ファイル→rename で、途中で落ちても元のファイルは壊れない。
export function openStore(file) {
  let state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : EMPTY();
  return {
    get state() {
      return state;
    },
    save() {
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(state, null, 2));
      renameSync(tmp, file);
    },
  };
}
