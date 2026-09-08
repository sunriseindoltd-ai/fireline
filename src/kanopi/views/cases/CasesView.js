// @ts-nocheck
// src/views/cases/CasesView.js — mitigation case tracker (admin writes; reads published cases.json).
import { config } from '../../config.js';
import { isAdmin } from '../../state/session.js';
const STATUS = { open: ['Open', '#e0952b'], investigating: ['Investigating', '#2f7fb0'], resolved: ['Resolved', '#2f9e5f'], excluded: ['Excluded', '#d84a3b'] };

export async function mount(root, ctx) {
  const id = ctx.projectId;
  let reg = [];
  try { reg = await (await fetch(`${config.dataBaseUrl}/${config.overview.projects}`)).json(); } catch {}
  const entry = reg.find(p => p.id === id);
  if (!entry?.has_detail) { const { mount: pm } = await import('../project/ProjectView.js'); return pm(root, ctx); }

  let cases = [];
  try { cases = await (await fetch(`${config.dataBaseUrl}/projects/${id}/cases.json`)).json(); } catch {}
  const dev = isAdmin();

  root.className = 'shell-scroll';
  function render() {
    const counts = Object.keys(STATUS).map(k => [k, cases.filter(c => c.status === k).length]);
    root.innerHTML = `
      <div class="cases">
        <div class="dash-head"><div><div class="dp-eyebrow">${entry.name}</div><h1 class="dash-title">Cases</h1>
          <div class="dp-note">${cases.length} case(s) · ${counts.map(([k, n]) => `${STATUS[k][0]} ${n}`).join(' · ')}</div></div>
          ${dev ? '<button class="btn" data-new>+ New case</button>' : ''}</div>
        ${cases.length ? `<div class="case-list">${cases.map(caseCard).join('')}</div>`
          : '<div class="card"><div class="src">No cases yet. Open one from a taken-down plot, or create a new case to track a mitigation.</div></div>'}
      </div>`;
    root.querySelector('[data-new]')?.addEventListener('click', () => edit({ status: 'open', title: '', note: '', plot_ids: [] }));
    root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => edit(cases.find(c => c.id === b.dataset.edit)));
    root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => del(b.dataset.del));
    root.querySelectorAll('[data-adv]').forEach(b => b.onclick = () => advance(cases.find(c => c.id === b.dataset.adv)));
  }
  function caseCard(c) {
    const [label, color] = STATUS[c.status] || STATUS.open;
    const order = ['open', 'investigating', 'resolved'];
    const next = order[order.indexOf(c.status) + 1];
    return `<div class="case">
      <div class="case-top"><span class="case-status" style="background:${color}1a;color:${color}">${label}</span>
        <b>${esc(c.title) || 'Untitled case'}</b>
        <span class="src">${(c.updated || '').slice(0, 10)}</span></div>
      ${c.note ? `<div class="case-note">${esc(c.note)}</div>` : ''}
      <div class="case-meta">${c.plot_ids?.length ? `<span class="mono">${c.plot_ids.length} plot(s)</span>` : ''}
        ${c.reason ? `<span class="chip soft">${esc(c.reason)}</span>` : ''}</div>
      ${dev ? `<div class="case-actions">
        ${next ? `<button class="btn ghost sm" data-adv="${c.id}">→ ${STATUS[next][0]}</button>` : ''}
        <button class="btn ghost sm" data-edit="${c.id}">Edit</button>
        <button class="btn ghost sm" data-del="${c.id}">Delete</button></div>` : ''}
    </div>`;
  }
  async function save(item) { const r = await (await fetch('/api/cases/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: id, item }) })).json(); if (r.ok) { cases = r.cases; render(); } }
  async function del(cid) { if (!confirm('Delete this case?')) return; const r = await (await fetch('/api/cases/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: id, id: cid }) })).json(); if (r.ok) { cases = r.cases; render(); } }
  function advance(c) { const order = ['open', 'investigating', 'resolved']; const n = order[order.indexOf(c.status) + 1]; if (n) save({ ...c, status: n }); }
  function edit(c) {
    const ov = document.createElement('div'); ov.className = 'modal-overlay';
    ov.innerHTML = `<div class="modal"><div class="modal-head"><h3>${c.id ? 'Edit case' : 'New case'}</h3><button class="modal-x">&times;</button></div>
      <div class="modal-body">
        <label class="fld">Title<input class="ce-title" value="${esc(c.title || '')}" style="text-transform:none"></label>
        <label class="fld">Status<select class="ce-status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${c.status === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></label>
        <label class="fld">Note<textarea class="ce-note" rows="4" style="text-transform:none">${esc(c.note || '')}</textarea></label>
        ${c.plot_ids?.length ? `<div class="src">${c.plot_ids.length} linked plot(s)</div>` : ''}
      </div><div class="modal-foot"><button class="btn ghost modal-cancel">Cancel</button><button class="btn ce-save">Save</button></div></div>`;
    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.querySelector('.modal-x').onclick = close; ov.querySelector('.modal-cancel').onclick = close;
    ov.querySelector('.ce-save').onclick = () => { save({ ...c, title: ov.querySelector('.ce-title').value, status: ov.querySelector('.ce-status').value, note: ov.querySelector('.ce-note').value }); close(); };
  }
  render();
  return () => { root.innerHTML = ''; };
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
