// @ts-nocheck
// src/views/MapView.js
// Project map: traceability areas (TTV/TTM) + mill points (+ zoom-gated labels) +
// lazy-loaded plots for the active mill. Plot display is tied to the ACTIVE MILL,
// decoupled from selection, so clicking a plot never clears the plots.
import maplibregl from 'maplibre-gl';
import { config } from '../config.js';
const C = config.color;

export function mount(container, store, adapter) {
  const map = new maplibregl.Map({
    container, style: config.map.basemaps[store.get().basemap],
    center: config.map.projectCenter, zoom: config.map.projectZoom,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

  // on-map basemap switcher (bottom-left)
  const bm = document.createElement('div');
  bm.className = 'map-basemap';
  const BMS = [['hybrid', 'Hybrid'], ['satellite', 'Satellite'], ['streets', 'Streets']];
  bm.innerHTML = BMS.map(([v, l]) => `<button data-bm="${v}" class="${store.get().basemap === v ? 'on' : ''}">${l}</button>`).join('');
  container.appendChild(bm);
  bm.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    bm.querySelectorAll('button').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); store.set({ basemap: b.dataset.bm });
  }));

  // on-map overlay toggle: KLHK Kawasan Hutan (legal forest function, 2025)
  let showForest = false;
  if (config.map.overlays?.kwshutan) {
    const ov = document.createElement('div');
    ov.className = 'map-overlays';
    ov.innerHTML = `<button class="ovl-btn"><span class="ovl-dot"></span> Kawasan Hutan <span class="src">KLHK '25</span></button>`;
    container.appendChild(ov);
    ov.querySelector('.ovl-btn').addEventListener('click', function () {
      showForest = !showForest;
      this.classList.toggle('on', showForest);
      if (map.getLayer('kwshutan')) map.setLayoutProperty('kwshutan', 'visibility', showForest ? 'visible' : 'none');
    });
  }

  const offs = [];
  let currentBasemap = store.get().basemap;
  let activeMill = null;                 // mill whose plots are shown
  const plotMill = new Map();            // plotId -> millId
  let lastSel = null;

  function plotColorExpr(by) {
    if (by === 'traceability_level')
      return ['match', ['get', 'traceability_level'], 'village', C.village, 'mill_buffer', C.millBuffer, '#888'];
    if (by === 'eudr')
      return ['case', ['==', ['get', 'eudr_comply'], 'YES'], C.village, C.risk];
    if (by === 'risk') {
      const rc = C.riskCat;
      return ['match', ['upcase', ['slice', ['coalesce', ['get', 'risk_mitigation'], '?'], 0, 1]],
        'A', rc.A, 'B', rc.B, 'C', rc.C, 'D', rc.D, 'E', rc.E, 'F', rc.F, '#9aa79a'];
    }
    if (by === 'deforestation')
      return ['case', ['>', ['+', ['coalesce', ['to-number', ['get', 'Def_21']], 0], ['coalesce', ['to-number', ['get', 'Def_22']], 0],
        ['coalesce', ['to-number', ['get', 'Def_23']], 0], ['coalesce', ['to-number', ['get', 'Def_24']], 0],
        ['coalesce', ['to-number', ['get', 'Def_25']], 0]], 0], C.high, '#cbd8cc'];
    const pt = config.plotTypes;
    return ['match', ['get', 'plot_type'], 'company', pt.company.color,
      'scheme_smallholder', pt.scheme_smallholder.color,
      'independent_smallholder', pt.independent_smallholder.color, pt.unknown.color];
  }

  function addLayers() {
    // KLHK Kawasan Hutan (2025) overlay — added first so plots/mills/areas draw on top.
    if (config.map.overlays?.kwshutan && !map.getSource('kwshutan')) {
      map.addSource('kwshutan', { type: 'raster', tileSize: 256,
        tiles: config.map.overlays.kwshutan.tiles, attribution: config.map.overlays.kwshutan.attribution });
      map.addLayer({ id: 'kwshutan', type: 'raster', source: 'kwshutan',
        layout: { visibility: showForest ? 'visible' : 'none' }, paint: { 'raster-opacity': 0.6 } });
    }
    if (!map.getSource('areas')) map.addSource('areas', { type: 'geojson', data: adapter.getAreas() });
    if (!map.getLayer('areas-fill')) {
      map.addLayer({ id: 'areas-fill', type: 'fill', source: 'areas', paint: {
        'fill-color': ['match', ['get', 'traceability_level'], 'village', C.village, 'mill_buffer', C.millBuffer, '#888'],
        'fill-opacity': 0.22 } });
      map.addLayer({ id: 'areas-line', type: 'line', source: 'areas', paint: {
        'line-color': ['match', ['get', 'traceability_level'], 'village', C.village, 'mill_buffer', C.millBuffer, '#888'],
        'line-width': 1.8,
        'line-dasharray': ['match', ['get', 'traceability_level'], 'mill_buffer', ['literal', [2, 1.5]], ['literal', [1, 0]]] } });
    }

    if (!map.getSource('plots')) map.addSource('plots', {
      type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' });
    if (!map.getLayer('plots-fill')) {
      map.addLayer({ id: 'plots-fill', type: 'fill', source: 'plots', paint: {
        'fill-color': plotColorExpr(store.get().plotColorBy),
        'fill-opacity': ['case', ['boolean', ['feature-state', 'sel'], false], 0.92, 0.62] } });
      map.addLayer({ id: 'plots-line', type: 'line', source: 'plots', paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'sel'], false], '#ffffff', 'rgba(255,255,255,0.75)'],
        'line-width': ['case', ['boolean', ['feature-state', 'sel'], false], 2.4, 0.7] } });
      map.on('click', 'plots-fill', (e) => {
        const id = e.features[0].properties.id, cur = store.get().selection;
        if (cur && cur.type === 'plot' && cur.id === id) store.set({ selection: { type: 'mill', id: activeMill } });
        else store.set({ selection: { type: 'plot', id } });
        e.originalEvent.stopPropagation();
      });
      hover('plots-fill');
    }

    if (!map.getSource('mills')) map.addSource('mills', { type: 'geojson', data: adapter.getMills(), promoteId: 'id' });
    if (!map.getLayer('mills-pt')) {
      map.addLayer({ id: 'mills-pt', type: 'circle', source: 'mills', paint: {
        'circle-radius': ['case', ['boolean', ['feature-state', 'sel'], false], 10, 6.5],
        'circle-color': ['match', ['get', 'status'], 'retired', C.millRetired, C.mill],
        'circle-stroke-width': 2.5, 'circle-stroke-color': C.ink } });
      map.addLayer({ id: 'mills-label', type: 'symbol', source: 'mills',
        minzoom: config.map.millLabelMinZoom,
        layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.1],
          'text-anchor': 'top', 'text-font': ['Open Sans Semibold','Arial Unicode MS Bold'], 'text-allow-overlap': false },
        paint: { 'text-color': '#fff', 'text-halo-color': C.ink, 'text-halo-width': 1.6 } });
      map.on('click', 'mills-pt', (e) => { store.toggleSelection('mill', e.features[0].properties.id); e.originalEvent.stopPropagation(); });
      hover('mills-pt');
    }
    // click empty space -> step back (plot->mill, mill->overview selection cleared)
    map.on('click', (e) => {
      const hit = map.queryRenderedFeatures(e.point, { layers: ['plots-fill', 'mills-pt'] });
      if (hit.length) return;
      const cur = store.get().selection;
      if (cur?.type === 'plot') store.set({ selection: { type: 'mill', id: activeMill } });
      else if (cur) store.set({ selection: null });
    });
    applyFilters(store.get());
  }

  function hover(layer) {
    map.on('mouseenter', layer, () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', layer, () => map.getCanvas().style.cursor = '');
  }

  function applyFilters(s) {
    const f = s.filters;
    const onLevels = Object.entries(f.traceability).filter(([, v]) => v).map(([k]) => k);
    if (map.getLayer('areas-fill')) { const flt = ['in', ['get', 'traceability_level'], ['literal', onLevels]];
      map.setFilter('areas-fill', flt); map.setFilter('areas-line', flt); }
    const onTypes = Object.entries(f.plotType).filter(([, v]) => v).map(([k]) => k);
    if (map.getLayer('plots-fill')) {
      const conds = [['in', ['get', 'plot_type'], ['literal', onTypes]],
                     ['in', ['get', 'traceability_level'], ['literal', onLevels]]];
      if (f.eudrNonComplyOnly) conds.push(['!=', ['get', 'eudr_comply'], 'YES']);
      conds.push(['!=', ['coalesce', ['get', 'excluded'], false], true]);  // hide taken-down plots
      const flt = ['all', ...conds];
      map.setFilter('plots-fill', flt); map.setFilter('plots-line', flt);
      map.setPaintProperty('plots-fill', 'fill-color', plotColorExpr(s.plotColorBy));
    }
    const onStatus = Object.entries(f.millStatus).filter(([, v]) => v).map(([k]) => k);
    if (map.getLayer('mills-pt')) {
      const flt = ['in', ['get', 'status'], ['literal', onStatus]];
      map.setFilter('mills-pt', flt); map.setFilter('mills-label', flt);
    }
  }

  async function setActiveMill(millId) {
    if (millId === activeMill) return;
    activeMill = millId;
    if (!millId) { map.getSource('plots')?.setData({ type: 'FeatureCollection', features: [] }); return; }
    const fc = await adapter.getPlotsForMill(millId);
    if (activeMill !== millId) return;   // selection changed while loading — drop this stale result
    fc.features.forEach(ft => plotMill.set(ft.properties.id, millId));
    map.getSource('plots')?.setData(fc);
    const b = new maplibregl.LngLatBounds();
    fc.features.forEach(ft => eachCoord(ft.geometry, (x, y) => b.extend([x, y])));
    if (!b.isEmpty()) map.fitBounds(b, { padding: 60, maxZoom: 14, duration: 700 });
  }

  function setSel(sel, on) {
    const src = sel.type === 'mill' ? 'mills' : sel.type === 'plot' ? 'plots' : null;
    if (src && map.getSource(src)) { try { map.setFeatureState({ source: src, id: sel.id }, { sel: on }); } catch {} }
  }

  function react(s) {
    const desiredMill = s.selection?.type === 'mill' ? s.selection.id
      : s.selection?.type === 'plot' ? (plotMill.get(s.selection.id) || activeMill) : null;
    setActiveMill(desiredMill);
    if (lastSel) setSel(lastSel, false);
    if (s.selection) setSel(s.selection, true);
    lastSel = s.selection;
  }

  map.on('load', () => {
    addLayers();
    map.resize();
    // center on this chain's spread (centroid of its mills)
    try {
      const b = new maplibregl.LngLatBounds();
      let any = false;
      adapter.getMills().features.forEach(f => { if (f.geometry) { b.extend(f.geometry.coordinates); any = true; } });
      if (any) map.fitBounds(b, { padding: 70, maxZoom: 10, duration: 0 });
    } catch {}
    offs.push(store.subscribe((s) => {
      if (s.basemap !== currentBasemap) {
        currentBasemap = s.basemap; map.setStyle(config.map.basemaps[s.basemap]);
        map.once('idle', () => { addLayers(); const m = activeMill; activeMill = null; if (m) setActiveMill(m); });
        return;
      }
      applyFilters(s); react(s);
    }));
  });

  return function destroy() { offs.forEach(o => o()); map.remove(); };
}

function eachCoord(geom, cb) {
  const walk = (a) => Array.isArray(a) && typeof a[0] === 'number' ? cb(a[0], a[1]) : a?.forEach?.(walk);
  if (geom) walk(geom.coordinates);
}
