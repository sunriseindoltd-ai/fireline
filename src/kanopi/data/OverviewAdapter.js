// @ts-nocheck
// src/data/OverviewAdapter.js — cross-project facility data (home page).
export class OverviewAdapter {
  constructor(config) { this.config = config; }
  async _json(rel) {
    const r = await fetch(`${this.config.dataBaseUrl}/${rel}`);
    if (!r.ok) throw new Error(`load ${rel}: ${r.status}`);
    return r.json();
  }
  async load() {
    const o = this.config.overview;
    const [projects, refineries, mills, flows, aggregates] = await Promise.all([
      this._json(o.projects), this._json(o.refineries), this._json(o.mills),
      this._json(o.flows), this._json(o.aggregates),
    ]);
    let ports = { type: 'FeatureCollection', features: [] };
    let portsRef = { type: 'FeatureCollection', features: [] };
    try { ports = await this._json(o.ports); } catch {}
    try { portsRef = await this._json(o.portsReference); } catch {}
    let routes = { type: 'FeatureCollection', features: [] };
    try { routes = await this._json(o.routes); } catch {}
    Object.assign(this, { projects, refineries, mills, flows, aggregates, ports, portsRef, routes });
    return this;
  }
  getProjects() { return this.projects; }
  getRefineries() { return this.refineries; }
  getMills() { return this.mills; }
  getFlows() { return this.flows; }
  getAggregates() { return this.aggregates; }
  getPorts() { return this.ports; }
  getPortsReference() { return this.portsRef; }
  getRoutes() { return this.routes; }
}
