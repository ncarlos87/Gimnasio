// Reloj con cuenta regresiva para ejercicios medidos en segundos.
// Usa la hora de fin (no un contador) para no atrasarse si el navegador frena el intervalo.
import { openSheet, closeSheet, sheetEl } from './ui.js';
import { esc, fmtClock } from './util.js';

let audioCtx = null;
let wakeLock = null;

function primeAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = audioCtx || new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (_) {}
}

function beep() {
  try {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    [0, 0.28, 0.56].forEach((d) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.4, t + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.2);
      o.connect(g).connect(audioCtx.destination);
      o.start(t + d);
      o.stop(t + d + 0.22);
    });
  } catch (_) {}
  try {
    if (navigator.vibrate) navigator.vibrate([250, 120, 250, 120, 400]);
  } catch (_) {}
}

async function keepAwake() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch (_) {}
}
function letSleep() {
  try {
    if (wakeLock) wakeLock.release();
  } catch (_) {}
  wakeLock = null;
}

/**
 * @param {{title:string, subtitle?:string, seconds:number, onDone?:()=>void}} opts
 */
export function openTimer({ title, subtitle = '', seconds, onDone }) {
  const total = Math.max(1, Math.round(seconds || 30));
  let remaining = total;
  let running = false;
  let finished = false;
  let endAt = 0;
  let iv = null;

  const stop = () => {
    clearInterval(iv);
    iv = null;
    running = false;
    letSleep();
  };

  const sheet = openSheet(
    `<div class="timer">
       <h2 class="sheet-title">${esc(title)}</h2>
       <p class="muted">${esc(subtitle)}</p>
       <output class="timer-clock" aria-live="off">${fmtClock(remaining)}</output>
       <p class="timer-status" role="status"></p>
       <div class="timer-adjust">
         <button class="btn btn-ghost" data-t="minus">−5 s</button>
         <button class="btn btn-ghost" data-t="plus">+5 s</button>
       </div>
       <div class="timer-main">
         <button class="btn btn-primary btn-xl" data-t="toggle">Iniciar</button>
         <button class="btn btn-ghost btn-xl" data-t="reset">Reiniciar</button>
       </div>
       <button class="btn btn-quiet" data-sheet-close>Cerrar</button>
     </div>`,
    { onClose: stop, label: 'Reloj' }
  );

  const clock = sheet.querySelector('.timer-clock');
  const status = sheet.querySelector('.timer-status');
  const toggle = sheet.querySelector('[data-t="toggle"]');
  const paint = () => {
    clock.textContent = fmtClock(remaining);
    toggle.textContent = finished ? 'Listo' : running ? 'Pausar' : remaining < total ? 'Seguir' : 'Iniciar';
    sheet.classList.toggle('is-finished', finished);
  };

  const tick = () => {
    remaining = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
    if (remaining === 0) {
      stop();
      finished = true;
      status.textContent = '¡Tiempo cumplido! Serie marcada como hecha.';
      beep();
      if (onDone) onDone();
    }
    paint();
  };

  sheet.addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    const act = b.dataset.t;
    if (act === 'toggle') {
      if (finished) return closeSheet();
      primeAudio();
      if (running) {
        remaining = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
        stop();
      } else {
        endAt = Date.now() + remaining * 1000;
        running = true;
        keepAwake();
        iv = setInterval(tick, 200);
      }
      paint();
    } else if (act === 'reset') {
      stop();
      finished = false;
      remaining = total;
      status.textContent = '';
      paint();
    } else if ((act === 'minus' || act === 'plus') && !running && !finished) {
      remaining = Math.max(1, remaining + (act === 'plus' ? 5 : -5));
      paint();
    }
  });
}
