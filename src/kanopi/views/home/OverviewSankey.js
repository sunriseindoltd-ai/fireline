// @ts-nocheck
// src/views/home/OverviewSankey.js — cross-project flow: Project -> Refinery/KCP.
// Weighted by mill count (no volumes/areas for most projects). Click a node to
// open that project's page.
import * as d3 from 'd3';
import { sankey, sankeyLinkHorizontal } from 'd3-sankey';
import { config } from '../../config.js';
import { projectColorMap } from './OverviewMap.js';

export function mount(container, store, ov) {
  const projects = ov.getProjects();
  const pc = projectColorMap(projects);
  const refs = new Map(ov.getRefineries().features.map(f => [f.properties.id, f.properties]));
  const flows = ov.getFlows();
  const root = d3.select(container);

  // count mills per (project -> refinery)
  const pr = new Map();
  for (const e of flows) {
    const ref = refs.get(e.to_id); if (!ref) continue;
    const key = `${e.project}|${e.to_id}`;
    pr.set(key, (pr.get(key) || 0) + 1);
  }

  function draw() {
    root.selectAll('*').remove();
    const nodes = [], idx = new Map();
    const add = (k, label, kind, project) => { if (!idx.has(k)) { idx.set(k, nodes.length); nodes.push({ k, label, kind, project }); } return idx.get(k); };
    const links = [];
    for (const [key, n] of pr) {
      const [proj, refId] = key.split('|');
      const a = add(`p:${proj}`, projects.find(p => p.id === proj)?.name || proj, 'project', proj);
      const b = add(`r:${refId}`, refs.get(refId)?.name || refId, 'refinery', proj);
      links.push({ source: a, target: b, value: n, project: proj });
    }
    // optional refinery -> port column
    const refProject = new Map([...refs].map(([id, p]) => [id, p.project]));
    const rp = new Map();
    for (const e of flows) {
      if (e.from_type === 'refinery' && e.to_type === 'port') {
        const k = `${e.from_id}|${e.to_id}`; rp.set(k, (rp.get(k) || 0) + 1);
      }
    }
    for (const [k, n] of rp) {
      const [refId, portId] = k.split('|');
      const proj = refProject.get(refId);
      const b = add(`r:${refId}`, refs.get(refId)?.name || refId, 'refinery', proj);
      const c = add(`port:${portId}`, portId.replace(/^port-/, '').replace(/-/g, ' '), 'port', proj);
      links.push({ source: b, target: c, value: n, project: proj });
    }
    if (!links.length) { root.append('div').attr('class', 'sankey-empty').text('No overview flows.'); return; }
    const width = container.clientWidth || 760;
    const height = Math.max(360, nodes.filter(n => n.kind === 'refinery').length * 14 + 40);
    const svg = root.append('svg').attr('viewBox', `0 0 ${width} ${height}`).attr('width', '100%').attr('height', height);
    const sk = sankey().nodeWidth(12).nodePadding(8).nodeSort(null).extent([[4, 8], [width - 4, height - 8]]);
    const g = sk({ nodes, links });
    svg.append('g').selectAll('path').data(g.links).join('path')
      .attr('d', sankeyLinkHorizontal()).attr('fill', 'none')
      .attr('stroke', d => pc[d.project] || '#999').attr('stroke-opacity', 0.3)
      .attr('stroke-width', d => Math.max(1, d.width));
    const node = svg.append('g').selectAll('g').data(g.nodes).join('g').style('cursor', 'pointer')
      .on('click', (_, d) => store.go && store.go(d.project));
    node.append('rect').attr('x', d => d.x0).attr('y', d => d.y0)
      .attr('height', d => Math.max(1, d.y1 - d.y0)).attr('width', d => d.x1 - d.x0)
      .attr('fill', d => pc[d.project] || '#888');
    node.append('text').attr('x', d => d.x0 < width / 2 ? d.x1 + 5 : d.x0 - 5)
      .attr('y', d => (d.y0 + d.y1) / 2).attr('dy', '0.35em')
      .attr('text-anchor', d => d.x0 < width / 2 ? 'start' : 'end')
      .attr('class', 'sankey-label').text(d => d.label);
  }
  draw();
  const onR = () => draw(); window.addEventListener('resize', onR);
  return function destroy() { window.removeEventListener('resize', onR); root.selectAll('*').remove(); };
}
