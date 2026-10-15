// Utilidades chicas y sin dependencias.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

/** 12.5 -> "12,5" */
export function fmtNum(n) {
  if (n === null || n === undefined || n === '') return '—';
  return Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2, useGrouping: false });
}

/** Acepta "12,5" o "12.5". Devuelve null si está vacío o no es válido. */
export function parseNum(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export const fmtDate = (iso, opts) =>
  new Date(iso).toLocaleDateString('es-AR', opts || { weekday: 'short', day: 'numeric', month: 'short' });

export const fmtClock = (secs) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

export const daysSince = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

export const WEIGHT_MODES = { none: 'Sin peso', total: 'Peso total', perSide: 'Peso por lado' };
export const MEASURES = { reps: 'Repeticiones', time: 'Tiempo', both: 'Repeticiones y tiempo' };

export const unitLabel = (mode) => (mode === 'perSide' ? 'kg por lado' : 'kg');
