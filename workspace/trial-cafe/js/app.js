import { createStore } from './store.js';
import { renderCheck } from './check.js';
import { renderOrder } from './order.js';

const root = document.getElementById('app');
let store;
try {
  store = createStore(window.localStorage);
} catch (err) {
  console.error(err);
  root.innerHTML = '<p class="status error" role="alert">このブラウザではデータを保存できません。プライベートブラウズを切って、開き直してください。</p>';
}

function route() {
  if (!store) return;
  const page = location.hash.replace(/^#\//, '') || 'check';
  document.querySelectorAll('nav a').forEach((a) => a.setAttribute('aria-current', String(a.getAttribute('href') === `#/${page}`)));
  if (page === 'check') return renderCheck(root, store);
  if (page === 'order') return renderOrder(root, store);
  root.innerHTML = '<p>このページはまだありません。<a href="#/check">在庫チェックへ</a></p>';
}
window.addEventListener('hashchange', route);
route();
