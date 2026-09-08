// @ts-nocheck
// src/views/Legend.js — reflects the live plot color encoding (reacts to plotColorBy).
import { config } from '../config.js';
const C = config.color;

export function mount(container, store) {
  const dot = (c) => `<span class="dot" style="background:${c}"></span>`;
  function render(s) {
    const by = s.plotColorBy || 'plot_type';
    let plots = '';
    if (by === 'plot_type') plots = Object.values(config.plotTypes).map(m => `${dot(m.color)}${m.label}`).join('<br>');
    else if (by === 'traceability_level') plots = `${dot(C.village)}TTV (village)<br>${dot(C.millBuffer)}TTM (buffer)`;
    else if (by === 'eudr') plots = `${dot(C.village)}Comply<br>${dot(C.risk)}Non-comply`;
    else if (by === 'risk') plots = [
      ['A', 'Ready to submit'], ['B', 'Submit + monitor'], ['C', 'Verify first'],
      ['D', 'Data gaps'], ['E', 'Mitigate'], ['F', 'Exclude']]
      .map(([c, meaning]) => `${dot(C.riskCat[c])}<b>${c}</b> · ${meaning}`).join('<br>');
    else if (by === 'deforestation') plots = `${dot(C.high)}Post-2020 change<br>${dot('#cbd8cc')}No change`;
    const label = { plot_type: 'Plot type', traceability_level: 'Traceability', eudr: 'EUDR status', risk: 'Risk category', deforestation: 'Deforestation' }[by];
    container.innerHTML = `
      <h4>Legend</h4>
      <div class="lg-group"><div class="lg-t">Plots — ${label}</div>${plots}</div>
      <div class="lg-group"><div class="lg-t">Traceability area</div>
        ${dot(C.village)}TTV &nbsp; ${dot(C.millBuffer)}TTM</div>
      <div class="lg-group"><div class="lg-t">Mill</div>
        ${dot(C.mill)}Active &nbsp; ${dot(C.millRetired)}Retired</div>`;
  }
  render(store.get());
  let last = store.get().plotColorBy;
  const off = store.subscribe((s) => { if (s.plotColorBy !== last) { last = s.plotColorBy; render(s); } });
  return function destroy() { off?.(); container.innerHTML = ''; };
}
