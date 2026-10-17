import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { AppError } from './errors.js';

const MAX_NAME = 30;

// メンバー名簿。list は ledger と共有する「生きた配列」で、追加・改名はその場で反映される。
// 保存先 file があればそちらを優先し、なければ seed（config/members.json の中身）を初期値に使う。
export function openMembers({ file, seed = [] }) {
  const list = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).members : seed.map((m) => ({ ...m }));

  function save() {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ members: list }, null, 2));
    renameSync(tmp, file);
  }

  function checkName(raw, exceptId) {
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name) throw new AppError('name_required', '名前を入力してください。');
    if ([...name].length > MAX_NAME) throw new AppError('name_too_long', `名前は${MAX_NAME}文字以内にしてください。`);
    const key = name.toLowerCase();
    if (list.some((m) => m.id !== exceptId && m.name.toLowerCase() === key)) {
      throw new AppError('name_duplicate', `「${name}」はすでにいます。別の名前にしてください。`, 409);
    }
    return name;
  }

  // 採番は m1, m2…。設定ファイル由来の id（kenta など）と衝突しない番号まで進める。
  function nextId() {
    const ids = new Set(list.map((m) => m.id));
    let n = 1;
    while (ids.has(`m${n}`)) n += 1;
    return `m${n}`;
  }

  return {
    list,
    add(input) {
      const member = { id: nextId(), name: checkName(input?.name) };
      list.push(member);
      save();
      return member;
    },
    rename(id, input) {
      const m = list.find((x) => x.id === id);
      if (!m) throw new AppError('not_found', `メンバー ${id} が見つかりません。`, 404);
      m.name = checkName(input?.name, id);
      save();
      return m;
    },
  };
}
