// @ts-nocheck
// src/views/DetailPanel.js
// Default: project summary (the hero). Mill selected: rollup + certainty ladder.
// Plot selected: parcel attributes. All from aggregates/nodes — no geometry needed
// except the plot record, which the map already loaded.
import { config } from '../config.js';

const ha = (n) => n == null ? '—' : Math.round(n).toLocaleString('en-US') + ' ha';
const num = (n) => n == null ? '—' : n.toLocaleString('en-US');

export function mount(container, store, adapter) {
  const agg = adapter.getAggregates();
  let plotIndex = null;   // built lazily from the selected mill's loaded plots

  const off = store.subscribe(async (s) => { container.innerHTML = await render(s); wire(s); });

  function bar(parts) { // stacked proportion bar; parts: [{value,color,label}]
    const total = parts.reduce((a, p) => a + p.value, 0) || 1;
    const seg = parts.filter(p => p.value > 0).map(p =>
      `<span class="seg-fill" style="width:${(p.value / total * 100).toFixed(1)}%;background:${p.color}" title="${p.label}: ${num(p.value)}"></span>`).join('');
    return `<div class="bar">${seg}</div>`;
  }

  function certaintyLadder(byTrace) {
    const v = byTrace.village?.count || 0, b = byTrace.mill_buffer?.count || 0;
    const vh = byTrace.village?.area_ha || 0, bh = byTrace.mill_buffer?.area_ha || 0;
    return `
      <div class="ladder">
        <div class="ladder-row"><span class="dot" style="background:${config.color.village}"></span>
          <span class="ladder-k">Traced to village <em>TTV</em></span><span class="ladder-v">${num(v)} · ${ha(vh)}</span></div>
        <div class="ladder-row"><span class="dot" style="background:${config.color.millBuffer}"></span>
          <span class="ladder-k">Mill buffer only <em>TTM</em></span><span class="ladder-v">${num(b)} · ${ha(bh)}</span></div>
        ${bar([{ value: vh, color: config.color.village, label: 'TTV' }, { value: bh, color: config.color.millBuffer, label: 'TTM' }])}
      </div>`;
  }

  function projectSummary() {
    const t = agg.totals;
    const eudrYes = t.eudr?.YES || 0, eudrNo = (t.eudr?.NO || 0) + (t.eudr?.UNKNOWN || 0);
    const types = Object.entries(config.plotTypes).map(([k, m]) =>
      ({ value: t.by_type[k]?.count || 0, color: m.color, label: m.label }));
    return `
      <div class="dp-eyebrow">Project</div>
      <h2 class="dp-h1">${agg.facility.name}</h2>
      <div class="dp-note">Refinery / KCP · supply base overview</div>
      <div class="stat-grid">
        <div class="stat"><div class="stat-n">${num(agg.mill_count)}</div><div class="stat-l">Mills</div></div>
        <div class="stat"><div class="stat-n">${num(t.plot_count)}</div><div class="stat-l">Plots</div></div>
        <div class="stat"><div class="stat-n">${ha(t.area_ha)}</div><div class="stat-l">Mapped area</div></div>
        <div class="stat"><div class="stat-n">${num(agg.village_count)}</div><div class="stat-l">Villages</div></div>
      </div>
      <h4>Traceability certainty</h4>
      ${certaintyLadder(t.by_traceability)}
      <h4>Plot composition</h4>
      ${bar(types)}
      <ul class="key">${Object.entries(config.plotTypes).map(([k, m]) =>
        `<li><span class="dot" style="background:${m.color}"></span>${m.label} <em>${num(t.by_type[k]?.count || 0)}</em></li>`).join('')}</ul>
      <h4>EUDR status</h4>
      ${bar([{ value: eudrYes, color: config.color.village, label: 'Compliant' }, { value: eudrNo, color: config.color.risk, label: 'Flagged' }])}
      <div class="dp-hint">Pick a mill on the map or in the flow to drill in.</div>`;
  }

  function millDetail(id) {
    const m = agg.by_mill[id]; const node = adapter.getNode('mill', id);
    if (!m) return `<div class="dp-hint">Unknown mill.</div>`;
    const grp = m.group_id && adapter.getNode('group', m.group_id);
    const co = m.company_id && adapter.getNode('company', m.company_id);
    const eudrYes = m.eudr?.YES || 0, eudrNo = (m.eudr?.NO || 0) + (m.eudr?.UNKNOWN || 0);
    const status = node?.status === 'retired' ? `<span class="chip warn">Retired</span>` : `<span class="chip">Active</span>`;
    const approx = node?.geom_source && node.geom_source !== 'uml_list'
      ? `<span class="chip soft" title="Mill point is approximate (${node.geom_source})">approx. location</span>` : '';
    return `
      <button class="dp-back" data-back>← Project overview</button>
      <div class="dp-eyebrow">Mill ${status}${approx}</div>
      <h2 class="dp-h1">${m.name}</h2>
      <div class="dp-mono">${node?.uml_id || ''}</div>
      <ul class="meta">
        ${co ? `<li><span>Company</span>${co.name}</li>` : ''}
        ${grp ? `<li><span>Group</span>${grp.name}</li>` : ''}
        <li><span>Refinery/KCP</span>${agg.facility.name}</li>
      </ul>
      <div class="stat-grid two">
        <div class="stat"><div class="stat-n">${num(m.plot_count)}</div><div class="stat-l">Plots</div></div>
        <div class="stat"><div class="stat-n">${ha(m.area_ha)}</div><div class="stat-l">Area</div></div>
      </div>
      <h4>Traceability certainty</h4>
      ${certaintyLadder(m.by_traceability)}
      <h4>EUDR status</h4>
      ${bar([{ value: eudrYes, color: config.color.village, label: 'Compliant' }, { value: eudrNo, color: config.color.risk, label: 'Flagged' }])}
      <div class="key-inline"><b>${num(eudrYes)}</b> EUDR-compliant · <b>${num(eudrNo)}</b> flagged <span class="src">(from attributes)</span></div>
      <div class="dp-hint">Plots for this mill are shown on the map. Click one for parcel detail.</div>`;
  }

  function plotDetail(id) {
    const p = adapter.getNode('plot', id) || findPlot(id);
    if (!p) return `<div class="dp-hint">Loading parcel…</div>`;
    const lvl = config.traceabilityLevels[p.traceability_level];
    const pt = config.plotTypes[p.plot_type];
    const eudrOk = p.eudr_comply === 'YES';
    return `
      <button class="dp-back" data-back-mill="${p.mill_id}">← ${adapter.getNode('mill', p.mill_id)?.name || 'Mill'}</button>
      <div class="dp-eyebrow">Plot
        <span class="chip" style="background:${pt?.color}1a;color:${pt?.color}">${pt?.label || p.plot_type}</span>
        <span class="chip" style="background:${lvl?.color}1a;color:${lvl?.color}">${lvl?.short || ''}</span></div>
      <div class="dp-mono lg">${p.id}</div>
      <ul class="meta">
        <li><span>Type</span>${pt?.label || p.plot_type}</li>
        <li><span>Traceability</span>${lvl?.label || p.traceability_level}</li>
        <li><span>Area</span>${p.area_ha} ha</li>
        ${adminLine(p)}
        <li><span>Village (BPS)</span><span class="mono">${p.village_id_bps || '—'}</span></li>
        <li><span>EUDR</span><span class="chip ${eudrOk ? 'ok' : 'risk'}">${p.eudr_comply || '—'}</span></li>
        ${p.risk_mitigation ? `<li><span>Risk note</span>${p.risk_mitigation}</li>` : ''}
        <li><span>Farmer group</span><span class="mono">${p.node_id || '—'}</span></li>
      </ul>
      ${eudrAnalysis(p)}
      ${p.excluded ? `<div class="td-flag">⊘ Taken down <span class="src">(${p.exclude_reason || 'manual'})</span>${import.meta.env.DEV ? ' <button class="dp-restore" data-restore-plot>Restore</button> <button class="dp-restore" data-open-case>Open case</button>' : ''}</div>`
        : (import.meta.env.DEV ? `<button class="btn ghost dp-takedown" data-takedown-plot>⊘ Take down this plot</button>` : '')}
      <div class="dp-hint">Fields come directly from the plot attributes — no online screening.</div>`;
  }

  function findPlot(id) {  // search the cached plots of the loaded mill
    if (!plotIndex) return null;
    return plotIndex.get(id) || null;
  }

  async function render(s) {
    // keep a plot index for the currently relevant mill for fast plot detail
    if (s.selection?.type === 'plot') {
      const millId = adapter.getNode('plot', s.selection.id)?.mill_id;
    }
    if (!s.selection) return projectSummary();
    if (s.selection.type === 'mill') { await cacheMillPlots(s.selection.id); return millDetail(s.selection.id); }
    if (s.selection.type === 'plot') return plotDetail(s.selection.id);
    return projectSummary();
  }

  async function cacheMillPlots(millId) {
    const fc = await adapter.getPlotsForMill(millId);
    plotIndex = new Map(fc.features.map(f => [f.properties.id, f.properties]));
  }

  function wire(s) {
    container.querySelector('[data-back]')?.addEventListener('click', () => store.set({ selection: null }));
    const bm = container.querySelector('[data-back-mill]');
    bm?.addEventListener('click', () => store.set({ selection: { type: 'mill', id: bm.dataset.backMill } }));
    const td = container.querySelector('[data-takedown-plot]'), rp = container.querySelector('[data-restore-plot]');
    const plotId = s.selection?.type === 'plot' ? s.selection.id : null;
    const proj = plotId && findPlot(plotId)?.project;
    async function exc(restore) {
      if (!proj || !plotId) return;
      await fetch('/api/manage/exclude', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(restore ? { project: proj, plotIds: [plotId], restore: true } : { project: proj, plotIds: [plotId] }) });
      location.reload();
    }
    td?.addEventListener('click', () => { if (confirm('Take down this plot? (reversible)')) exc(false); });
    rp?.addEventListener('click', () => exc(true));
    container.querySelector('[data-open-case]')?.addEventListener('click', async () => {
      if (!proj || !plotId) return;
      const p2 = findPlot(plotId) || {};
      await fetch('/api/cases/save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: proj, item: { title: `Taken-down plot ${plotId}`, status: 'open',
          reason: p2.exclude_reason || 'manual', plot_ids: [plotId], note: '' } }) });
      location.hash = `#/project/${proj}/cases`;
    });
  }

  return function destroy() { off(); container.innerHTML = ''; };
}

