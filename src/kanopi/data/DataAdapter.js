// @ts-nocheck
// src/data/DataAdapter.js — the contract every data source implements.
// Views depend on this, never on fetch() or file paths.
export class DataAdapter {
  async load() { throw new Error('not implemented'); }
  getAggregates() { throw new Error('not implemented'); }     // project + per-mill rollups
  getMills() { throw new Error('not implemented'); }          // GeoJSON points
  getAreas() { throw new Error('not implemented'); }          // GeoJSON polygons (TTV/TTM)
  getFacility() { throw new Error('not implemented'); }       // refinery/KCP node
  getNode(type, id) { throw new Error('not implemented'); }   // mill|company|group|village|facility
  async getPlotsForMill(millId) { throw new Error('not implemented'); }  // lazy geometry
}
