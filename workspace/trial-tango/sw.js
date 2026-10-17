// オフライン用。ネットワーク優先で、つながらないときだけ保存したファイルを使う。
const CACHE = 'trial-tango-v3';
// 画面が読み込むファイルは全部ここに入れる (test/files.test.js で確かめる)。npm run dist もこれを使う
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'teacher.html', 'teacher.js',
  'test.html', 'test.js', 'src/tango.js', 'src/teacher.js', 'src/progress.js', 'src/quiz.js', 'src/seat.js'];

self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))));
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then((res) => {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
