// @ts-nocheck
// src/views/dashboard/charts.js — tiny dependency-free SVG chart helpers (return strings).
const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
export const fmt = (n) => (n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
export const fmt1 = (n) => (n || 0).toLocaleString('en-US', { maximumFractionDigits: 1 });

// donut: segments [{label,value,color}]
export function donut(segments, { size = 150, thickness = 26, center } = {}) {
  const total = segments.reduce((s, d) => s + d.value, 0) || 1;
  const r = (size - thickness) / 2, cx = size / 2, cy = size / 2, C = 2 * Math.PI * r;
  let off = 0;
  const rings = segments.filter(s => s.value > 0).map(s => {
    const len = s.value / total * C;
    const el = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${thickness}"
      stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 ${cx} ${cy})"/>`;
    off += len; return el;
  }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" class="donut">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${thickness}"/>
    ${rings}
    ${center ? `<text x="${cx}" y="${cy - 2}" text-anchor="middle" class="donut-n">${esc(center.top)}</text>
      <text x="${cx}" y="${cy + 14}" text-anchor="middle" class="donut-l">${esc(center.bottom)}</text>` : ''}
  </svg>`;
}

// horizontal bars: rows [{label,value,color,sub}]
export function hbars(rows, { fmt: f = fmt, max } = {}) {
  const m = max ?? Math.max(1, ...rows.map(r => r.value));
  return `<div class="hbars">${rows.map(r => `
    <div class="hbar-row">
      <div class="hbar-label">${esc(r.label)}</div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${(r.value / m * 100).toFixed(1)}%;background:${r.color || 'var(--village)'}"></div></div>
      <div class="hbar-val">${f(r.value)}${r.sub ? `<span class="src"> ${esc(r.sub)}</span>` : ''}</div>
    </div>`).join('')}</div>`;
}

// stacked single bar: segments [{label,value,color}]
export function stackedBar(segments, { fmt: f = fmt } = {}) {
  const total = segments.reduce((s, d) => s + d.value, 0) || 1;
  const bar = segments.filter(s => s.value > 0).map(s =>
    `<div class="sb-seg" style="width:${(s.value / total * 100).toFixed(2)}%;background:${s.color}" title="${esc(s.label)}: ${f(s.value)}"></div>`).join('');
  const legend = segments.map(s => `<span class="sb-leg"><i style="background:${s.color}"></i>${esc(s.label)} <b>${f(s.value)}</b></span>`).join('');
  return `<div class="stacked"><div class="sb-bar">${bar}</div><div class="sb-legend">${legend}</div></div>`;
}

// mini column chart for yearly values: rows [{label,value}]
export function columns(rows, { color = 'var(--high)', fmt: f = fmt1, unit = '' } = {}) {
  const m = Math.max(1, ...rows.map(r => r.value));
  return `<div class="cols">${rows.map(r => `
    <div class="col"><div class="col-bar" style="height:${Math.max(2, r.value / m * 100)}%;background:${color}"></div>
      <div class="col-v">${r.value ? f(r.value) + unit : ''}</div><div class="col-l">${esc(r.label)}</div></div>`).join('')}</div>`;
}

export function legendRow(items) {
  return `<div class="chart-legend">${items.map(i => `<span><i style="background:${i.color}"></i>${esc(i.label)}${i.value != null ? ` <b>${i.value}</b>` : ''}</span>`).join('')}</div>`;
}
