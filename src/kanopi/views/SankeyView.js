// @ts-nocheck
// src/views/SankeyView.js
// Aggregate Sankey: plot type -> mill -> facility (Banyuasin Nusantara Sejahtera).
// Weighted by area_ha (or plot count). Built from aggregates.json, so it renders
// without loading any geometry. Click a mill to select it (loads its plots on the
// map); click a plot-type to toggle that type filter.
import * as d3 from 'd3';
import { sankey, sankeyLinkHorizontal } from 'd3-sankey';
import { config } from '../config.js';

export function mount(container, store, adapter) {
  const agg = adapter.getAggregates();
  const root = d3.select(container);
  const offs = [];
  const hasArea = (agg.totals?.area_ha || 0) > 0;
  let metric = hasArea ? 'area_ha' : 'count';

  const millList = Object.entries(agg.by_mill).map(([id, m]) => ({ id, ...m }))
    .sort((a, b) => b.area_ha - a.area_ha);

  // header with metric toggle
  const head = root.append('div').attr('class', 'sankey-head');
  head.append('span').attr('class', 'sankey-title').text('Supply flow — to ' + agg.facility.name);
  const seg = head.append('div').attr('class', 'seg');
  const bArea = seg.append('button').attr('class', hasArea ? 'seg-on' : '').text('By area');
  const bCount = seg.append('button').attr('class', hasArea ? '' : 'seg-on').text('By plots');
  bArea.on('click', () => { metric = 'area_ha'; bArea.classed('seg-on', true); bCount.classed('seg-on', false); draw(store.get()); });
  bCount.on('click', () => { metric = 'count'; bCount.classed('seg-on', true); bArea.classed('seg-on', false); draw(store.get()); });
  const body = root.append('div').attr('class', 'sankey-body');

  function build(s) {
    const onTypes = Object.entries(s.filters.plotType).filter(([, v]) => v).map(([k]) => k);
    const nodes = [], index = new Map();
    const add = (key, label, kind) => { if (!index.has(key)) { index.set(key, nodes.length); nodes.push({ key, label, kind }); } return index.get(key); };
    const links = [];
    const fac = add(`facility:${agg.facility.id}`, agg.facility.name, 'facility');
    for (const m of millList) {
      let total = 0; const mi = add(`mill:${m.id}`, m.name, 'mill');
      for (const [t, v] of Object.entries(m.by_type)) {
        if (!onTypes.includes(t)) continue;
        const val = metric === 'area_ha' ? v.area_ha : v.count;
        if (val <= 0) continue;
        const ti = add(`type:${t}`, config.plotTypes[t]?.label || t, 'type');
        links.push({ source: ti, target: mi, value: val, _t: t }); total += val;
      }
      if (total > 0) links.push({ source: mi, target: fac, value: total });
    }
    return { nodes, links };
  }

  const colorFor = (n) => n.kind === 'facility' ? config.color.facility
    : n.kind === 'mill' ? config.color.mill
    : (config.plotTypes[n.key.split(':')[1]]?.color || '#888');

  function draw(s) {
    body.selectAll('*').remove();
    const data = build(s);
    if (!data.links.length) { body.append('div').attr('class', 'sankey-empty').text('No supply matches the current filters.'); return; }
    const width = body.node().clientWidth || 760;
    const millCount = data.nodes.filter(n => n.kind === 'mill').length;
    const height = Math.max(360, millCount * 13 + 40);
    const svg = body.append('svg').attr('viewBox', `0 0 ${width} ${height}`).attr('width', '100%').attr('height', height);
    const sk = sankey().nodeWidth(12).nodePadding(7).nodeSort(null).extent([[4, 8], [width - 4, height - 8]]);
    const g = sk(data); const sel = s.selection;
    const through = (d) => sel && sel.type === 'mill' && (d.source.key === `mill:${sel.id}` || d.target.key === `mill:${sel.id}`);

    svg.append('g').selectAll('path').data(g.links).join('path')
      .attr('d', sankeyLinkHorizontal()).attr('fill', 'none')
      .attr('stroke', d => d._t ? (config.plotTypes[d._t]?.color || '#999') : config.color.mill)
      .attr('stroke-opacity', d => sel ? (through(d) ? 0.65 : 0.1) : 0.24)
      .attr('stroke-width', d => Math.max(1, d.width));

    const node = svg.append('g').selectAll('g').data(g.nodes).join('g')
      .style('cursor', d => d.kind === 'facility' ? 'default' : 'pointer')
      .on('click', (_, d) => {
        if (d.kind === 'mill') store.toggleSelection('mill', d.key.split(':')[1]);
        else if (d.kind === 'type') { const t = d.key.split(':')[1];
          store.update(st => ({ filters: { ...st.filters, plotType: { ...st.filters.plotType, [t]: !st.filters.plotType[t] } } })); }
      });
    node.append('rect').attr('x', d => d.x0).attr('y', d => d.y0)
      .attr('height', d => Math.max(1, d.y1 - d.y0)).attr('width', d => d.x1 - d.x0)
      .attr('fill', colorFor).attr('opacity', d => sel && sel.type === 'mill' && d.kind === 'mill' && d.key !== `mill:${sel.id}` ? 0.45 : 1)
      .attr('stroke', d => sel && sel.type === 'mill' && d.key === `mill:${sel.id}` ? config.color.ink : 'none').attr('stroke-width', 1.5);
    node.append('text').attr('x', d => d.x0 < width / 2 ? d.x1 + 5 : d.x0 - 5)
      .attr('y', d => (d.y0 + d.y1) / 2).attr('dy', '0.35em')
      .attr('text-anchor', d => d.x0 < width / 2 ? 'start' : 'end')
      .attr('class', d => `sankey-label ${d.kind}`)
      .text(d => d.kind === 'mill' && (d.y1 - d.y0) < 7 ? '' : d.label);
  }

  offs.push(store.subscribe(draw));
  const onResize = () => draw(store.get());
  window.addEventListener('resize', onResize); offs.push(() => window.removeEventListener('resize', onResize));
  return function destroy() { offs.forEach(o => o()); root.selectAll('*').remove(); };
}
