import { AppError } from './errors.js';
import { computeBalances, settle } from './settle.js';

export const CATEGORIES = ['home', 'work']; // home=家庭, work=仕事

const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const isBlank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

export function createLedger({ store, members, now = () => new Date().toISOString() }) {
  const st = () => store.state;

  function findEntry(id) {
    const e = st().entries.find((x) => x.id === Number(id));
    if (!e) throw new AppError('not_found', `記録 ${id} が見つかりません。`, 404);
    return e;
  }

  function checkAmount(v) {
    if (isBlank(v)) throw new AppError('amount_required', '金額を入力してください。');
    if (typeof v !== 'number' || !Number.isInteger(v)) {
      throw new AppError('amount_invalid', '金額は円単位の整数で入力してください。');
    }
    if (v <= 0) throw new AppError('amount_not_positive', '金額は1円以上で入力してください。');
    return v;
  }

  function checkMember(id, label) {
    if (isBlank(id)) throw new AppError('payer_required', `${label}を選んでください。`);
    if (!members.some((m) => m.id === id)) throw new AppError('member_unknown', `${label}がメンバーにいません: ${id}`);
    return id;
  }

  function checkParticipants(ids) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new AppError('participants_required', '負担する人を1人以上選んでください。');
    }
    for (const id of ids) checkMember(id, '負担する人');
    return [...new Set(ids)].sort();
  }

  function checkCategory(c) {
    if (!CATEGORIES.includes(c)) {
      throw new AppError('category_invalid', '区分は「家庭（home）」か「仕事（work）」を指定してください。');
    }
    return c;
  }

  function checkDate(d) {
    if (!validDate(d)) throw new AppError('date_invalid', '日付は YYYY-MM-DD の形式で、実在する日にしてください。');
    return d;
  }

  const lastEntry = () => [...st().entries].reverse().find((e) => !e.deleted) ?? null;

  function create(input) {
    const last = lastEntry();
    const entry = {
      id: st().nextId,
      date: checkDate(isBlank(input.date) ? today() : input.date),
      amount: checkAmount(input.amount),
      payerId: checkMember(input.payerId, '払った人'),
      participantIds: checkParticipants(
        isBlank(input.participantIds) ? members.map((m) => m.id) : input.participantIds,
      ),
      memo: typeof input.memo === 'string' ? input.memo.trim() : '',
      category: checkCategory(isBlank(input.category) ? (last?.category ?? 'home') : input.category),
      deleted: false,
      deletedAt: null,
      settled: false,
      settledAt: null,
      revisions: 0,
      createdAt: now(),
      updatedAt: now(),
    };
    st().nextId += 1;
    st().entries.push(entry);
    store.save();
    return entry;
  }

  function assertEditable(e, verb) {
    if (e.deleted) throw new AppError('entry_deleted', '削除済みの記録は変更できません。', 409);
    if (e.settled) {
      throw new AppError('entry_settled', `精算済みの記録は${verb}できません。先に精算済みを取り消してください。`, 409);
    }
  }

  function update(id, patch) {
    const e = findEntry(id);
    assertEditable(e, '修正');
    const next = { ...e };
    if ('date' in patch) next.date = checkDate(patch.date);
    if ('amount' in patch) next.amount = checkAmount(patch.amount);
    if ('payerId' in patch) next.payerId = checkMember(patch.payerId, '払った人');
    if ('participantIds' in patch) next.participantIds = checkParticipants(patch.participantIds);
    if ('memo' in patch) next.memo = typeof patch.memo === 'string' ? patch.memo.trim() : '';
    if ('category' in patch) next.category = checkCategory(patch.category);
    next.revisions = e.revisions + 1;
    next.updatedAt = now();
    Object.assign(e, next);
    store.save();
    return e;
  }

  function remove(id) {
    const e = findEntry(id);
    if (e.deleted) throw new AppError('entry_deleted', 'すでに削除済みです。', 409);
    assertEditable(e, '削除');
    e.deleted = true;
    e.deletedAt = now();
    e.updatedAt = e.deletedAt;
    store.save();
    return e;
  }

  function markSettled(id) {
    const e = findEntry(id);
    if (e.deleted) throw new AppError('entry_deleted', '削除済みの記録は精算済みにできません。', 409);
    if (e.category !== 'home') {
      throw new AppError('work_not_settleable', '仕事の記録は精算の対象外なので、精算済みにはできません。');
    }
    if (!e.settled) {
      e.settled = true;
      e.settledAt = now();
      store.save();
    }
    return e;
  }

  function unmarkSettled(id) {
    const e = findEntry(id);
    if (e.settled) {
      e.settled = false;
      e.settledAt = null;
      store.save();
    }
    return e;
  }

  const unsettledHome = () =>
    st().entries.filter((e) => e.category === 'home' && !e.deleted && !e.settled);

  // 「精算しました」: 未精算の家庭分をまとめて精算済みにし、取り消し用に束を覚える。
  function settleAll() {
    const targets = unsettledHome();
    if (targets.length === 0) throw new AppError('nothing_to_settle', '精算する記録がありません。', 409);
    const at = now();
    for (const e of targets) {
      e.settled = true;
      e.settledAt = at;
    }
    const batch = { id: (st().batches.at(-1)?.id ?? 0) + 1, at, entryIds: targets.map((e) => e.id) };
    st().batches.push(batch);
    store.save();
    return { batchId: batch.id, settledCount: targets.length };
  }

  // 直前の一括精算を元に戻す。個別に取り消し済みの記録はそのまま。
  function undoSettleAll() {
    const batch = st().batches.pop();
    if (!batch) throw new AppError('nothing_to_undo', '取り消せる一括精算がありません。', 409);
    let restored = 0;
    for (const id of batch.entryIds) {
      const e = st().entries.find((x) => x.id === id);
      if (e?.settled) {
        e.settled = false;
        e.settledAt = null;
        restored += 1;
      }
    }
    store.save();
    return { batchId: batch.id, restoredCount: restored };
  }

  function settlement() {
    const targets = unsettledHome();
    const balances = computeBalances(targets);
    for (const m of members) balances[m.id] ??= 0;
    const { transfers, approximate } = settle(balances);
    const lastBatch = st().batches.at(-1);
    const undoable = !!lastBatch && lastBatch.entryIds.some((id) => st().entries.find((x) => x.id === id)?.settled);
    return {
      transfers,
      balances,
      undoable,
      approximate,
      entryCount: targets.length,
      total: targets.reduce((s, e) => s + e.amount, 0),
    };
  }

  function list() {
    const entries = [...st().entries].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    const last = lastEntry();
    return {
      entries,
      lastCategory: last?.category ?? null,
      lastPayerId: last?.payerId ?? null,
    };
  }

  return {
    members: () => members,
    create, update, remove, markSettled, unmarkSettled,
    settleAll, undoSettleAll, settlement, list,
  };
}
