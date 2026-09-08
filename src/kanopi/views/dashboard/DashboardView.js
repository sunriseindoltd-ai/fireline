// @ts-nocheck
// Chain dashboard: KPIs + EUDR charts + mill table + mini-map.
import maplibregl from 'maplibre-gl';
import { config } from '../../config.js';
import { donut, hbars, stackedBar, columns, fmt, fmt1 } from './charts.js';
const C = config.color;

export async function mount(root, ctx) {
  const id = ctx.projectId;
  let reg = [];
  try { reg = await (await fetch(`${config.dataBaseUrl}/${config.overview.projects}`)).json(); } catch {}
  const entry = reg.find(p => p.id === id);
  if (!entry?.has_detail) {
    const { mount: pm } = await import('../project/ProjectView.js');
    return pm(root, ctx);
  }

  const m = config.projectFiles(id);
  let agg, mills;
  try {
    [agg, mills] = await Promise.all([
      (await fetch(`${config.dataBaseUrl}/${m.aggregates}`)).json(),
      (await fetch(`${config.dataBaseUrl}/${m.mills}`)).json(),
    ]);
  } catch (e) {
    root.className = 'shell-scroll';
    root.innerHTML = `<div class="fatal">Tidak bisa memuat ${id}: ${e.message}</div>`;
    return () => {};
  }

  const t = agg.totals, e = agg.eudr || {};
  const mapped = Object.keys(agg.by_mill || {}).length;
  const comp = e.compliance || { YES: { plots: 0, area_ha: 0 }, NO: { plots: 0, area_ha: 0 } };
  const totalPlots = (comp.YES?.plots || 0) + (comp.NO?.plots || 0);
  const complyPct = totalPlots ? Math.round(comp.YES.plots / totalPlots * 100) : null;
  const rc = e.risk_category || {};
  const submitReady = (rc.A?.plots || 0) + (rc.B?.plots || 0) + (rc.C?.plots || 0);
  const readyHa = (rc.A?.area_ha || 0) + (rc.B?.area_ha || 0) + (rc.C?.area_ha || 0);
  const readyPct = totalPlots ? Math.round(submitReady / totalPlots * 100) : null;

  root.className = 'shell-scroll';
  root.innerHTML = `
    <div class="dash">
      <div class="dash-head">
        <div><div class="dp-eyebrow">Rantai pasok</div>
          <h1 class="dash-title">${entry.name}</h1>
          <div class="dp-note">ke ${agg.facility?.name || '—'} · ${mapped} pabrik terpetakan${agg.excluded?.count ? ` · <span class="td-note">⊘ ${agg.excluded.count.toLocaleString()} diambil turun</span>` : ''}</div></div>
        <a class="btn" href="#/project/${id}/map">Buka peta</a>
      </div>

      ${readyPct != null ? `<div class="hero">
        <div class="hero-k">Siap diajukan (kategori A–C)</div>
        <div class="hero-n">${readyPct}% <span>${fmt(submitReady)} plot · ${fmt(Math.round(readyHa))} ha</span></div>
        <div class="hero-s">A–C boleh masuk paket DDS. D masih data gap, E perlu mitigasi, F dikeluarkan dari basis pasok.</div>
      </div>` : ''}

      <div class="kpi-row">
        ${kpi(fmt(t.plot_count), 'Plot')}
        ${kpi(fmt(Math.round(t.area_ha)) + ' ha', 'Luas terpetakan')}
        ${kpi(fmt(mapped), 'Pabrik terpetakan')}
        ${complyPct != null ? kpi(complyPct + '%', 'EUDR comply', complyPct >= 85 ? 'ok' : complyPct >= 60 ? 'warn' : 'bad') : ''}
        ${e.has_analysis ? kpi(fmt1(e.deforestation?.total_ha || 0) + ' ha', 'Deforestasi pasca-2020', (e.deforestation?.total_ha || 0) > 0 ? 'bad' : 'ok') : ''}
      </div>

      <div class="card-grid">
        ${complyPct != null ? card('Kepatuhan EUDR', `
          <div class="donut-wrap">${donut([
            { label: 'Comply', value: comp.YES.plots, color: C.comply },
            { label: 'Non-comply', value: comp.NO.plots, color: C.noncomply }],
            { center: { top: complyPct + '%', bottom: 'comply' } })}
            <div class="donut-legend">
              <div><i style="background:${C.comply}"></i> Comply <b>${fmt(comp.YES.plots)} plot</b></div>
              <div><i style="background:${C.noncomply}"></i> Non-comply <b>${fmt(comp.NO.plots)} plot</b></div>
            </div></div>`) : ''}

        ${e.has_analysis && anyCat(e.risk_category) ? card('Kategori mitigasi', hbars(
          'ABCDEF'.split('').map(c => ({ label: c, value: e.risk_category[c]?.plots || 0,
            color: C.riskCat[c], sub: fmt(Math.round(e.risk_category[c]?.area_ha || 0)) + ' ha' })),
          {}) + `<div class="card-foot">${fmt(submitReady)} plot siap diajukan (A–C).<br><span class="src">A siap · B siap + pantau · C perlu verifikasi · D belum layak · E mitigasi · F tidak layak</span></div>`) : ''}

        ${card('Kepastian ketertelusuran', stackedBar([
          { label: 'Tertelusur ke desa (TTV)', value: t.by_traceability?.village?.area_ha || t.by_traceability?.village?.count || 0, color: C.village },
          { label: 'Buffer pabrik (TTM)', value: t.by_traceability?.mill_buffer?.area_ha || t.by_traceability?.mill_buffer?.count || 0, color: C.millBuffer }],
          { fmt: v => fmt(Math.round(v)) }))}

        ${card('Komposisi pemasok', stackedBar(Object.entries(t.by_type || {}).map(([k, v]) => ({
          label: (config.plotTypes[k]?.label || k), value: v.area_ha || v.count, color: config.plotTypes[k]?.color || '#bbb' })),
          { fmt: v => fmt(Math.round(v)) + ' ha' }))}

        ${!e.has_analysis ? `<div class="card pending-card"><div class="card-h">Analisis belum dilampirkan</div>
          <p class="src2">Rantai ini sudah punya plot. Unggah plot teranalisis (kolom <span class="mono">EUDR_Comply</span>, <span class="mono">Risk_Mitigation</span>, <span class="mono">Def_*</span>, <span class="mono">HP/HL</span>…) untuk menampilkan:</p>
          <ul class="pending-list"><li>Detail kepatuhan & kategori risiko A–F</li><li>Deforestasi pasca-2020</li><li>Tumpang tindih fungsi kawasan hutan</li><li>Risiko yurisdiksi per provinsi</li></ul></div>` : ''}

        ${e.has_analysis ? card('Deforestasi pasca-2020 (ha/th)', columns(
          Object.entries(e.deforestation?.by_year || {}).map(([y, v]) => ({ label: y.slice(2), value: v })),
          { color: C.high, unit: '' })) : ''}

        ${e.has_analysis && anyVal(e.forest_function) ? card('Tumpang tindih fungsi kawasan', hbars([
          { label: 'Lindung (HL)', value: e.forest_function.HL, color: C.high },
          { label: 'Produksi terbatas (HPT)', value: e.forest_function.HPT, color: C.medium },
          { label: 'Produksi (HP)', value: e.forest_function.HP, color: '#c9a227' },
          { label: 'Konversi (HPK)', value: e.forest_function.HPK, color: '#b7c34a' }].filter(r => r.value > 0),
          { fmt: v => fmt1(v) + ' ha' }) + `<div class="card-foot">HL (hutan lindung) adalah tumpang tindih prioritas tertinggi.</div>`) : ''}

        ${e.by_province && Object.keys(e.by_province).some(k => k !== 'Unknown') ? `<div class="card juris-card"><div class="card-h">Risiko per provinsi</div>${jurisTable(e.by_province)}</div>` : ''}

        ${millTable(agg.by_mill || {})}

        <div class="card map-card"><div class="card-h">Basis pasok</div><div id="dash-map"></div></div>
      </div>
    </div>`;

  const pts = (mills.features || []).filter(f => f.geometry);
  const map = new maplibregl.Map({ container: root.querySelector('#dash-map'),
    style: config.map.basemaps.hybrid, center: config.map.center, zoom: 4, attributionControl: { compact: true } });
  map.on('load', () => {
    map.addSource('m', { type: 'geojson', data: { type: 'FeatureCollection', features: pts } });
    map.addLayer({ id: 'm', type: 'circle', source: 'm', paint: { 'circle-radius': 5, 'circle-color': C.mill, 'circle-stroke-width': 1.5, 'circle-stroke-color': C.ink } });
    if (pts.length) {
      const b = new maplibregl.LngLatBounds();
      pts.forEach(f => b.extend(f.geometry.coordinates));
      map.fitBounds(b, { padding: 40, maxZoom: 9, duration: 0 });
    }
    map.resize();
  });
  return () => map.remove();
}

