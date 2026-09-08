// @ts-nocheck
// src/views/CoverageModal.js — per-chain data coverage + delete (dev).
// Shows every mill from the master list and which ones have plots, so you can see
// "12 of 54 mills mapped". Lets you delete a mill's data or the whole project.
import { config } from '../config.js';

export async function openCoverageModal(defaultProject) {
  let projects = [];
  try { projects = await (await fetch(`${config.dataBaseUrl}/${config.overview.projects}`)).json(); } catch {}
  projects.sort((a, b) => a.name.localeCompare(b.name));
  let allMills = { features: [] };
  try { allMills = await (await fetch(`${config.dataBaseUrl}/${config.overview.mills}`)).json(); } catch {}

  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.innerHTML = `
    <div class="modal wide">
      <div class="modal-head"><h3>Data coverage</h3><button class="modal-x">&times;</button></div>
      <div class="modal-body">
        <label class="fld">Supply chain
          <select class="cv-project">${projects.map(p => `<option value="${p.id}" ${p.id === defaultProject ? 'selected' : ''}>${p.name}</option>`).join('')}</select></label>
        <div class="cv-summary"></div>
        <div class="cv-body"><div class="src">Loading…</div></div>
      </div>
      <div class="modal-foot">
        <button class="btn ghost cv-recompute" title="Re-derive every plot's area from Hectarage/ha, or from the polygon when absent">Recompute areas</button>
        <button class="btn ghost cv-del-project">Delete entire chain…</button>
        <button class="btn ghost modal-cancel">Close</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const q = s => ov.querySelector(s);
  const close = () => ov.remove();
  q('.modal-x').onclick = close; q('.modal-cancel').onclick = close;
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  const sel = q('.cv-project');
  sel.addEventListener('change', () => load(sel.value));

  const nf = n => (n || 0).toLocaleString('en-US');
  async function load(project) {
    q('.cv-body').innerHTML = '<div class="src">Loading…</div>';
    const master = allMills.features.filter(f => f.properties.project === project);
    let agg = { by_mill: {}, totals: { plot_count: 0, area_ha: 0 } };
    try { agg = await (await fetch(`${config.dataBaseUrl}/projects/${project}/analysis/aggregates.json`)).json(); } catch {}
    const rows = master.map(f => {
      const mid = `mill-${f.properties.uml_id}`;
      const m = agg.by_mill[mid];
      return { mid, name: f.properties.name, uml: f.properties.uml_id, mapped: !!m,
        plots: m?.plot_count || 0, area: m?.area_ha || 0 };
    }).sort((a, b) => b.plots - a.plots || a.name.localeCompare(b.name));
    // also include mapped mills not in the master list (e.g. uploaded to this chain)
    const known = new Set(master.map(f => `mill-${f.properties.uml_id}`));
    for (const [mid, m] of Object.entries(agg.by_mill)) if (!known.has(mid))
      rows.push({ mid, name: m.name || mid, uml: m.uml_id, mapped: true, plots: m.plot_count, area: m.area_ha, extra: true });

    const mappedCount = rows.filter(r => r.mapped).length;
    const pct = rows.length ? Math.round(mappedCount / rows.length * 100) : 0;
    q('.cv-summary').innerHTML = `
      <div class="cv-bar"><div class="cv-fill" style="width:${pct}%"></div></div>
      <div class="cv-sum-line"><b>${mappedCount}</b> of <b>${rows.length}</b> mills mapped (${pct}%) ·
        <b>${nf(agg.totals.plot_count)}</b> plots · <b>${nf(Math.round(agg.totals.area_ha))}</b> ha</div>`;
    q('.cv-body').innerHTML = `<ul class="cv-list">${rows.map(r => `
      <li class="${r.mapped ? 'on' : 'off'}">
        <span class="cv-dot"></span>
        <span class="cv-name">${r.name}${r.extra ? ' <em>(uploaded)</em>' : ''}<span class="src"> ${r.uml || ''}</span></span>
        <span class="cv-meta">${r.mapped ? `${nf(r.plots)} plots · ${nf(Math.round(r.area))} ha` : 'no data'}</span>
        ${r.mapped ? `<button class="cv-del" data-mid="${r.mid}" data-name="${r.name}" title="Delete this mill's plots">🗑</button>` : ''}
      </li>`).join('')}</ul>`;
    q('.cv-body').querySelectorAll('.cv-del').forEach(b => b.onclick = () => delMill(project, b.dataset.mid, b.dataset.name));
  }

  async function delMill(project, mid, name) {
    if (!confirm(`Delete all plots for "${name}" in ${project}? This can't be undone.`)) return;
    const r = await (await fetch('/api/manage/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, mill: mid }) })).json();
    if (r.ok) load(project); else alert('Delete failed: ' + (r.error || ''));
  }
  q('.cv-recompute').onclick = async () => {
    const project = sel.value;
    const btn = q('.cv-recompute');
    if (!confirm(`Recompute every plot's area in ${project}?\n\nAreas are taken from a field named "Hectarage" or "ha"; where that's missing (or wildly disagrees with the polygon) the true polygon area is used instead.`)) return;
    btn.disabled = true; btn.textContent = 'Recomputing…';
    try {
      const r = await (await fetch('/api/manage/recompute-areas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project }) })).json();
      if (!r.ok) throw new Error(r.error || 'failed');
      alert(`Areas recomputed for ${project}\n\n` +
        `${nf(r.plots_updated)} plots updated\n` +
        `Total active area: ${nf(Math.round(r.active_area_ha))} ha\n` +
        `Source: ${r.area_source}` +
        (r.area_ratio_median ? `\nDeclared/polygon ratio: ${r.area_ratio_median}x` : ''));
      load(project);
    } catch (e) { alert('Recompute failed: ' + e.message); }
    finally { btn.disabled = false; btn.textContent = 'Recompute areas'; }
  };
  q('.cv-del-project').onclick = async () => {
    const project = sel.value;
    if (!confirm(`Delete the ENTIRE "${project}" chain data? This removes all its plots and can't be undone.`)) return;
    const r = await (await fetch('/api/manage/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project }) })).json();
    if (r.ok) { alert(`${project} deleted.`); location.hash = '#/'; location.reload(); } else alert('Delete failed: ' + (r.error || ''));
  };

  load(sel.value);
}