// ---- EUDR analysis rendering (shows only when analyzed attributes are present) ----
const _n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const _ha = (v) => _n(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
const FOREST_FN = { HP: 'Production (HP)', HPK: 'Convertible production (HPK)', HPT: 'Limited production (HPT)', HL: 'Protected forest (HL)' };

function adminLine(p) {
  const parts = [p.District || p.SubDistric, p.Province].filter(Boolean);
  return parts.length ? `<li><span>Location</span>${parts.join(', ')}</li>` : '';
}

function eudrAnalysis(p) {
  const hasAnalysis = ['Risk_Level', 'Def_23', 'HP', 'HL', 'HPK', 'HPT'].some(k => k in p);
  if (!hasAnalysis) return '';
  // deforestation by year
  const years = [21, 22, 23, 24, 25].map(y => ['20' + y, _n(p['Def_' + y])]).filter(([, v]) => v > 0);
  const defTotal = years.reduce((s, [, v]) => s + v, 0);
  // legal forest function overlaps
  const fn = Object.entries(FOREST_FN).map(([k, label]) => [label, _n(p[k]), k]).filter(([, v]) => v > 0);
  const hl = _n(p.HL);
  // social forest
  const social = _n(p.Forest) + _n(p.Forestry);
  const risk = (p.Risk_Level || '').trim();
  const riskCls = /high/i.test(risk) ? 'risk' : /medium/i.test(risk) ? 'warn' : /low/i.test(risk) ? 'ok' : '';

  let rows = '';
  if (risk) rows += `<li><span>Risk level</span><span class="chip ${riskCls}">${risk}</span></li>`;
  rows += `<li><span>Deforestation (post-2020)</span>${defTotal > 0
    ? `<b class="hot">${_ha(defTotal)} ha</b> <span class="src">${years.map(([y]) => y).join(', ')}</span>`
    : '<span class="chip ok">none</span>'}</li>`;
  if (fn.length) rows += `<li><span>Legal forest function</span>${fn.map(([label, v, k]) =>
    `<span class="chip ${k === 'HL' ? 'risk' : 'warn'}">${label.split(' (')[1]?.replace(')', '') || label}: ${_ha(v)} ha</span>`).join(' ')}</li>`;
  else rows += `<li><span>Legal forest function</span><span class="chip ok">no overlap</span></li>`;
  if (social > 0) rows += `<li><span>Social/customary forest</span><span class="chip warn">${_ha(social)} ha</span></li>`;
  if (p.TIPE_HAK && String(p.TIPE_HAK).trim()) rows += `<li><span>Tenure</span>${p.TIPE_HAK}</li>`;

  return `<h4>EUDR analysis</h4><ul class="meta tight">${rows}</ul>`;
}
