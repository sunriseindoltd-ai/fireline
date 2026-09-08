// @ts-nocheck
// src/views/TakedownModal.js — exclude ("take down") plots by rule, or restore (dev).
import { config } from '../config.js';

const RULES = [
  { id: 'noncomply', label: 'Non-compliant', desc: 'EUDR_Comply = NO' },
  { id: 'deforestation', label: 'Post-2020 deforestation', desc: 'any detected change after cut-off' },
  { id: 'protected_forest', label: 'Protected forest (HL)', desc: 'overlap with Hutan Lindung' },
  { id: 'natural_forest', label: 'Natural / JRC forest', desc: 'overlap with forest cover' },
];

export async function openTakedownModal(defaultProject) {
  let projects = [];
  try { projects = await (await fetch(`${config.dataBaseUrl}/${config.overview.projects}`)).json(); } catch {}
  projects = projects.filter(p => p.has_detail).sort((a, b) => a.name.localeCompare(b.name));

  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.innerHTML = `
    <div class="modal wide">
      <div class="modal-head"><h3>Take down plots</h3><button class="modal-x">&times;</button></div>
      <div class="modal-body">
        <label class="fld">Supply chain
          <select class="td-project">${projects.map(p => `<option value="${p.id}" ${p.id === defaultProject ? 'selected' : ''}>${p.name}</option>`).join('')}</select></label>
        <p class="up-hint">Taking down a plot removes it from the active supply base and from exports.
          It's reversible — restore any time. Aggregates, dashboard and report update automatically.</p>
        <div class="td-summary"></div>
        <div class="td-rules"></div>
        <div class="td-status"></div>
      </div>
      <div class="modal-foot">
        <button class="btn ghost td-restore">Restore all</button>
        <button class="btn ghost modal-cancel">Close</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const q = s => ov.querySelector(s);
  const close = () => ov.remove();
  q('.modal-x').onclick = close; q('.modal-cancel').onclick = close;
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  const sel = q('.td-project'); sel.onchange = () => load(sel.value);
  const nf = n => (n || 0).toLocaleString('en-US');

  async function load(project) {
    q('.td-rules').innerHTML = '<div class="src">Counting…</div>';
    let agg = {};
    try { agg = await (await fetch(`${config.dataBaseUrl}/projects/${project}/analysis/aggregates.json`)).json(); } catch {}
    const active = agg.totals?.plot_count || 0, exc = agg.excluded?.count || 0;
    q('.td-summary').innerHTML = `<div class="td-sum"><b>${nf(active)}</b> active plots · <b>${nf(exc)}</b> taken down (${nf(Math.round(agg.excluded?.area_ha || 0))} ha)</div>`;
    // preview counts per rule (dry-run)
    const counts = await Promise.all(RULES.map(r =>
      fetch('/api/manage/exclude', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, rule: r.id, dryRun: true }) })
        .then(x => x.json()).then(x => x.would_affect ?? 0).catch(() => 0)));
    q('.td-rules').innerHTML = RULES.map((r, i) => `
      <div class="td-rule">
        <div class="td-rule-info"><b>${r.label}</b><div class="src">${r.desc}</div></div>
        <div class="td-rule-n">${nf(counts[i])} plots</div>
        <button class="btn ${counts[i] ? '' : 'ghost'} td-apply" data-rule="${r.id}" ${counts[i] ? '' : 'disabled'}>Take down</button>
      </div>`).join('');
    q('.td-rules').querySelectorAll('.td-apply').forEach(b => b.onclick = () => apply(project, b.dataset.rule));
  }

  async function apply(project, rule) {
    if (!confirm(`Take down all plots matching "${rule}" in ${project}? (reversible)`)) return;
    q('.td-status').textContent = 'Applying…';
    const r = await (await fetch('/api/manage/exclude', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, rule }) })).json();
    if (r.ok) { q('.td-status').innerHTML = `<div class="up-ok">✓ Took down ${nf(r.affected)} plots · ${nf(r.active_plots)} active left</div>`; load(project); }
    else q('.td-status').innerHTML = `<div class="up-err">✕ ${r.error || 'failed'}</div>`;
  }
  q('.td-restore').onclick = async () => {
    const project = sel.value;
    if (!confirm(`Restore ALL taken-down plots in ${project}?`)) return;
    const r = await (await fetch('/api/manage/exclude', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, restore: true }) })).json();
    if (r.ok) { q('.td-status').innerHTML = `<div class="up-ok">✓ Restored ${nf(r.affected)} plots</div>`; load(project); }
    else q('.td-status').innerHTML = `<div class="up-err">✕ ${r.error || 'failed'}</div>`;
  };
  if (sel.value) load(sel.value); else q('.td-rules').innerHTML = '<div class="src">No chain with data yet.</div>';
}
