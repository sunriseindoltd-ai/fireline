// @ts-nocheck
// src/views/signals/SignalsView.js — news & grievance signals for a chain (via GDELT).
// Runs locally but queries the internet (localhost is allowed to) — no DB, no hosting.
import { config } from '../../config.js';
const GRIEVANCE = 'deforestation OR "land conflict" OR "land grab" OR "forced labor" OR "human rights" OR fire';

export async function mount(root, ctx) {
  const id = ctx.projectId;
  let reg = [];
  try { reg = await (await fetch(`${config.dataBaseUrl}/${config.overview.projects}`)).json(); } catch {}
  const entry = reg.find(p => p.id === id);
  const name = entry?.name || id;

  // top mills of this chain for quick queries
  let mills = [];
  try {
    const agg = await (await fetch(`${config.dataBaseUrl}/${config.projectFiles(id).aggregates}`)).json();
    mills = Object.values(agg.by_mill || {}).map(m => m.name).filter(Boolean).slice(0, 8);
  } catch {}

  const defaultQ = `"${name}" palm oil (${GRIEVANCE})`;
  root.className = 'shell-scroll';
  root.innerHTML = `
    <div class="signals">
      <div class="dash-head"><div><div class="dp-eyebrow">${name}</div><h1 class="dash-title">Signals</h1>
        <div class="dp-note">Recent news & grievance signals from open sources (GDELT, last 6 months).</div></div></div>
      <div class="sig-bar">
        <input class="sig-q" value="${defaultQ.replace(/"/g, '&quot;')}">
        <button class="btn sig-go">Search</button>
      </div>
      ${mills.length ? `<div class="sig-quick"><span class="src">Quick:</span>
        ${mills.map(m => `<button class="chip soft sig-mill" data-q='"${m}" palm oil (${GRIEVANCE})'>${m}</button>`).join('')}</div>` : ''}
      <div class="sig-status src"></div>
      <div class="sig-results"></div>
    </div>`;
  const q = s => root.querySelector(s);

  async function search(query) {
    q('.sig-q').value = query;
    q('.sig-status').textContent = 'Searching open sources…'; q('.sig-results').innerHTML = '';
    try {
      const r = await (await fetch(`/api/signals?q=${encodeURIComponent(query)}`)).json();
      if (!r.ok) throw new Error(r.error || 'search failed');
      if (!r.articles.length) { q('.sig-status').textContent = 'No recent articles found for this query.'; return; }
      q('.sig-status').textContent = `${r.count} article(s), newest first`;
      q('.sig-results').innerHTML = r.articles.map(a => {
        const d = (a.date || '').replace(/^(\d{4})(\d{2})(\d{2}).*/, '$1-$2-$3');
        return `<a class="sig-card" href="${a.url}" target="_blank" rel="noopener">
          ${a.image ? `<div class="sig-img" style="background-image:url('${a.image}')"></div>` : '<div class="sig-img none"></div>'}
          <div class="sig-body"><div class="sig-title">${esc(a.title || '(untitled)')}</div>
            <div class="sig-meta">${esc(a.domain || '')} · ${d}${a.country ? ' · ' + esc(a.country) : ''}</div></div></a>`;
      }).join('');
    } catch (e) {
      q('.sig-status').innerHTML = `<span class="up-err">✕ ${esc(e.message)}</span> — needs the local dev server and an internet connection.`;
    }
  }
  q('.sig-go').onclick = () => search(q('.sig-q').value);
  q('.sig-q').addEventListener('keydown', e => { if (e.key === 'Enter') search(q('.sig-q').value); });
  root.querySelectorAll('.sig-mill').forEach(b => b.onclick = () => search(b.dataset.q));
  search(defaultQ);
  return () => { root.innerHTML = ''; };
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
