// @ts-nocheck
// src/views/report/ReportView.js — printable EUDR report per chain (print → PDF).
import maplibregl from 'maplibre-gl';
import { config } from '../../config.js';
import { donut, hbars, stackedBar, columns, fmt, fmt1 } from '../dashboard/charts.js';
const C = config.color;

const ACTIONS = {
  A: ['Safe for EUDR Submission', 'No material deforestation, legality or forest-function conflict at plot level.', 'Include in the EUDR due-diligence batch. Retain geolocation & evidence; record-keeping only.'],
  B: ['Safe with Continuous Monitoring', 'Eligible now, but near a risk threshold (proximity to change, minor overlap).', 'Submit while enrolling in periodic satellite monitoring (quarterly RADD/GLAD alerts).'],
  C: ['Submit with enhanced verification', 'Eligible for the DDS batch, but spatial data alone is not conclusive.', 'Include in submission and attach field/desk verification (imagery, permit & tenure).'],
  D: ['Not Yet Suitable for Submission', 'Outstanding data gaps or unresolved status.', 'Complete boundary, tenure and land-use documentation; re-run screening once closed.'],
  E: ['Requires Significant Mitigation', 'Confirmed material issues (post-cut-off change and/or restricted forest overlap).', 'Segment affected sub-areas, remediate, engage suppliers, document a corrective plan.'],
  F: ['Not Suitable for Submission', 'High-severity conflict (clear post-cut-off deforestation or protected-forest overlap).', 'Exclude from the EUDR supply base pending resolution; escalate for engagement/legal review.'],
};

