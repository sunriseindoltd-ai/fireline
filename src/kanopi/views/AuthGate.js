// @ts-nocheck
// Demo password gate. Hash lives in config.auth.passwordHash (SHA-256 hex).
// This only hides the UI in the browser — use Cloudflare Access for a real lock.
import { config } from '../config.js';

async function sha256hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function isUnlocked() {
  const a = config.auth;
  if (!a?.enabled) return true;
  try { return sessionStorage.getItem(a.sessionKey) === a.passwordHash; } catch { return false; }
}

export function mount(onUnlock) {
  if (isUnlocked()) { onUnlock(); return; }
  const el = document.createElement('div');
  el.className = 'gate';
  el.innerHTML = `
    <form class="gate-card">
      <div class="sb-brand" style="padding:0"><span class="mark"></span> Kanopi</div>
      <h1>Masuk</h1>
      <p>Pratinjau internal. Masukkan kata sandi bersama.</p>
      <input type="password" name="pw" autocomplete="current-password" placeholder="Kata sandi" />
      <div class="gate-err"></div>
      <button class="btn" type="submit">Lanjut</button>
    </form>`;
  document.body.appendChild(el);
  const form = el.querySelector('form');
  const err = el.querySelector('.gate-err');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const hash = await sha256hex(form.pw.value || '');
    if (hash !== config.auth.passwordHash) { err.textContent = 'Kata sandi tidak sesuai.'; return; }
    sessionStorage.setItem(config.auth.sessionKey, hash);
    el.remove();
    onUnlock();
  };
  form.pw.focus();
}
