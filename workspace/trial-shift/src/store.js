// JSON ファイル保存。一時ファイルに書いてから rename するので、途中で失敗しても旧データが残る。
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

const EMPTY = () => ({ nextStaffId: 1, staff: [], requests: {} });

export function createStore(file, { writeFile = writeFileSync } = {}) {
  let data = { ...EMPTY(), ...(existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}) };

  // 変更は複製に対して行い、保存に成功してから差し替える。失敗時はメモリも旧データのまま。
  function update(fn) {
    const next = structuredClone(data);
    const result = fn(next);
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    try {
      writeFile(tmp, JSON.stringify(next, null, 2));
      renameSync(tmp, file);
    } catch (e) {
      try { unlinkSync(tmp); } catch {}
      throw e;
    }
    data = next;
    return result;
  }

  return {
    get: () => data,
    update,
  };
}
