// @ts-nocheck
// src/data/FileDataAdapter.js — per-project detail data; lazy plots per mill.
import { DataAdapter } from './DataAdapter.js';
export class FileDataAdapter extends DataAdapter {
  constructor(config, manifest) {
    super();
    this.config = config; this.m = manifest;
    this.nodes = new Map(); this._plotCache = new Map();
  }
  async _json(rel) {
    const r = await fetch(`${this.config.dataBaseUrl}/${rel}`);
    if (!r.ok) throw new Error(`load ${rel}: ${r.status}`);
    return r.json();
  }
  async load() {
    const m = this.m;
    const [groups, companies, villages, mills, facilities, areas, aggregates] = await Promise.all([
      this._json(m.groups), this._json(m.companies), this._json(m.villages),
      this._json(m.mills), this._json(m.facilities), this._json(m.areas), this._json(m.aggregates),
    ]);
    this.raw = { mills, areas, facilities, aggregates };
    const addList = (t, l) => l.forEach(o => this.nodes.set(`${t}:${o.id}`, { type: t, ...o }));
    const addFC = (t, fc) => fc.features.forEach(ft => this.nodes.set(`${t}:${ft.properties.id}`,
      { type: t, ...ft.properties, geometry: ft.geometry }));
    addList('group', groups); addList('company', companies); addList('village', villages);
    addFC('mill', mills); addFC('facility', facilities);
    return this;
  }
  getAggregates() { return this.raw.aggregates; }
  getMills() { return this.raw.mills; }
  getAreas() { return this.raw.areas; }
  getFacility() { return this.raw.facilities.features[0]?.properties ?? null; }
  getNode(type, id) { return this.nodes.get(`${type}:${id}`) ?? null; }
  async getPlotsForMill(millId) {
    if (this._plotCache.has(millId)) return this._plotCache.get(millId);
    let fc;
    try { fc = await this._json(this.m.plotsByMill(millId)); }
    catch { fc = { type: 'FeatureCollection', features: [] }; }
    this._plotCache.set(millId, fc);
    return fc;
  }
}
