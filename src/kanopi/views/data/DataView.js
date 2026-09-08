// @ts-nocheck
// src/views/data/DataView.js — sortable/filterable plot table per mill (inspection + CSV).
import { config } from '../../config.js';
const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
const defo = (p) => num(p.Def_21) + num(p.Def_22) + num(p.Def_23) + num(p.Def_24) + num(p.Def_25);
const cat = (p) => (String(p.risk_mitigation || '').trim()[0] || '').toUpperCase();

export async function mount(root, ctx) {
  const id = ctx.projectId;
  let reg = [];
  try { reg = await (await fetch(`${config.dataBaseUrl}/${config.overview.projects}`)).json(); } catch {}
  const entry = reg.find(p => p.id === id);
  if (!entry?.has_detail) { const { mount: pm } = await import('../project/ProjectView.js'); return pm(root, ctx); }

  const m = config.projectFiles(id);
  const agg = await (await fetch(`${config.dataBaseUrl}/${m.aggregates}`)).json();
  const mills = Object.entries(agg.by_mill).map(([mid, v]) => ({ mid, name: v.name || mid, n: v.plot_count }))
    .sort((a, b) => b.n - a.n);

  root.className = 'shell-scroll';
  root.innerHTML = `
    <div class="dataview">
      <div class="dash-head"><div><div class="dp-eyebrow">${entry.name}</div><h1 class="dash-title">Data plot</h1></div></div>
      <div class="dv-toolbar">
        <select class="dv-mill">${mills.map(x => `<option value="${x.mid}">${x.name} · ${x.n.toLocaleString()} plots</option>`).join('')}</select>
        <input class="dv-search" placeholder="Search PlotID / village…">
        <div class="seg dv-quick">
          <button data-q="all" class="seg-on">All</button>
          <button data-q="noncomply">Non-comply</button>
          <button data-q="highrisk">High-risk</button>
          <button data-q="deforest">Deforestation</button>
          <button data-q="excluded">Taken down</button>
        </div>
        <button class="btn ghost dv-csv">Download CSV</button>
        <button class="btn ghost dv-geojson">Download GeoJSON</button>
      </div>
      <div class="dv-count src"></div>
      <div class="dv-table-wrap"><table class="dv-table"><thead></thead><tbody></tbody></table></div>
    </div>`;

  const cols = [
    ['id', 'PlotID', p => p.id], ['plot_type', 'Type', p => config.plotTypes[p.plot_type]?.label || p.plot_type],
    ['area_ha', 'Area (ha)', p => num(p.area_ha).toFixed(2), true], ['eudr_comply', 'EUDR', p => p.eudr_comply || '—'],
    ['cat', 'Risk', p => cat(p) || '—'], ['defo', 'Deforest (ha)', p => defo(p) ? defo(p).toFixed(2) : '', true],
    ['HL', 'HL (ha)', p => num(p.HL) ? num(p.HL).toFixed(1) : '', true],
    ['Village', 'Village', p => p.Village || p.village_id_bps || '—'], ['District', 'District', p => p.District || '—'],
  ];
  let plots = [], sortKey = 'area_ha', sortDir = -1, quick = 'all', term = '';
  const q = s => root.querySelector(s);

  async function loadMill(mid) {
    q('.dv-count').textContent = 'Memuat…';
    try {
      const r = await fetch(`${config.dataBaseUrl}/${m.plotsByMill(mid)}`);
      if (!r.ok) { plots = []; }
      else plots = (await r.json()).features.map(f => f.properties);
    }
    catch { plots = []; }
    render();
  }
  function filtered() {
    let r = plots;
    if (quick === 'noncomply') r = r.filter(p => String(p.eudr_comply).toUpperCase() === 'NO');
    else if (quick === 'highrisk') r = r.filter(p => /high/i.test(p.Risk_Level || '') || 'EF'.includes(cat(p)));
    else if (quick === 'deforest') r = r.filter(p => defo(p) > 0);
    else if (quick === 'excluded') r = r.filter(p => p.excluded);
    if (term) { const t = term.toLowerCase(); r = r.filter(p => String(p.id).toLowerCase().includes(t) || String(p.Village || '').toLowerCase().includes(t)); }
    const val = { defo, cat, id: p => p.id, area_ha: p => num(p.area_ha), HL: p => num(p.HL) }[sortKey] || (p => p[sortKey]);
    return [...r].sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * sortDir; });
  }
  function render() {
    const rows = filtered(); const cap = 500;
    q('.dv-table thead').innerHTML = '<tr>' + cols.map(([k, label]) =>
      `<th data-k="${k}" class="${sortKey === k ? 'sorted ' + (sortDir < 0 ? 'desc' : 'asc') : ''}">${label}</th>`).join('') + '</tr>';
    q('.dv-table tbody').innerHTML = rows.slice(0, cap).map(p => `<tr class="${p.excluded ? 'excl' : ''}">` +
      cols.map(([k, l, fn]) => `<td class="${k === 'id' ? 'mono' : ''}">${fn(p) ?? ''}</td>`).join('') + '</tr>').join('');
    q('.dv-count').textContent = plots.length
      ? `${rows.length.toLocaleString()} plot${rows.length > cap ? ` (menampilkan ${cap} pertama)` : ''}`
      : 'GeoJSON plot per pabrik tidak disertakan di pratinjau ini (file terlalu besar). Ringkasan pabrik ada di tab Ringkasan.';
    q('.dv-table thead').querySelectorAll('th').forEach(th => th.onclick = () => {
      const k = th.dataset.k; if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = -1; } render();
    });
  }
  q('.dv-mill').onchange = e => loadMill(e.target.value);
  q('.dv-search').oninput = e => { term = e.target.value; render(); };
  q('.dv-quick').querySelectorAll('button').forEach(b => b.onclick = () => {
    q('.dv-quick').querySelectorAll('button').forEach(x => x.classList.remove('seg-on'));
    b.classList.add('seg-on'); quick = b.dataset.q; render();
  });
  q('.dv-csv').onclick = () => {
    const rows = filtered();
    const head = cols.map(c => c[1]).join(',');
    const body = rows.map(p => cols.map(([k, l, fn]) => `"${String(fn(p) ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([head + '\n' + body], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${id}_${q('.dv-mill').value}.csv`; a.click();
  };
  q('.dv-geojson').onclick = async () => {
    const mid = q('.dv-mill').value;
    const btn = q('.dv-geojson');
    btn.disabled = true;
    try {
      const r = await fetch(`${config.dataBaseUrl}/${m.plotsByMill(mid)}`);
      if (!r.ok) throw new Error('fetch failed');
      const blob = await r.blob();
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${id}_${mid}.geojson`; a.click();
    } catch {
      q('.dv-count').textContent = 'GeoJSON tidak tersedia untuk diunduh.';
    } finally {
      btn.disabled = false;
    }
  };
  if (mills.length) loadMill(mills[0].mid); else q('.dv-count').textContent = 'Tidak ada pabrik dengan data.';
  return () => { root.innerHTML = ''; };
}
