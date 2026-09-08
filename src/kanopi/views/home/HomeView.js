// @ts-nocheck
// src/views/home/HomeView.js — composes the home page (stats | map / sankey).
import { OverviewAdapter } from '../../data/OverviewAdapter.js';
import { config } from '../../config.js';
import * as OverviewMap from './OverviewMap.js';
import * as OverviewSankey from './OverviewSankey.js';
import * as OverviewStats from './OverviewStats.js';

export async function mount(root, ctx) {
  root.innerHTML = `
    <aside id="ov-stats" class="rail"></aside>
    <main id="ov-map"></main>
    <section id="ov-sankey">
      <div class="sankey-head"><span class="sankey-title">Rantai → Refinery/KCP → Pelabuhan</span>
        <span class="src">lebar tautan = jumlah pabrik · klik untuk membuka rantai</span></div>
      <div id="ov-sankey-body"></div>
    </section>`;
  root.className = 'layout-home';

  const ov = await new OverviewAdapter(config).load();
  const nav = { go: (projectId) => ctx.router.go(`#/project/${projectId}`) };

  // portfolio EUDR rollup: pull aggregates for every chain that has plot data
  const detailed = ov.getProjects().filter(p => p.has_detail);
  let mappedArea = 0; const eudrChains = [];
  await Promise.all(detailed.map(async (p) => {
    try {
      const agg = await (await fetch(`${config.dataBaseUrl}/${config.projectFiles(p.id).aggregates}`)).json();
      mappedArea += agg.totals?.area_ha || 0;
      const c = agg.eudr?.compliance; const tot = c ? c.YES.plots + c.NO.plots : 0;
      if (tot > 0) eudrChains.push({ id: p.id, name: p.name, plots: agg.totals.plot_count,
        comply: c.YES.plots, noncomply: c.NO.plots, pct: Math.round(c.YES.plots / tot * 100) });
    } catch {}
  }));
  eudrChains.sort((a, b) => b.pct - a.pct);

  const ds = [
    OverviewStats.mount(root.querySelector('#ov-stats'), nav, ov, { mappedArea, eudrChains }),
    OverviewMap.mount(root.querySelector('#ov-map'), nav, ov),
    OverviewSankey.mount(root.querySelector('#ov-sankey-body'), nav, ov),
  ];
  return () => ds.forEach(d => d && d());
}
