// Gráfico de línea en SVG, sin librerías (funciona offline).
import { fmtNum, fmtDate, esc } from './util.js';

/** points: [{x: timestamp, y: número, label?: string}] */
export function lineChart(points, { unit = 'kg', ariaLabel = 'Evolución' } = {}) {
  const W = 320, H = 190, pl = 40, pr = 14, pt = 14, pb = 30;
  const ys = points.map((p) => p.y);
  let min = Math.min(...ys);
  let max = Math.max(...ys);
  if (min === max) {
    min = Math.max(0, min - 1);
    max = max + 1;
  } else {
    const pad = (max - min) * 0.15;
    min = Math.max(0, min - pad);
    max = max + pad;
  }
  const xs = points.map((p) => p.x);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const X = (v) => (x1 === x0 ? pl + (W - pl - pr) / 2 : pl + ((v - x0) / (x1 - x0)) * (W - pl - pr));
  const Y = (v) => pt + (1 - (v - min) / (max - min)) * (H - pt - pb);

  const ticks = [0, 1, 2, 3].map((i) => min + ((max - min) * i) / 3);
  const grid = ticks
    .map(
      (t) => `<line x1="${pl}" x2="${W - pr}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}" class="chart-grid"/>
      <text x="${pl - 6}" y="${(Y(t) + 4).toFixed(1)}" text-anchor="end" class="chart-label">${fmtNum(Math.round(t * 10) / 10)}</text>`
    )
    .join('');

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(' ');
  const dots = points
    .map(
      (p) => `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="4.5" class="chart-dot"><title>${esc(
        fmtDate(p.x, { day: 'numeric', month: 'short' })
      )}: ${fmtNum(p.y)} ${esc(unit)}</title></circle>`
    )
    .join('');
  const short = (t) => fmtDate(t, { day: 'numeric', month: 'short' });
  const xl =
    x1 === x0
      ? `<text x="${X(x0)}" y="${H - 8}" text-anchor="middle" class="chart-label">${short(x0)}</text>`
      : `<text x="${pl}" y="${H - 8}" text-anchor="start" class="chart-label">${short(x0)}</text>
         <text x="${W - pr}" y="${H - 8}" text-anchor="end" class="chart-label">${short(x1)}</text>`;

  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(ariaLabel)}">
    ${grid}
    ${points.length > 1 ? `<path d="${line}" class="chart-line" fill="none"/>` : ''}
    ${dots}${xl}
  </svg>`;
}