export async function mount(root, ctx) {
  const id = ctx.projectId;
  let reg = [];
  try { reg = await (await fetch(`${config.dataBaseUrl}/${config.overview.projects}`)).json(); } catch {}
  const entry = reg.find(p => p.id === id);
  if (!entry?.has_detail) { const { mount: pm } = await import('../project/ProjectView.js'); return pm(root, ctx); }

  const mf = config.projectFiles(id);
  const agg = await (await fetch(`${config.dataBaseUrl}/${mf.aggregates}`)).json();
  const j = async (u) => { try { return await (await fetch(`${config.dataBaseUrl}/${u}`)).json(); } catch { return { type: 'FeatureCollection', features: [] }; } };
  const [millsFC, areasFC] = await Promise.all([j(mf.mills), j(mf.areas)]);
  const t = agg.totals, e = agg.eudr || {}, g = e.geography || {};
  const comp = e.compliance || { YES: { plots: 0, area_ha: 0 }, NO: { plots: 0, area_ha: 0 } };
  const totalPlots = comp.YES.plots + comp.NO.plots;
  const complyPct = totalPlots ? Math.round(comp.YES.plots / totalPlots * 100) : null;
  const rc = e.risk_category || {};
  const readyPlots = (rc.A?.plots || 0) + (rc.B?.plots || 0) + (rc.C?.plots || 0);
  const readyArea = (rc.A?.area_ha || 0) + (rc.B?.area_ha || 0) + (rc.C?.area_ha || 0);
  const readyPct = t.plot_count ? Math.round(readyPlots / t.plot_count * 100) : 0;
  const typeArea = (k) => t.by_type?.[k]?.area_ha || 0;
  const now = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  root.className = 'shell-scroll';
  root.innerHTML = `
   <div class="report">
    <div class="rpt-actions no-print">
      <button class="btn" onclick="window.print()">Print / Save as PDF</button>
      ${import.meta.env.DEV ? `<button class="btn ghost" data-export>Export data (TRACES-ready)</button>` : ''}
      <span class="rpt-exp-status src"></span>
    </div>

    <header class="rpt-cover">
      <div class="rpt-brand"><span class="mark"></span> KANOPI</div>
      <div class="rpt-kicker">EUDR Solution Report</div>
      <h1 class="rpt-title">${entry.name}<br>Supply Chain</h1>
      <div class="rpt-sub">Oil Palm Plot Inventory & EUDR Readiness Assessment</div>
      <div class="rpt-date">${now}</div>
    </header>

    <section class="rpt-sec">
      <h2>Overview — ${entry.name}</h2>
      <p>This report consolidates <b>${fmt(t.plot_count)} mapped plots</b> covering
      <b>${fmt1(t.area_ha)} ha</b> across <b>${agg.mill_count} sourcing mills</b>${
        g.provinces?.length ? ` and <b>${g.province_count} province(s)</b> (${g.provinces.join(', ')})` : ''}.
      ${e.has_analysis ? 'Each plot carries a plot-level EUDR compliance status and a graded risk-mitigation category.'
        : 'Plot-level EUDR screening has not been attached to this chain yet, so this report covers the mapped inventory only.'}</p>
      <div class="rpt-cards">
        ${sumCard('Company plots', fmt(compType(t, 'company')), 'plots')}
        ${sumCard('Scheme smallholder', fmt(compType(t, 'scheme_smallholder')), 'plots')}
        ${sumCard('Independent smallholder', fmt(compType(t, 'independent_smallholder')), 'plots')}
        ${sumCard('Total mapped area', fmt1(t.area_ha), 'ha', 'accent')}
        ${e.has_analysis ? sumCard('Deforestation (post cut-off)', fmt1(e.deforestation?.total_ha || 0), 'ha', 'bad') : ''}
        ${e.has_analysis ? sumCard('Legal forest function', fmt1(ffTotal(e)), 'ha', 'warn') : ''}
      </div>
      <div class="rpt-2col">
        <div>${donut(Object.entries(t.by_type || {}).map(([k, v]) => ({ label: config.plotTypes[k]?.label || k, value: v.area_ha, color: config.plotTypes[k]?.color || '#bbb' })), { center: { top: fmt(Math.round(t.area_ha / 1000)) + 'k', bottom: 'ha' } })}</div>
        <div class="rpt-note">The mapped supply base is composed of Company ${fmt1(typeArea('company'))} ha,
          Scheme Smallholders ${fmt1(typeArea('scheme_smallholder'))} ha and Independent Smallholders ${fmt1(typeArea('independent_smallholder'))} ha.
          Smallholder-dominated segments typically require more intensive traceability and monitoring.</div>
      </div>
    </section>

    <section class="rpt-sec">
      <h2>Supply chain information</h2>
      <div class="rpt-stats5" style="grid-template-columns:repeat(${2 + [g.entity_count, g.village_count, g.district_count, g.province_count].filter(Boolean).length},1fr)">
        ${stat(agg.mill_count, 'Source mills')}${stat(fmt(t.plot_count), 'Mapped plots')}
        ${g.entity_count ? stat(g.entity_count, 'Supplier entities') : ''}
        ${g.village_count ? stat(g.village_count, 'Supplier villages') : ''}
        ${g.district_count ? stat(g.district_count, 'Districts') : ''}
        ${g.province_count ? stat(g.province_count, 'Provinces') : ''}
      </div>
    </section>

    <section class="rpt-sec">
      <h2>Supply base coverage</h2>
      <p>Geographic extent of the mapped supply base — every sourcing mill in this chain and,
      where mapped, its traceability area.</p>
      <div class="rpt-map-wrap"><div class="rpt-map-live"></div><img class="rpt-map-print" alt="Supply base coverage map"></div>
      <div class="rpt-note rpt-map-cap">
        <span class="mapkey"><i style="background:${C.mill}"></i> Sourcing mill</span>
        <span class="mapkey"><i style="background:${C.village}"></i> Traced to village (TTV)</span>
        <span class="mapkey"><i style="background:${C.millBuffer}"></i> Mill buffer (TTM)</span>
        <span class="src">Imagery © Esri</span>
      </div>
    </section>

    ${complyPct != null ? `<section class="rpt-sec">
      <h2>EUDR-ready plot assessment</h2>
      <p>Of <b>${fmt(comp.YES.plots + comp.NO.plots)}</b> screened plots,
        <b>${fmt(comp.YES.plots)} (${complyPct}%)</b> are <b>Comply</b> and
        <b>${fmt(comp.NO.plots)} (${100 - complyPct}%)</b> <b>Non-Comply</b> at plot level.</p>
      <div class="rpt-2col cmp">
        <div class="donut-wrap">${donut([{ label: 'Comply', value: comp.YES.plots, color: C.comply }, { label: 'Non-comply', value: comp.NO.plots, color: C.noncomply }], { center: { top: complyPct + '%', bottom: 'comply' } })}
          <div class="donut-legend"><div><i style="background:${C.comply}"></i> Comply <b>${fmt(comp.YES.plots)} plots</b></div>
            <div><i style="background:${C.noncomply}"></i> Non-comply <b>${fmt(comp.NO.plots)} plots</b></div></div></div>
        <div>${complianceByType(e)}</div>
      </div>
      ${e.has_analysis ? `<h4>Deforestation (post EUDR cut-off)</h4>
        ${(e.deforestation?.total_ha || 0) > 0
          ? `${columns(Object.entries(e.deforestation?.by_year || {}).map(([y, v]) => ({ label: y, value: v })), { color: C.high, unit: ' ha' })}
             <div class="rpt-note">Total detected change across mapped villages: <b>${fmt1(e.deforestation.total_ha)} ha</b>.</div>`
          : `<div class="rpt-clean">✓ No post-cut-off deforestation detected across the mapped villages of this chain.</div>`}` : ''}
    </section>` : ''}

    ${e.has_analysis && ffTotal(e) > 0 ? `<section class="rpt-sec">
      <h2>Legal forest function & social forest</h2>
      ${hbars([['HL', 'Protected forest (HL)', C.high], ['HPT', 'Limited production (HPT)', C.medium], ['HP', 'Production (HP)', '#c9a227'], ['HPK', 'Convertible production (HPK)', '#b7c34a']]
        .map(([k, label, color]) => ({ label, value: e.forest_function[k] || 0, color })).filter(r => r.value > 0), { fmt: v => fmt1(v) + ' ha' })}
      <div class="rpt-note">Overlap with state forest zones totals <b>${fmt1(ffTotal(e))} ha</b>,
        with Protected Forest (HL) at <b>${fmt1(e.forest_function.HL || 0)} ha</b> — the highest-priority class for due diligence.
        Social/customary forest overlap: <b>${fmt1(e.social_forest_ha || 0)} ha</b>.</div>
    </section>` : ''}

    ${e.has_analysis && anyCat(rc) ? `<section class="rpt-sec">
      <h2>Risk mitigation — action plan</h2>
      <p><b>${readyPct}% of plots</b> (${fmt1(readyArea)} ha) are submission-ready (A–C). D still has data gaps; E–F need mitigation or exclusion.</p>
      <table class="rpt-table"><thead><tr><th>#</th><th>Category & meaning</th><th>Volume</th><th>Recommended action</th></tr></thead><tbody>
        ${'ABCDEF'.split('').map(c => rc[c]?.plots ? `<tr>
          <td><span class="cat-badge" style="background:${C.riskCat[c]}">${c}</span></td>
          <td><b>${ACTIONS[c][0]}</b><div class="src2">${ACTIONS[c][1]}</div></td>
          <td class="nowrap">${fmt(rc[c].plots)} plots<br><span class="src">${fmt1(rc[c].area_ha)} ha</span></td>
          <td class="src2">${ACTIONS[c][2]}</td></tr>` : '').join('')}
      </tbody></table>
    </section>` : ''}

    <footer class="rpt-foot">Kanopi · EUDR Solution Report · ${entry.name} · generated ${now}</footer>
   </div>`;

  // ---- coverage map: live on screen, captured to an <img> so it prints reliably ----
  const mapEl = root.querySelector('.rpt-map-live');
  const printImg = root.querySelector('.rpt-map-print');
  const rmap = new maplibregl.Map({
    container: mapEl, style: config.map.basemaps.hybrid, center: config.map.center, zoom: 4,
    interactive: false, attributionControl: false, preserveDrawingBuffer: true,
  });
  rmap.on('load', () => {
    if (areasFC.features?.length) {
      rmap.addSource('rareas', { type: 'geojson', data: areasFC });
      rmap.addLayer({ id: 'rareas-f', type: 'fill', source: 'rareas', paint: {
        'fill-color': ['match', ['get', 'traceability_level'], 'village', C.village, C.millBuffer], 'fill-opacity': 0.22 } });
      rmap.addLayer({ id: 'rareas-l', type: 'line', source: 'rareas', paint: {
        'line-color': ['match', ['get', 'traceability_level'], 'village', C.village, C.millBuffer], 'line-width': 1 } });
    }
    const pts = (millsFC.features || []).filter(f => f.geometry);
    rmap.addSource('rmills', { type: 'geojson', data: { type: 'FeatureCollection', features: pts } });
    rmap.addLayer({ id: 'rmills', type: 'circle', source: 'rmills', paint: {
      'circle-radius': 4, 'circle-color': C.mill, 'circle-stroke-width': 1.2, 'circle-stroke-color': '#12241b' } });
    const b = new maplibregl.LngLatBounds(); let any = false;
    const ext = (g) => { const w = (a) => Array.isArray(a) && typeof a[0] === 'number' ? (b.extend(a), any = true) : a?.forEach?.(w); if (g) w(g.coordinates); };
    pts.forEach(f => ext(f.geometry)); (areasFC.features || []).forEach(f => ext(f.geometry));
    if (any) rmap.fitBounds(b, { padding: 36, maxZoom: 9, duration: 0 });
  });
  rmap.on('idle', () => { try { printImg.src = rmap.getCanvas().toDataURL('image/png'); } catch {} });

  const exBtn = root.querySelector('[data-export]');
  if (exBtn) exBtn.addEventListener('click', async () => {
    const st = root.querySelector('.rpt-exp-status'); st.textContent = 'Exporting…'; exBtn.disabled = true;
    try {
      const r = await (await fetch('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: id }) })).json();
      if (!r.ok) throw new Error(r.error || 'export failed');
      st.innerHTML = `✓ ${r.files.length} file(s) → <b>${r.out_dir}</b> — one GeoJSON per mill + CSV${r.excluded_omitted ? ` · ${fmt(r.excluded_omitted)} taken-down plots omitted` : ''}`;
    } catch (e2) { st.textContent = '✕ ' + e2.message; } finally { exBtn.disabled = false; }
  });
  return () => { try { rmap.remove(); } catch {} root.innerHTML = ''; };
}

const compType = (t, k) => (t.by_type?.[k]?.count || 0);
const ffTotal = (e) => ['HP', 'HPK', 'HPT', 'HL'].reduce((s, k) => s + (e.forest_function?.[k] || 0), 0);
const anyCat = (rc) => rc && Object.values(rc).some(v => v.plots > 0);
const sumCard = (l, n, u, tone) => `<div class="sum-card ${tone || ''}"><div class="sum-l">${l}</div><div class="sum-n">${n} <span>${u}</span></div></div>`;
const stat = (n, l) => `<div class="rstat"><div class="rstat-n">${n}</div><div class="rstat-l">${l}</div></div>`;
function complianceByType(e) {
  const bt = e.by_type_compliance || {};
  const rows = Object.entries(bt).map(([k, v]) => ({
    label: config.plotTypes[k]?.label || k, comply: v.comply_area, non: v.noncomply_area }));
  if (!rows.length) return '';
  return `<div class="ctype">${rows.map(r => `<div class="ctype-row"><div class="ctype-l">${r.label}</div>
    <div class="ctype-bar"><div style="flex:${r.comply};background:${config.color.comply}"></div><div style="flex:${r.non};background:${config.color.noncomply}"></div></div>
    <div class="src">${fmt(Math.round(r.comply))} / ${fmt(Math.round(r.non))} ha</div></div>`).join('')}
    <div class="src" style="margin-top:6px">compliant / non-compliant area</div></div>`;
}
