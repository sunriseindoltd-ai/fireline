// @ts-nocheck
// src/views/FilterPanel.js — controls that write to the store only.
import { config } from '../config.js';

export function mount(container, store) {
  const s0 = store.get();
  container.innerHTML = `
    <div class="ctl">
      <h4>Color plots by</h4>
      <div class="seg wrap" data-seg="plotColorBy">
        <button data-v="plot_type" class="seg-on">Type</button>
        <button data-v="traceability_level">Trace</button>
        <button data-v="eudr">EUDR</button>
        <button data-v="risk">Risk</button>
        <button data-v="deforestation">Defo</button>
      </div>
    </div>
    <div class="ctl">
      <h4>Traceability</h4>
      ${Object.entries(config.traceabilityLevels).map(([k, m]) =>
        `<label class="chk"><input type="checkbox" data-trace="${k}" checked>
          <span class="swatch" style="background:${m.color}"></span>${m.label} <em>${m.short}</em></label>`).join('')}
    </div>
    <div class="ctl">
      <h4>Plot type</h4>
      ${Object.entries(config.plotTypes).map(([k, m]) =>
        `<label class="chk"><input type="checkbox" data-ptype="${k}" checked>
          <span class="swatch" style="background:${m.color}"></span>${m.label}</label>`).join('')}
    </div>
    <div class="ctl">
      <h4>Screening</h4>
      <label class="chk"><input type="checkbox" data-eudr> <span class="swatch" style="background:${config.color.risk}"></span>EUDR-flagged only</label>
    </div>
    <div class="ctl">
      <h4>Mill status</h4>
      <label class="chk"><input type="checkbox" data-mstatus="active" checked> Active</label>
      <label class="chk"><input type="checkbox" data-mstatus="retired" checked> Retired</label>
    </div>`;

  // segmented controls
  container.querySelectorAll('[data-seg]').forEach(seg => {
    seg.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach(b => b.classList.remove('seg-on'));
      btn.classList.add('seg-on');
      const key = seg.dataset.seg, v = btn.dataset.v;
      store.set(key === 'basemap' ? { basemap: v } : { plotColorBy: v });
    }));
  });
  const set = (path, fn) => store.update(s => fn(structuredClone(s)));
  container.querySelectorAll('[data-trace]').forEach(el => el.addEventListener('change', () =>
    set('', s => { s.filters.traceability[el.dataset.trace] = el.checked; return { filters: s.filters }; })));
  container.querySelectorAll('[data-ptype]').forEach(el => el.addEventListener('change', () =>
    set('', s => { s.filters.plotType[el.dataset.ptype] = el.checked; return { filters: s.filters }; })));
  container.querySelector('[data-eudr]').addEventListener('change', (e) =>
    store.update(s => ({ filters: { ...s.filters, eudrNonComplyOnly: e.target.checked } })));
  container.querySelectorAll('[data-mstatus]').forEach(el => el.addEventListener('change', () =>
    set('', s => { s.filters.millStatus[el.dataset.mstatus] = el.checked; return { filters: s.filters }; })));

  // keep plot-type checkboxes in sync when the Sankey toggles a type
  const off = store.subscribe(s => {
    container.querySelectorAll('[data-ptype]').forEach(el => { el.checked = !!s.filters.plotType[el.dataset.ptype]; });
  });
  return function destroy() { off(); container.innerHTML = ''; };
}
