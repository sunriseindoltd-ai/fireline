// @ts-nocheck
// src/config.js — single source of truth: routes, data manifests, design tokens.
export const config = {
  dataSource: 'file',
  dataBaseUrl: (import.meta.env.BASE_URL || '/') + 'data',

  // ---- OVERVIEW (home page) data ----
  overview: {
    projects:   'overview/projects.json',
    refineries: 'overview/refineries.geojson',
    mills:      'overview/mills.geojson',
    flows:      'overview/flows.json',
    aggregates: 'overview/aggregates.json',
    ports:      'overview/ports.geojson',
    portsReference: 'overview/ports_reference.geojson',
    routes:     'overview/routes.geojson',
  },

  // Generic per-project manifest. Files live under data/projects/<id>/.
  projectFiles(projectId) {
    const b = `projects/${projectId}`;
    return {
      groups: `${b}/entities/groups.json`, companies: `${b}/entities/companies.json`,
      villages: `${b}/entities/villages.json`, mills: `${b}/entities/mills.geojson`,
      facilities: `${b}/entities/facilities.geojson`, areas: `${b}/areas/traceability_areas.geojson`,
      aggregates: `${b}/analysis/aggregates.json`,
      plotsByMill: (millId) => `${b}/plots/by_mill/${millId}.geojson`,
    };
  },

  volume: {
    ffbPerHaYear: 20,
    oerCPO: 0.20,
    kernelRate: 0.05,
    pkoFromKernel: 0.45,
    pkeFromKernel: 0.55,
  },

  color: {
    ink: '#16241c', paper: '#e9ebe6', panel: '#f5f7f2', line: '#d2d8cc', muted: '#5d6b60',
    village: '#2fbf6e', millBuffer: '#f4a92b', facility: '#2f7fb0',
    mill: '#ffb12e', millRetired: '#b9c0b6', risk: '#ff4d3d',
    millUniform: '#f0c674', route: 'rgba(230,238,255,0.55)',
    refinery: '#2f7fb0',
    ok: '#2f9e5f', low: '#2f9e5f', medium: '#e0952b', high: '#d84a3b', comply: '#2f9e5f', noncomply: '#d84a3b',
    riskCat: { A: '#2f9e5f', B: '#8ac540', C: '#e6c020', D: '#e0952b', E: '#e2622e', F: '#d84a3b' },
    projects: ['#2fbf6e','#f4a92b','#2f7fb0','#b66cff','#ff6f59','#36c5c0','#e6b800','#7e57c2','#26a269','#d96bb0','#8aa31a'],
  },
  plotTypes: {
    company:                 { label: 'Perusahaan',              color: '#1f9e63' },
    scheme_smallholder:      { label: 'Plasma',                  color: '#5fd07a' },
    independent_smallholder: { label: 'Petani swadaya',          color: '#b7e04a' },
    unknown:                 { label: 'Belum diklasifikasi',     color: '#d0d4d6' },
  },
  traceabilityLevels: {
    village:     { label: 'Tertelusur ke desa', short: 'TTV', color: '#2fbf6e' },
    mill_buffer: { label: 'Buffer pabrik',      short: 'TTM', color: '#f4a92b' },
  },
  overlapLayers: {
    jrc_gfc2020_v3:    { label: 'JRC Forest Cover 2020 v3', asset: 'JRC/GFC2020/V3' },
    sbtn_natural_v1_1: { label: 'SBTN Natural Lands v1.1',  asset: 'WRI/SBTN/naturalLands/v1_1/2020' },
  },

  map: {
    center: [112, 0.5], zoom: 4.1,
    projectCenter: [104.4, -2.6], projectZoom: 8.2,
    millLabelMinZoom: 8.5,
    overlays: {
      kwshutan: {
        tiles: ['https://geoportal.planologi.kehutanan.go.id/server/rest/services/Peta_Interaktif_2026/KWSHUTAN_AR_250K/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&dpi=96&format=png32&transparent=true&f=image'],
        attribution: 'Kawasan Hutan © KLHK (2025)',
      },
    },
    basemaps: {
      hybrid: { version: 8,
        sources: {
          sat: { type: 'raster', tileSize: 256,
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            attribution: 'Imagery © Esri' },
          trans: { type: 'raster', tileSize: 256,
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'] },
          ref: { type: 'raster', tileSize: 256,
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'] },
        },
        layers: [
          { id: 'sat', type: 'raster', source: 'sat' },
          { id: 'trans', type: 'raster', source: 'trans', paint: { 'raster-opacity': 0.9 } },
          { id: 'ref', type: 'raster', source: 'ref' },
        ],
        glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf' },
      satellite: { version: 8,
        sources: { sat: { type: 'raster', tileSize: 256,
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          attribution: 'Imagery © Esri' } },
        layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
        glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf' },
      streets: { version: 8,
        sources: { carto: { type: 'raster', tileSize: 256,
          tiles: ['https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'],
          attribution: '© OpenStreetMap, © CARTO' } },
        layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
        glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf' },
    },
  },
};

export function estimateVolumes(areaHa, v = config.volume) {
  const ffb = areaHa * v.ffbPerHaYear;
  const kernel = ffb * v.kernelRate;
  return { ffb, cpo: ffb * v.oerCPO, pko: kernel * v.pkoFromKernel, pke: kernel * v.pkeFromKernel };
}
