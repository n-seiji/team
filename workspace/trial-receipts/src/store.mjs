// 領収書の保存。画像1枚=1ファイル、記録=1 JSON。DBなし。
import { mkdir, readFile, writeFile, readdir, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };
export const imageType = (ct) => (ct || '').split(';')[0].trim().toLowerCase();
export const MIME_BY_EXT = Object.fromEntries(Object.entries(TYPES).map(([m, e]) => [e, m]));

export class RejectError extends Error {}

export function createStore(dir) {
  const imgDir = path.join(dir, 'images');
  const recDir = path.join(dir, 'records');
  const ready = Promise.all([mkdir(imgDir, { recursive: true }), mkdir(recDir, { recursive: true })]);
  const recFile = (id) => path.join(recDir, `${id}.json`);
  const okId = (id) => /^[0-9a-f-]{36}$/.test(id);

  return {
    imgDir,
    async create(buffer, contentType) {
      await ready;
      const ext = TYPES[imageType(contentType)];
      if (!ext) throw new RejectError('画像（JPEG・PNG・WebP・HEIC）だけ登録できます');
      if (buffer.length === 0) throw new RejectError('画像が空です');
      if (buffer.length > MAX_BYTES) throw new RejectError(`画像が10MBを超えています（${(buffer.length / 1048576).toFixed(1)}MB）`);
      const id = randomUUID();
      const image_path = `images/${id}.${ext}`;
      await writeFile(path.join(dir, image_path), buffer);
      const rec = { id, status: 'reading', created_at: new Date().toISOString(), edited: false, image_path, fields: null };
      await this.save(rec);
      return rec;
    },
    async save(rec) {
      await ready;
      const tmp = recFile(rec.id) + '.tmp';
      await writeFile(tmp, JSON.stringify(rec, null, 2));
      await rename(tmp, recFile(rec.id));
    },
    async get(id) {
      if (!okId(id)) return null;
      try { return JSON.parse(await readFile(recFile(id), 'utf8')); } catch { return null; }
    },
    async list() {
      await ready;
      const names = (await readdir(recDir)).filter((n) => n.endsWith('.json'));
      const recs = await Promise.all(names.map((n) => this.get(n.slice(0, -5))));
      return recs.filter(Boolean);
    },
    async readImage(rec) {
      return readFile(path.join(dir, rec.image_path));
    },
  };
}
