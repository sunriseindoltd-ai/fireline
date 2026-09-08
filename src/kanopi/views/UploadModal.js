// @ts-nocheck
// src/views/UploadModal.js — local upload (dev). Stage → validate → ingest.
import { config } from '../config.js';

export async function openUploadModal(defaultProject) {
  let projects = [];
  try { projects = await (await fetch(`${config.dataBaseUrl}/${config.overview.projects}`)).json(); } catch {}
  projects.sort((a, b) => a.name.localeCompare(b.name));

  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.innerHTML = `
    <div class="modal">
      <div class="modal-head"><h3>Upload plot data</h3><button class="modal-x">&times;</button></div>
      <div class="modal-body">
        <label class="fld">Target supply chain
          <select class="up-project">
            ${projects.map(p => `<option value="${p.id}" ${p.id === defaultProject ? 'selected' : ''}>${p.name}${p.has_detail ? '' : ' · new'}</option>`).join('')}
          </select></label>
        <p class="up-hint">A mill can supply several chains, so files can't pick the chain
          themselves — choose it here. Plots match their mill by the UML in NodeID/PlotID.
          All attributes are preserved. Existing PlotIDs are skipped (safe to re-upload).</p>
        <div class="dropzone"><input type="file" class="up-files" multiple accept=".geojson,.json" hidden>
          <div class="dz-inner">Drag GeoJSON files here or <button class="dz-browse">browse</button>
            <div class="src">.geojson · multiple files · up to ~100 MB each</div></div></div>
        <ul class="up-list"></ul>
        <div class="up-status"></div>
      </div>
      <div class="modal-foot">
        <button class="btn ghost modal-cancel">Cancel</button>
        <button class="btn up-go" disabled>Validate &amp; review</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const q = s => ov.querySelector(s);
  const fileInput = q('.up-files'), list = q('.up-list'), status = q('.up-status'), goBtn = q('.up-go');
  let files = [], session = null, validated = false;
  const close = () => ov.remove();
  q('.modal-x').onclick = close; q('.modal-cancel').onclick = close;
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  q('.dz-browse').onclick = () => fileInput.click();
  const dz = q('.dropzone');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); addFiles(e.dataTransfer.files); });
  fileInput.addEventListener('change', () => addFiles(fileInput.files));

  function resetPhase() { validated = false; goBtn.textContent = 'Validate & review'; goBtn.disabled = files.length === 0; }
  function addFiles(fl) {
    for (const f of fl) {
      if (!/\.(geo)?json$/i.test(f.name) || files.some(x => x.name === f.name)) continue;
      if (f.size > 100 * 1e6) { status.innerHTML = `<div class="up-err">✕ ${f.name} is over 100 MB — split it first.</div>`; continue; }
      files.push(f);
    }
    list.innerHTML = files.map((f, i) => `<li><span>${f.name}</span><span class="src">${(f.size / 1e6).toFixed(1)} MB</span><button class="rm" data-i="${i}">&times;</button></li>`).join('');
    list.querySelectorAll('.rm').forEach(b => b.onclick = () => { files.splice(+b.dataset.i, 1); addFiles([]); });
    resetPhase();
  }

  async function stageAll() {
    session = `s${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    for (let i = 0; i < files.length; i++) {
      status.innerHTML = `Uploading <b>${files[i].name}</b> (${i + 1}/${files.length})…`;
      const r = await fetch(`/api/upload/stage?session=${session}&name=${encodeURIComponent(files[i].name)}`, { method: 'POST', body: files[i] });
      if (!r.ok) throw new Error(`upload failed for ${files[i].name}`);
    }
  }
  const vrow = (label, n, warn) => n ? `<li class="${warn ? 'warn' : ''}"><span>${label}</span><b>${n.toLocaleString()}</b></li>` : '';

  goBtn.onclick = async () => {
    const project = q('.up-project').value;
    goBtn.disabled = true; q('.modal-cancel').disabled = true;
    try {
      if (!validated) {
        await stageAll();
        status.innerHTML = `Validating…`;
        const v = await (await fetch('/api/upload/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, session }) })).json();
        if (!v.ok) throw new Error(v.error || 'validation failed');
        const V = v.validation;
        status.innerHTML = `
          <div class="up-ok">Validation — ${V.features.toLocaleString()} features read</div>
          <ul class="up-result">
            <li><span>Valid plots ready</span><b>${v.plots_parsed.toLocaleString()}</b></li>
            <li><span>Mills touched</span><b>${v.would_touch_mills}</b> (${v.would_add_mills} new)</li>
            <li><span>Area from</span><b>${V.area_source || '—'}</b></li>
            ${V.area_attribute_rejected ? `<li class="warn"><span>⚠ Declared area rejected</span><b>using polygon area</b></li>` : ''}
            ${vrow('Area from geometry', V.area_from_geometry)}
            ${vrow('No area at all', V.area_missing, true)}
            ${vrow('No PlotID (skipped)', V.no_plotid, true)}
            ${vrow('No UML found (skipped)', V.no_uml, true)}
            ${vrow('Invalid geometry', V.invalid_geom, true)}
            ${vrow('Not WGS84 (check CRS)', V.non_wgs84, true)}
            ${v.read_errors?.length ? `<li class="warn"><span>Unreadable files</span><b>${v.read_errors.length}</b></li>` : ''}
          </ul>
          ${v.plots_parsed ? '' : '<div class="up-err">Nothing valid to ingest.</div>'}`;
        validated = true; goBtn.textContent = `Ingest ${v.plots_parsed.toLocaleString()} plots into ${project}`;
        goBtn.disabled = v.plots_parsed === 0; q('.modal-cancel').disabled = false;
        return;
      }
      // commit
      status.innerHTML = `Ingesting into <b>${project}</b>… <span class="src">large uploads (100k+ plots) can take a few minutes — keep this tab open.</span>`;
      const s = await (await fetch('/api/upload/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, session }) })).json();
      if (!s.ok) throw new Error(s.error || 'ingestion failed');
      status.innerHTML = `
        <div class="up-ok">✓ Done — <b>${project}</b></div>
        <ul class="up-result">
          <li><span>Plots added</span><b>${s.plots_added.toLocaleString()}</b></li>
          <li><span>Skipped (already present)</span><b>${s.plots_skipped_dup.toLocaleString()}</b></li>
          <li><span>Mills updated</span><b>${s.mills_updated}</b> (${s.mills_new} new)</li>
          ${s.areas_healed ? `<li><span>Areas from geometry</span><b>${s.areas_healed.toLocaleString()}</b></li>` : ''}
          <li><span>Project total</span><b>${s.total_plots.toLocaleString()} plots · ${Math.round(s.total_area_ha).toLocaleString()} ha</b></li>
        </ul>
        <button class="btn up-reload">Reload to view ${project}</button>`;
      q('.up-reload').onclick = () => { location.hash = `#/project/${project}`; location.reload(); };
    } catch (e) {
      status.innerHTML = `<div class="up-err">✕ ${e.message}</div><div class="src">Dev server running with Python available? On Windows set KANOPI_PYTHON if needed.</div>`;
      goBtn.disabled = false; q('.modal-cancel').disabled = false;
    }
  };
}
