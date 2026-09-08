// @ts-nocheck
// src/views/home/OverviewMap.js
// Portfolio map: refineries/KCP (by project) + mills (uniform color) + optional
// routes (mill→refinery) + optional WPI reference ports. Toggles top-left.
import maplibregl from 'maplibre-gl';
import { config } from '../../config.js';

export function mount(container, store, ov) {
  const projColor = projectColorMap(ov.getProjects());

  // toggle overlay (routes + reference ports)
  const panel = document.createElement('div');
  panel.className = 'map-toggle';
  panel.innerHTML = `
    <label><input type="checkbox" data-t="routes"> Routes (mill→refinery)</label>
    <label><input type="checkbox" data-t="ports"> Reference ports (WPI)</label>`;
  container.appendChild(panel);

  const map = new maplibregl.Map({
    container, style: config.map.basemaps.satellite,
    center: config.map.center, zoom: config.map.zoom,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  const byProject = () => ['match', ['get', 'project'],
    ...Object.entries(projColor).flatMap(([p, c]) => [p, c]), '#bbb'];

  map.on('load', () => {
    // KLHK Kawasan Hutan (2025) overlay — under all portfolio data
    if (config.map.overlays?.kwshutan) {
      map.addSource('kwshutan', { type: 'raster', tileSize: 256,
        tiles: config.map.overlays.kwshutan.tiles, attribution: config.map.overlays.kwshutan.attribution });
      map.addLayer({ id: 'kwshutan', type: 'raster', source: 'kwshutan',
        layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.6 } });
      const ovc = document.createElement('div');
      ovc.className = 'map-overlays';
      ovc.innerHTML = `<button class="ovl-btn"><span class="ovl-dot"></span> Kawasan Hutan <span class="src">KLHK '25</span></button>`;
      container.appendChild(ovc);
      let on = false;
      ovc.querySelector('.ovl-btn').addEventListener('click', function () {
        on = !on; this.classList.toggle('on', on);
        map.setLayoutProperty('kwshutan', 'visibility', on ? 'visible' : 'none');
      });
    }
    // routes first (under everything)
    const routes = filterGeo(ov.getRoutes ? ov.getRoutes() : empty());
    if (routes.features.length) {
      map.addSource('routes', { type: 'geojson', data: routes });
      map.addLayer({ id: 'routes', type: 'line', source: 'routes', layout: { visibility: 'none' },
        paint: { 'line-color': config.color.route, 'line-width': 0.8 } });
    }
    // mills — UNIFORM color (no per-project confetti)
    map.addSource('mills', { type: 'geojson', data: filterGeo(ov.getMills()) });
    map.addLayer({ id: 'mills', type: 'circle', source: 'mills', paint: {
      'circle-radius': 4, 'circle-color': config.color.millUniform, 'circle-opacity': 0.9,
      'circle-stroke-width': 0.7, 'circle-stroke-color': config.color.ink } });
    // refineries — colored by project (anchors), labeled
    map.addSource('refs', { type: 'geojson', data: filterGeo(ov.getRefineries()) });
    map.addLayer({ id: 'refs', type: 'circle', source: 'refs', paint: {
      'circle-radius': 8, 'circle-color': byProject(), 'circle-stroke-width': 2.5, 'circle-stroke-color': '#fff' } });
    map.addLayer({ id: 'refs-label', type: 'symbol', source: 'refs', minzoom: 6,
      layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top',
        'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'] },
      paint: { 'text-color': '#fff', 'text-halo-color': config.color.ink, 'text-halo-width': 1.6 } });

    // reference ports
    const portsRef = filterGeo(ov.getPortsReference ? ov.getPortsReference() : empty());
    if (portsRef.features.length) {
      map.addSource('ports-ref', { type: 'geojson', data: portsRef });
      map.addLayer({ id: 'ports-ref', type: 'circle', source: 'ports-ref', layout: { visibility: 'none' },
        paint: { 'circle-radius': 4, 'circle-color': '#0e2a3a', 'circle-stroke-width': 1.4, 'circle-stroke-color': '#9fd4ff' } });
      map.addLayer({ id: 'ports-ref-label', type: 'symbol', source: 'ports-ref', minzoom: 7,
        layout: { visibility: 'none', 'text-field': ['get', 'name'], 'text-size': 10, 'text-offset': [0, 1], 'text-anchor': 'top',
          'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'] },
        paint: { 'text-color': '#bfe3ff', 'text-halo-color': config.color.ink, 'text-halo-width': 1.4 } });
    }

    // navigation
    map.on('click', 'refs', (e) => store.go && store.go(e.features[0].properties.project));
    map.on('click', 'mills', (e) => store.go && store.go(e.features[0].properties.project));
    for (const l of ['refs', 'mills']) {
      map.on('mouseenter', l, () => map.getCanvas().style.cursor = 'pointer');
      map.on('mouseleave', l, () => map.getCanvas().style.cursor = '');
    }
    // toggles
    panel.querySelectorAll('input[data-t]').forEach(inp => inp.addEventListener('change', () => {
      const v = inp.checked ? 'visible' : 'none';
      const ids = inp.dataset.t === 'routes' ? ['routes'] : ['ports-ref', 'ports-ref-label'];
      ids.forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', v));
    }));
    // hide a toggle if its data isn't present
    if (!routes.features.length) panel.querySelector('[data-t="routes"]').closest('label').style.display = 'none';
    if (!portsRef.features.length) panel.querySelector('[data-t="ports"]').closest('label').style.display = 'none';
    map.resize();
  });

  return function destroy() { map.remove(); panel.remove(); };
}
function empty() { return { type: 'FeatureCollection', features: [] }; }
function filterGeo(fc) { return { type: 'FeatureCollection', features: (fc.features || []).filter(f => f.geometry) }; }
function projectColorMap(projects) {
  const out = {}; projects.forEach((p, i) => out[p.id] = config.color.projects[i % config.color.projects.length]); return out;
}
export { projectColorMap };
