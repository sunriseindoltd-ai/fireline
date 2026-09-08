// @ts-nocheck
// src/views/MillSearch.js — searchable mill picker for the project page.
// Lists mills (sorted by area) with a search box; selecting one drives the store.
export function mount(container, store, adapter) {
  const agg = adapter.getAggregates();
  const mills = Object.entries(agg.by_mill).map(([id, m]) => ({ id, name: m.name, area: m.area_ha, plots: m.plot_count }))
    .sort((a, b) => b.area - a.area);

  container.innerHTML = `
    <h4>Find a mill</h4>
    <input class="mill-search" type="search" placeholder="Search ${mills.length} mills…" autocomplete="off">
    <ul class="mill-list"></ul>`;
  const input = container.querySelector('.mill-search');
  const list = container.querySelector('.mill-list');

  function draw(q, selId) {
    const f = q.trim().toLowerCase();
    const rows = mills.filter(m => !f || m.name.toLowerCase().includes(f)).slice(0, 200);
    list.innerHTML = rows.map(m =>
      `<li class="${m.id === selId ? 'on' : ''}" data-id="${m.id}">
        <span class="ml-name">${m.name}</span>
        <span class="ml-meta">${Math.round(m.area).toLocaleString('en-US')} ha · ${m.plots.toLocaleString('en-US')}</span></li>`).join('')
      || `<li class="ml-empty">No mill matches “${q}”.</li>`;
  }
  draw('', null);

  input.addEventListener('input', () => draw(input.value, store.get().selection?.id));
  list.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]'); if (!li) return;
    store.toggleSelection('mill', li.dataset.id);
  });
  const off = store.subscribe(s => {
    const selId = (s.selection?.type === 'mill') ? s.selection.id
      : (s.selection?.type === 'plot') ? null : null;
    list.querySelectorAll('li[data-id]').forEach(li => li.classList.toggle('on', li.dataset.id === selId));
  });
  return function destroy() { off(); container.innerHTML = ''; };
}
