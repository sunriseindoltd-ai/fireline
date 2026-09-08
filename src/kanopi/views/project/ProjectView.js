// @ts-nocheck
// src/views/project/ProjectView.js — the per-supplier page (full detail for BNS).
import { config } from '../../config.js';
import { FileDataAdapter } from '../../data/FileDataAdapter.js';
import { createStore } from '../../state/store.js';
import * as FilterPanel from '../FilterPanel.js';
import * as MillSearch from '../MillSearch.js';
import * as Legend from '../Legend.js';
import * as MapView from '../MapView.js';
import * as SankeyView from '../SankeyView.js';
import * as DetailPanel from '../DetailPanel.js';

export async function mount(root, ctx) {
  const projectId = ctx.projectId;
  // registry entry: has_detail + mill count for the onboarding state
  let reg = [];
  try { reg = await (await fetch(`${config.dataBaseUrl}/${config.overview.projects}`)).json(); } catch {}
  const entry = reg.find(p => p.id === projectId);
  const hasDetail = !!entry?.has_detail;
  const manifest = hasDetail ? config.projectFiles(projectId) : null;

  if (!manifest) {
    root.className = 'layout-empty';
    root.innerHTML = `<div class="empty-state">
      <div class="dp-eyebrow">${entry?.name || projectId}</div>
      <h2 class="dp-h1">Belum ada data plot</h2>
      <p>Rantai ini ada di portfolio tingkat fasilitas${entry ? ` — <b>${entry.mill_count}</b> pabrik, <b>${entry.refinery_count}</b> refinery/KCP` : ''}.
      Unggah GeoJSON plot teranalisis untuk mengisi peta, alur, dan detail EUDR.</p>
      <div class="empty-actions">
        ${import.meta.env.DEV ? `<button class="btn" data-upload>↑ Unggah data ${projectId}</button>` : ''}
        <button class="btn ghost" data-home>← Kembali ke portfolio</button>
      </div></div>`;
    root.querySelector('[data-home]').addEventListener('click', () => ctx.router.go('#/'));
    const ub = root.querySelector('[data-upload]');
    if (ub) ub.addEventListener('click', async () => {
      const { openUploadModal } = await import('../UploadModal.js');
      openUploadModal(projectId);
    });
    return () => { root.innerHTML = ''; };
  }

  root.className = 'layout-project';
  root.innerHTML = `
    <aside id="rail" class="rail">
      <div id="millsearch"></div><div id="filters"></div><div id="legend"></div>
    </aside>
    <main id="map"></main>
    <section id="sankey"></section>
    <aside id="detail"></aside>`;

  const adapter = new FileDataAdapter(config, manifest);
  try { await adapter.load(); }
  catch (err) { root.querySelector('#detail').innerHTML = `<div class="fatal"><b>Couldn't load ${projectId}.</b><br>${err.message}</div>`; return () => {}; }

  const store = createStore();
  const ds = [
    MillSearch.mount(root.querySelector('#millsearch'), store, adapter),
    FilterPanel.mount(root.querySelector('#filters'), store, adapter),
    Legend.mount(root.querySelector('#legend'), store, adapter),
    MapView.mount(root.querySelector('#map'), store, adapter),
    SankeyView.mount(root.querySelector('#sankey'), store, adapter),
    DetailPanel.mount(root.querySelector('#detail'), store, adapter),
  ];
  return () => ds.forEach(d => d && d());
}
