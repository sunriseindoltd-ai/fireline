// @ts-nocheck
// Persistent left nav: portfolio + chain list + chain tabs.
import { config } from '../config.js';
import { openUploadModal } from './UploadModal.js';
import { openCoverageModal } from './CoverageModal.js';
import { openTakedownModal } from './TakedownModal.js';
import { isAdmin } from '../state/session.js';

const ic = (path) => `<span class="sb-ic"><svg viewBox="0 0 24 24">${path}</svg></span>`;
const I = {
  grid: ic('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>'),
  map: ic('<polygon points="1 6 8 3 16 6 23 3 23 18 16 21 8 18 1 21"/><line x1="8" y1="3" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="21"/>'),
  table: ic('<path d="M3 5h18v14H3z"/><path d="M3 10h18"/><path d="M9 10v9"/>'),
  file: ic('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>'),
  more: ic('<circle cx="12" cy="6" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="18" r="1"/>'),
  up: ic('<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>'),
  cover: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/>'),
};

export async function mount(container, router) {
  let projects = [];
  try { projects = await (await fetch(`${config.dataBaseUrl}/${config.overview.projects}`)).json(); } catch {}
  projects.sort((a, b) => b.mill_count - a.mill_count);

  function render() {
    const c = router.current();
    const inChain = c.name === 'project';
    const pid = inChain ? c.projectId : '';
    const admin = isAdmin();
    container.innerHTML = `
      <div class="sb-brand" data-home><span class="mark"></span> Kanopi</div>
      <div class="sb-sub">EarthLine · ketertelusuran</div>
      <nav class="sb-nav">
        <button class="sb-item ${c.name === 'home' ? 'on' : ''}" data-home>
          ${I.grid} Portfolio</button>
      </nav>
      <div class="sb-sec">Rantai pasok</div>
      <ul class="sb-chains">
        ${projects.map(p => `<li class="${p.id === pid ? 'on' : ''}" data-chain="${p.id}">
          <span class="nm">${p.name}</span>
          <span class="mt">${p.mill_count}</span>
        </li>`).join('')}
      </ul>
      ${inChain ? `<nav class="sb-nav sub">
        <a class="sb-item ${c.tab === 'dashboard' ? 'on' : ''}" href="#/project/${pid}">${I.grid} Ringkasan</a>
        <a class="sb-item ${c.tab === 'map' ? 'on' : ''}" href="#/project/${pid}/map">${I.map} Peta</a>
        <a class="sb-item ${c.tab === 'data' ? 'on' : ''}" href="#/project/${pid}/data">${I.table} Data plot</a>
        <a class="sb-item ${c.tab === 'report' ? 'on' : ''}" href="#/project/${pid}/report">${I.file} Laporan</a>
        <button class="sb-item" data-more>${I.more} Lainnya</button>
        <div class="sb-more hide" id="sb-more">
          <a class="sb-item ${c.tab === 'cases' ? 'on' : ''}" href="#/project/${pid}/cases">Kasus</a>
          <a class="sb-item ${c.tab === 'signals' ? 'on' : ''}" href="#/project/${pid}/signals">Sinyal</a>
          ${admin ? `<button class="sb-item" data-coverage>${I.cover} Cakupan data</button>` : ''}
          ${admin ? '<button class="sb-item" data-takedown>Ambil turun</button>' : ''}
        </div>
      </nav>` : ''}
      <div class="sb-spacer"></div>
      ${admin ? `<div class="sb-nav">
        <button class="sb-item dev" data-coverage>${I.cover} Cakupan data</button>
        <button class="sb-item dev up" data-upload>${I.up} Unggah data</button>
        <div class="sb-admin-note">Butuh server lokal (npm run dev) — belum aktif di deployment ini.</div>
      </div>` : ''}
      <div class="sb-foot">
        <span class="sb-ver">Kanopi 0.0.12</span>
        <button class="sb-logout" type="button" data-logout>Keluar</button>
      </div>`;

    container.querySelectorAll('[data-home]').forEach(el => { el.onclick = () => router.go('#/'); });
    container.querySelectorAll('[data-chain]').forEach(el => { el.onclick = () => router.go(`#/project/${el.dataset.chain}`); });
    const more = container.querySelector('#sb-more');
    container.querySelector('[data-more]')?.addEventListener('click', () => more?.classList.toggle('hide'));
    container.querySelectorAll('[data-upload]').forEach(el => { el.onclick = () => {
      const cc = router.current(); openUploadModal(cc.name === 'project' ? cc.projectId : undefined);
    }; });
    container.querySelectorAll('[data-coverage]').forEach(el => { el.onclick = () => {
      const cc = router.current(); openCoverageModal(cc.name === 'project' ? cc.projectId : undefined);
    }; });
    container.querySelectorAll('[data-takedown]').forEach(el => { el.onclick = () => {
      const cc = router.current(); openTakedownModal(cc.name === 'project' ? cc.projectId : undefined);
    }; });
    container.querySelector('[data-logout]')?.addEventListener('click', () => {
      if (typeof window.__kanopiLogout === 'function') window.__kanopiLogout();
    });
  }
  render();
  window.addEventListener('hashchange', render);
  return () => {
    window.removeEventListener('hashchange', render);
    container.innerHTML = '';
  };
}
