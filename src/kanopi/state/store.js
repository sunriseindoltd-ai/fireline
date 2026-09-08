// @ts-nocheck
// src/state/store.js — shared pub/sub state. Every view reacts to this.
// state: { selection:{type,id}|null, filters:{...}, basemap, plotColorBy }
export function createStore(initial = {}) {
  let state = {
    selection: null,
    filters: {
      traceability: { village: true, mill_buffer: true },
      plotType: { company: true, scheme_smallholder: true, independent_smallholder: true, unknown: true },
      eudrNonComplyOnly: false,
      millStatus: { active: true, retired: true },
    },
    basemap: 'hybrid',
    plotColorBy: 'plot_type',   // 'plot_type' | 'traceability_level' | 'eudr'
    ...initial,
  };
  const subs = new Set();
  const get = () => state;
  const notify = () => subs.forEach(fn => fn(state));
  const set = (patch) => { state = { ...state, ...patch }; notify(); };
  const update = (fn) => set(fn(state));
  const subscribe = (fn) => { subs.add(fn); fn(state); return () => subs.delete(fn); };
  const toggleSelection = (type, id) => {
    const c = state.selection;
    set({ selection: c && c.type === type && c.id === id ? null : { type, id } });
  };
  return { get, set, update, subscribe, toggleSelection };
}