const kpi = (n, l, tone) => `<div class="kpi ${tone || ''}"><div class="kpi-n">${n}</div><div class="kpi-l">${l}</div></div>`;
const card = (title, body) => `<div class="card"><div class="card-h">${title}</div>${body}</div>`;
const anyCat = (rc) => rc && Object.values(rc).some(v => v.plots > 0);
const anyVal = (o) => o && Object.values(o).some(v => v > 0);

function millYesNo(m) {
  const e = m.eudr || {};
  const yes = typeof e.YES === 'number' ? e.YES : (e.YES?.plots || 0);
  const no = typeof e.NO === 'number' ? e.NO : (e.NO?.plots || 0);
  return { yes, no };
}

function millTable(byMill) {
  const rows = Object.entries(byMill).map(([id, m]) => {
    const { yes, no } = millYesNo(m);
    const tot = yes + no;
    const pct = tot ? Math.round(yes / tot * 100) : null;
    return { id, name: m.name || id, uml: m.uml_id || '', plots: m.plot_count || 0, ha: m.area_ha || 0, yes, no, pct };
  }).sort((a, b) => b.plots - a.plots);
  if (!rows.length) return '';
  return `<div class="card mill-card"><div class="card-h">Pabrik terpetakan</div>
    <div class="mill-tbl-wrap"><table class="mill-tbl">
      <thead><tr><th>Pabrik</th><th>UML</th><th>Plot</th><th>Luas</th><th>EUDR comply</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td><b>${r.name}</b></td>
        <td class="mono">${r.uml}</td>
        <td class="mono">${fmt(r.plots)}</td>
        <td class="mono">${fmt(Math.round(r.ha))} ha</td>
        <td>${r.pct == null ? '—' : `<span class="chip ${r.pct >= 85 ? 'ok' : r.pct >= 60 ? 'warn' : 'risk'}">${r.pct}%</span>
          <span class="src">${fmt(r.yes)} / ${fmt(r.yes + r.no)}</span>`}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <div class="card-foot">Persentase comply = plot EUDR YES. Kategori mitigasi A–C belum tersedia per pabrik di agregat ini.</div>
  </div>`;
}

function jurisTable(byProv) {
  const rows = Object.entries(byProv).slice(0, 8);
  return `<div class="juris">${rows.map(([name, r]) => {
    const pct = r.plots ? Math.round(r.comply / r.plots * 100) : 0;
    const tone = pct >= 85 ? C.ok : pct >= 60 ? C.medium : C.bad;
    return `<div class="juris-row">
      <div class="juris-name">${name}</div>
      <div class="juris-bar"><div style="width:${pct}%;background:${tone}"></div></div>
      <div class="juris-pct">${pct}%</div>
      <div class="juris-meta">${fmt(r.plots)} plot · ${r.high_risk ? fmt(r.high_risk) + ' berisiko tinggi' : 'ok'}</div>
    </div>`; }).join('')}<div class="src" style="margin-top:6px">batang = porsi plot comply EUDR</div></div>`;
}
