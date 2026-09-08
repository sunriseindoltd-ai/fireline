// @ts-nocheck
// Left rail on the home page: portfolio stats, volume estimate, project list.
import { config, estimateVolumes } from '../../config.js';

const kt = (t) => t >= 1000 ? (t / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' kt' : Math.round(t).toLocaleString('id-ID') + ' t';
const n = (x) => x.toLocaleString('id-ID');

export function mount(container, store, ov, roll) {
  const mappedArea = roll?.mappedArea || 0;
  const eudrChains = roll?.eudrChains || [];
  const portComply = eudrChains.length ? Math.round(eudrChains.reduce((s, c) => s + c.comply, 0) / eudrChains.reduce((s, c) => s + c.comply + c.noncomply, 0) * 100) : null;
  const a = ov.getAggregates();
  const projects = ov.getProjects().slice().sort((x, y) => y.mill_count - x.mill_count);
  const vol = estimateVolumes(mappedArea || 0);

  container.innerHTML = `
    <div class="dp-eyebrow">Portfolio</div>
    <h2 class="dp-h1">Basis pasok</h2>
    <div class="dp-note">${n(a.project_count)} rantai pasok</div>
    <div class="stat-grid">
      <div class="stat"><div class="stat-n">${n(a.refinery_count)}</div><div class="stat-l">Refinery/KCP</div></div>
      <div class="stat"><div class="stat-n">${n(a.mill_count)}</div><div class="stat-l">Pabrik</div></div>
      <div class="stat"><div class="stat-n">${n(a.available_mills)}</div><div class="stat-l">Pabrik terpetakan</div></div>
      <div class="stat"><div class="stat-n">${n(a.project_count)}</div><div class="stat-l">Rantai</div></div>
    </div>

    ${portComply != null ? `<h4>Kesiapan EUDR</h4>
    <div class="port-eudr">
      <div class="port-top"><span class="port-pct" style="color:${portComply >= 85 ? 'var(--ok)' : portComply >= 60 ? 'var(--warn)' : 'var(--bad)'}">${portComply}%</span>
        <span class="src">comply · ${eudrChains.length} rantai dianalisis</span></div>
      ${eudrChains.map(c => `<div class="port-row" data-go="${c.id}">
        <span class="port-name">${c.name}</span>
        <span class="port-bar"><i style="width:${c.pct}%;background:${c.pct >= 85 ? 'var(--ok)' : c.pct >= 60 ? 'var(--warn)' : 'var(--bad)'}"></i></span>
        <span class="port-v">${c.pct}%</span></div>`).join('')}
    </div>` : ''}

    <h4>Estimasi volume tahunan</h4>
    <div class="dp-note small">Dari ${n(Math.round(mappedArea || 0))} ha plot terpetakan · ${config.volume.ffbPerHaYear} t TBS/ha/th</div>
    <ul class="vol">
      <li><span>TBS</span><b>${kt(vol.ffb)}</b></li>
      <li><span>CPO</span><b>${kt(vol.cpo)}</b></li>
      <li><span>PKO</span><b>${kt(vol.pko)}</b></li>
      <li><span>PKE</span><b>${kt(vol.pke)}</b></li>
    </ul>
    <div class="dp-hint small">Volume naik seiring plot rantai lain dilampirkan. Asumsi laju ada di config.</div>

    <h4>Rantai pasok</h4>
    <ul class="proj-list">
      ${projects.map(p => `
        <li class="${p.has_detail ? 'has' : 'soon'}" data-go="${p.id}">
          <span class="pl-name">${p.name}</span>
          <span class="pl-meta">${n(p.mill_count)} pabrik · ${n(p.refinery_count)} ref${p.has_detail ? ' · <em>buka</em>' : ''}</span>
        </li>`).join('')}
    </ul>`;

  container.querySelectorAll('[data-go]').forEach(li => li.addEventListener('click', () => store.go && store.go(li.dataset.go)));
  return function destroy() { container.innerHTML = ''; };
}
