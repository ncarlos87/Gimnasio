// Piezas de interfaz compartidas: hoja inferior (bottom sheet) y avisos.
import { esc } from './util.js';

const root = () => document.getElementById('sheet-root');
let onCloseCb = null;
let lastFocus = null;

export function openSheet(html, { onClose, label } = {}) {
  closeSheet();
  lastFocus = document.activeElement;
  onCloseCb = onClose || null;
  const r = root();
  r.innerHTML = `
    <div class="backdrop" data-sheet-close></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(label || 'Detalle')}" tabindex="-1">
      <div class="sheet-grip" aria-hidden="true"></div>
      ${html}
    </div>`;
  r.hidden = false;
  document.body.classList.add('sheet-open');
  r.querySelector('.sheet').focus();
  return r.querySelector('.sheet');
}

export function closeSheet() {
  const r = root();
  if (!r || r.hidden) return;
  r.hidden = true;
  r.innerHTML = '';
  document.body.classList.remove('sheet-open');
  const cb = onCloseCb;
  onCloseCb = null;
  if (cb) cb();
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}

export const sheetEl = () => root().querySelector('.sheet');

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet();
});
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-sheet-close]')) closeSheet();
});

let toastTimer = null;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}
