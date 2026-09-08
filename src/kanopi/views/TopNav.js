// @ts-nocheck
// src/views/TopNav.js — global header nav: portfolio + project switcher.
import { config } from '../config.js';
import { openUploadModal } from './UploadModal.js';
import { openCoverageModal } from './CoverageModal.js';
export async function mount(container, router) {
  let projects = [];
  try { projects = await (await fetch(`${config.dataBaseUrl}/${config.overview.projects}`)).json(); }
  catch {}
  projects.sort((a, b) => b.mill_count - a.mill_count);

  container.innerHTML = `
    <div class="brand" data-home><span class="mark"></span> Kanopi</div>
    <nav class="nav">
      <button class="nav-home" data-home>Portfolio</button>
      <div class="nav-sel">
        <select class="proj-select">
          <option value="">Open a supply chain…</option>
          ${projects.map(p => `<option value="${p.id}">${p.name}${p.has_detail ? '' : ' (facility only)'} · ${p.mill_count} mills</option>`).join('')}
        </select>
      </div>
    </nav>
    <div class="nav-spacer"></div>
    ${import.meta.env.DEV ? '<button class="nav-upload" title="Local upload (dev)">↑ Upload data</button>' : ''}`;

  container.querySelectorAll('[data-home]').forEach(el => el.addEventListener('click', () => router.go('#/')));
  container.querySelector('.nav-upload')?.addEventListener('click', () => openUploadModal(router));
  const up = container.querySelector('.nav-upload');
  if (up) up.addEventListener('click', () => {
    const c = router.current(); openUploadModal(c.name === 'project' ? c.projectId : undefined);
  });
  const cov = container.querySelector('.nav-coverage');
  if (cov) cov.addEventListener('click', () => {
    const c = router.current(); openCoverageModal(c.name === 'project' ? c.projectId : undefined);
  });
  const sel = container.querySelector('.proj-select');
  sel.addEventListener('change', () => { if (sel.value) router.go(`#/project/${sel.value}`); });

  // reflect current route in the select
  function sync() { const c = router.current(); sel.value = c.name === 'project' ? c.projectId : ''; 
    container.querySelector('.nav-home').classList.toggle('on', c.name === 'home'); }
  window.addEventListener('hashchange', sync); sync();
  return { sync };
}
