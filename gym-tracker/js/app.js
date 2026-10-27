// Gimnasio: seguimiento de mi rutina semanal. Sin backend; todo queda en este dispositivo.
import * as db from './db.js';
import { esc, uid, fmtNum, parseNum, fmtDate, daysSince, WEIGHT_MODES, MEASURES, unitLabel } from './util.js';
import { defaultRoutine, defaultSettings, newExercise, newBlock } from './seed.js';
import { openSheet, closeSheet, toast } from './ui.js';
import { openTimer } from './timer.js';
import { lineChart } from './chart.js';

// Cada bloque toma el color de un disco olímpico (rojo, azul, amarillo, verde, blanco).
const PLATES = ['red', 'blue', 'yellow', 'green', 'white'];
const plateOf = (i) => PLATES[i % PLATES.length];

const state = { routine: null, settings: null, sessions: [], persisted: false };
const ui = { round: {}, historyEx: null };
let draftEx = null;
const $view = document.getElementById('view');

/* ---------- Persistencia ---------- */
const fail = (e) => {
  console.error(e);
  toast('No se pudo guardar. Exportá un respaldo por las dudas.');
};
const saveRoutine = () => db.kvSet('routine', state.routine).catch(fail);
const saveSettings = () => db.kvSet('settings', state.settings).catch(fail);
const saveSession = (s) => db.sessionPut(s).catch(fail);

/* ---------- Consultas ---------- */
const byStart = (a, b) => a.startedAt.localeCompare(b.startedAt);
const activeSession = () => state.sessions.find((s) => !s.finishedAt) || null;
const finishedSessions = () => state.sessions.filter((s) => s.finishedAt).sort(byStart);
const blockById = (id) => state.routine.blocks.find((b) => b.id === id);

function locateEx(id) {
  for (const [bi, block] of state.routine.blocks.entries()) {
    const index = block.exercises.findIndex((e) => e.id === id);
    if (index >= 0) return { block, bi, ex: block.exercises[index], index };
  }
  return null;
}

function targetText(ex) {
  const p = [];
  if (ex.measure !== 'time' && ex.reps != null) p.push(`${ex.reps} reps`);
  if (ex.measure !== 'reps' && ex.seconds != null) p.push(`${ex.seconds} s`);
  if (ex.weightMode !== 'none' && ex.weight != null) p.push(`${fmtNum(ex.weight)} ${unitLabel(ex.weightMode)}`);
  return p.join(', ') || 'Sin objetivo cargado';
}

/* ---------- Sesión: construcción ---------- */
// Un peso cuenta como "usado" si la serie quedó hecha o si yo lo escribí/ajusté a mano.
const known = (x) => !!x && x.weight != null && (x.done || x.touched);

function lastEntry(exId, exceptId) {
  const list = state.sessions
    .filter((s) => s.id !== exceptId && s.entries[exId] && s.entries[exId].sets.some(known))
    .sort(byStart);
  return list.length ? list[list.length - 1].entries[exId] : null;
}

function makeEntry(ex, block, prev) {
  const prevSets = prev ? prev.sets : [];
  const lastKnown = [...prevSets].reverse().find(known)?.weight ?? null;
  const weighted = ex.weightMode !== 'none';
  const sets = Array.from({ length: block.rounds }, (_, i) => {
    const ps = prevSets[i];
    const p = weighted ? (known(ps) ? ps.weight : lastKnown) : null;
    return {
      weight: weighted ? (p ?? ex.weight ?? null) : null,
      prev: p, // lo que usé la última vez en esta vuelta
      reps: ex.measure === 'time' ? null : ex.reps ?? null,
      seconds: ex.measure === 'reps' ? null : ex.seconds ?? null,
      done: false,
    };
  });
  return { name: ex.name, weightMode: ex.weightMode, blockId: block.id, sets };
}

function buildSession() {
  const s = { id: uid(), startedAt: new Date().toISOString(), finishedAt: null, entries: {} };
  for (const b of state.routine.blocks)
    for (const ex of b.exercises) s.entries[ex.id] = makeEntry(ex, b, lastEntry(ex.id, s.id));
  return s;
}

/** Si cambié la rutina durante la sesión, completa lo que falte sin perder lo ya anotado. */
function ensureEntries(s) {
  let changed = false;
  for (const b of state.routine.blocks)
    for (const ex of b.exercises) {
      const e = s.entries[ex.id];
      if (!e) {
        s.entries[ex.id] = makeEntry(ex, b, lastEntry(ex.id, s.id));
        changed = true;
        continue;
      }
      e.name = ex.name;
      e.weightMode = ex.weightMode;
      e.blockId = b.id;
      if (e.sets.length < b.rounds) {
        const fresh = makeEntry(ex, b, lastEntry(ex.id, s.id));
        for (let i = e.sets.length; i < b.rounds; i++) e.sets.push(fresh.sets[i]);
        changed = true;
      }
    }
  if (changed) saveSession(s);
}

function progress(s) {
  let done = 0;
  let total = 0;
  for (const b of state.routine.blocks)
    for (const ex of b.exercises) {
      const e = s.entries[ex.id];
      if (!e) continue;
      for (let i = 0; i < b.rounds; i++) {
        total++;
        if (e.sets[i]?.done) done++;
      }
    }
  return { done, total };
}

function carryForward(entry, from) {
  const w = entry.sets[from]?.weight;
  if (w == null) return;
  for (let j = from + 1; j < entry.sets.length; j++) {
    const x = entry.sets[j];
    // Solo pisa vueltas sin peso propio o que ya venían de un arrastre anterior (no las que ajusté a mano).
    if (!x.done && !x.touched && (x.weight == null || x.carried)) {
      x.weight = w;
      x.carried = true;
    }
  }
}

const roundComplete = (s, b, i) => b.exercises.every((ex) => s.entries[ex.id]?.sets[i]?.done);
function defaultRound(s, b) {
  for (let i = 0; i < b.rounds; i++) if (!roundComplete(s, b, i)) return i;
  return b.rounds - 1;
}

function describeSets(entry) {
  const done = entry.sets.filter((x) => x.done);
  if (!done.length) return '';
  if (entry.weightMode !== 'none' && done.some((x) => x.weight != null)) {
    const unit = entry.weightMode === 'perSide' ? 'kg por lado' : 'kg';
    return `${done.map((x) => (x.weight != null ? fmtNum(x.weight) : '—')).join(' · ')} ${unit}`;
  }
  if (done.some((x) => x.reps != null)) return `${done.map((x) => x.reps ?? '—').join(', ')} reps`;
  return `${done.map((x) => x.seconds ?? '—').join(', ')} s`;
}

/* ---------- Vistas ---------- */
function viewHome() {
  const act = activeSession();
  const fin = finishedSessions();
  const last = fin[fin.length - 1];
  const le = state.settings.lastExport;
  const needsBackup = fin.length > 0 && (!le || daysSince(le) >= 30);

  let heroTitle = 'Entrenar hoy';
  let heroSub = state.routine.blocks.length ? 'Empezar la rutina' : 'Primero cargá tu rutina';
  if (act) {
    ensureEntries(act);
    const { done, total } = progress(act);
    heroTitle = 'Seguir sesión';
    heroSub = `${done} de ${total} series`;
  }

  let lastCard = `<p class="empty">Todavía no terminaste ninguna sesión. Tu rutina ya está cargada: tocá el disco para empezar.</p>`;
  if (last) {
    const items = state.routine.blocks
      .flatMap((b) => b.exercises)
      .map((ex) => ({ ex, e: last.entries[ex.id] }))
      .filter(({ e }) => e && e.weightMode !== 'none' && describeSets(e))
      .map(
        ({ ex, e }) => `<li><span>${esc(ex.name)}</span><strong>${esc(describeSets(e))}</strong></li>`
      )
      .join('');
    const { done, total } = progress(last);
    lastCard = `
      <section class="card">
        <h2>Para superar esta semana</h2>
        <p class="muted">Sesión del ${esc(fmtDate(last.startedAt, { weekday: 'long', day: 'numeric', month: 'long' }))}, ${done} de ${total} series hechas.</p>
        ${items ? `<ul class="ref-list">${items}</ul>` : '<p class="muted">No anotaste pesos en esa sesión.</p>'}
      </section>`;
  }

  return `
    <header class="page-head"><h1>Gimnasio</h1></header>
    ${
      needsBackup
        ? `<aside class="banner" role="note">
             <p>${le ? `Hace ${daysSince(le)} días que no exportás un respaldo.` : 'Todavía no exportaste ningún respaldo.'} Tus datos viven solo en este celular.</p>
             <button class="btn btn-ghost" data-action="export">Exportar respaldo</button>
           </aside>`
        : ''
    }
    <div class="hero">
      <button class="hero-plate" data-action="${act ? 'goto-session' : 'start-session'}" ${state.routine.blocks.length ? '' : 'disabled'}>
        <span class="hero-title">${heroTitle}</span>
        <span class="hero-sub">${esc(heroSub)}</span>
      </button>
    </div>
    ${lastCard}`;
}

function viewSession() {
  const s = activeSession();
  if (!s)
    return `<header class="page-head"><h1>Sesión</h1></header>
      <p class="empty">No hay una sesión en curso.</p>
      <button class="btn btn-primary btn-xl btn-block" data-action="start-session">Entrenar hoy</button>`;
  ensureEntries(s);
  const { done, total } = progress(s);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const blocks = state.routine.blocks.map((b, bi) => blockHtml(s, b, bi)).join('');
  return `
    <header class="page-head">
      <h1>Sesión de hoy</h1>
      <p class="muted">${esc(fmtDate(s.startedAt, { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
    </header>
    <div class="progress-wrap">
      <div class="progress" role="progressbar" aria-label="Series hechas" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}">
        <div class="progress-bar" style="width:${pct}%"></div>
      </div>
      <p class="progress-text"><strong>${done}</strong> de ${total} series hechas</p>
    </div>
    ${blocks || '<p class="empty">La rutina está vacía. Cargá bloques y ejercicios en la pestaña Rutina.</p>'}
    <div class="session-actions">
      <button class="btn btn-primary btn-xl btn-block" data-action="finish-session">Terminar sesión</button>
      <button class="btn btn-quiet btn-block" data-action="discard-session">Descartar sesión</button>
    </div>`;
}

function blockHtml(s, b, bi) {
  if (ui.round[b.id] == null || ui.round[b.id] >= b.rounds) ui.round[b.id] = defaultRound(s, b);
  const r = ui.round[b.id];
  let doneSets = 0;
  for (const ex of b.exercises) for (let i = 0; i < b.rounds; i++) if (s.entries[ex.id]?.sets[i]?.done) doneSets++;
  const totalSets = b.exercises.length * b.rounds;

  const pills = Array.from({ length: b.rounds }, (_, i) => {
    const complete = b.exercises.length > 0 && roundComplete(s, b, i);
    return `<button class="round-pill${i === r ? ' is-current' : ''}${complete ? ' is-done' : ''}"
      data-action="round" data-block="${b.id}" data-round="${i}" aria-pressed="${i === r}"
      aria-label="Vuelta ${i + 1}${complete ? ', completa' : ''}">${i + 1}</button>`;
  }).join('');

  const rows = b.exercises.map((ex) => exerciseRow(s, b, ex, r)).join('');
  return `
    <section class="block" style="--plate:var(--plate-${plateOf(bi)})" aria-label="${esc(b.name)}">
      <div class="block-head">
        <h2>${esc(b.name)}</h2>
        <span class="block-count">${doneSets} de ${totalSets}</span>
      </div>
      <div class="rounds" role="group" aria-label="Vueltas de ${esc(b.name)}">
        <span class="rounds-label">Vuelta</span>${pills}
      </div>
      <ul class="ex-list">${rows || '<li class="empty">Este bloque no tiene ejercicios.</li>'}</ul>
    </section>`;
}

function exerciseRow(s, b, ex, r) {
  const e = s.entries[ex.id];
  const set = e.sets[r];
  const doneRounds = e.sets.slice(0, b.rounds).filter((x) => x.done).length;
  const dots = e.sets
    .slice(0, b.rounds)
    .map((x) => `<i class="dot${x.done ? ' on' : ''}"></i>`)
    .join('');
  const weighted = ex.weightMode !== 'none';
  const withReps = ex.measure !== 'time';
  const withTime = ex.measure !== 'reps';
  const attrs = `data-ex="${ex.id}" data-round="${r}"`;

  const weightField = weighted
    ? `<div class="field">
         <span class="field-label">Peso (${ex.weightMode === 'perSide' ? 'kg por lado' : 'kg'})</span>
         <div class="stepper">
           <button class="step-btn" data-action="step" ${attrs} data-dir="-1" aria-label="Bajar el peso">−</button>
           <input class="step-input" inputmode="decimal" data-field="weight" ${attrs}
             value="${set.weight == null ? '' : fmtNum(set.weight)}" placeholder="—" aria-label="Peso en kilos">
           <button class="step-btn" data-action="step" ${attrs} data-dir="1" aria-label="Subir el peso">+</button>
         </div>
       </div>`
    : '';
  const repsField = withReps
    ? `<label class="field">
         <span class="field-label">Reps</span>
         <input class="num-input" inputmode="numeric" data-field="reps" ${attrs} value="${set.reps ?? ''}" placeholder="—">
       </label>`
    : '';
  const timeField = withTime
    ? `<div class="field">
         <span class="field-label">Segundos</span>
         <div class="sec-row">
           <input class="num-input" inputmode="numeric" data-field="seconds" ${attrs} value="${set.seconds ?? ''}" placeholder="—" aria-label="Segundos">
           <button class="btn btn-ghost btn-clock" data-action="timer" ${attrs}>Reloj</button>
         </div>
       </div>`
    : '';

  return `
    <li class="ex${set.done ? ' is-done' : ''}">
      <div class="ex-top">
        <div class="ex-main">
          <button class="ex-name" data-action="info" data-ex="${ex.id}">${esc(ex.name)}</button>
          <div class="ex-meta">
            <span class="dots" role="img" aria-label="${doneRounds} de ${b.rounds} vueltas hechas">${dots}</span>
            ${ex.type === 'combo' ? '<span class="tag">Combo</span>' : ''}
            ${set.prev != null ? `<span class="prev">Antes: ${fmtNum(set.prev)} ${ex.weightMode === 'perSide' ? 'kg/lado' : 'kg'}</span>` : ''}
          </div>
        </div>
        <button class="plate" data-action="toggle" ${attrs} aria-pressed="${set.done}"
          aria-label="${esc(ex.name)}, vuelta ${r + 1}: ${set.done ? 'hecha' : 'pendiente'}"><span class="plate-hole"></span></button>
      </div>
      <div class="ex-fields">${weightField}${repsField}${timeField}</div>
    </li>`;
}

function historyExercises() {
  const map = new Map();
  for (const b of state.routine.blocks) for (const ex of b.exercises) map.set(ex.id, ex.name);
  for (const s of finishedSessions())
    for (const [id, e] of Object.entries(s.entries))
      if (!map.has(id) && e.sets.some((x) => x.done)) map.set(id, `${e.name} (ya no está en la rutina)`);
  return [...map];
}

function viewHistory() {
  const fin = finishedSessions();
  const exs = historyExercises();
  if (!fin.length || !exs.length)
    return `<header class="page-head"><h1>Historial</h1></header>
      <p class="empty">Todavía no hay sesiones terminadas. Cuando termines la primera, vas a ver acá cómo sube el peso de cada ejercicio.</p>`;
  if (!ui.historyEx || !exs.some(([id]) => id === ui.historyEx)) ui.historyEx = exs[0][0];
  const id = ui.historyEx;

  const rows = fin
    .filter((s) => s.entries[id] && s.entries[id].sets.some((x) => x.done))
    .map((s) => ({ s, e: s.entries[id] }));
  const points = rows
    .map(({ s, e }) => {
      const ws = e.sets.filter((x) => x.done && x.weight != null).map((x) => x.weight);
      return ws.length ? { x: new Date(s.startedAt).getTime(), y: Math.max(...ws) } : null;
    })
    .filter(Boolean);
  const mode = rows.length ? rows[rows.length - 1].e.weightMode : 'total';
  const name = exs.find(([k]) => k === id)[1];

  const chart = points.length
    ? `<p class="muted">Peso más alto de cada sesión (${esc(unitLabel(mode))})</p>${lineChart(points, {
        unit: unitLabel(mode),
        ariaLabel: `Peso más alto por sesión: ${name}`,
      })}`
    : `<p class="empty">Este ejercicio no tiene pesos registrados todavía.</p>`;

  const list = [...rows]
    .reverse()
    .map(
      ({ s, e }) =>
        `<li><span>${esc(fmtDate(s.startedAt, { day: 'numeric', month: 'short' }))}</span><strong>${esc(describeSets(e))}</strong></li>`
    )
    .join('');

  const sessionsList = [...fin]
    .reverse()
    .map((s) => {
      let d = 0;
      let t = 0;
      for (const e of Object.values(s.entries)) for (const x of e.sets) (t++, x.done && d++);
      return `<li>
        <span>${esc(fmtDate(s.startedAt, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}, ${d} de ${t} series</span>
        <button class="btn btn-quiet btn-small" data-action="del-session" data-id="${s.id}" aria-label="Borrar la sesión del ${esc(fmtDate(s.startedAt, { day: 'numeric', month: 'long' }))}">Borrar</button>
      </li>`;
    })
    .join('');

  return `
    <header class="page-head"><h1>Historial</h1></header>
    <label class="field">
      <span class="field-label">Ejercicio</span>
      <select class="text-input" data-field="hist-ex">
        ${exs.map(([k, n]) => `<option value="${k}"${k === id ? ' selected' : ''}>${esc(n)}</option>`).join('')}
      </select>
    </label>
    <section class="card">${chart}</section>
    <section class="card">
      <h2>Sesión por sesión</h2>
      <ul class="ref-list">${list}</ul>
    </section>
    <section class="card">
      <h2>Sesiones guardadas</h2>
      <ul class="ref-list">${sessionsList}</ul>
    </section>`;
}

function viewRoutine() {
  const blocks = state.routine.blocks
    .map((b, bi) => {
      const list = b.exercises
        .map(
          (ex, i) => `
        <li class="edit-row">
          <div class="edit-row-main">
            <strong>${esc(ex.name)}</strong>
            <span class="muted">${ex.type === 'combo' ? 'Combo, ' : ''}${esc(targetText(ex))}</span>
          </div>
          <div class="row-actions">
            <button class="icon-btn" data-action="move-ex" data-block="${b.id}" data-ex="${ex.id}" data-dir="-1" aria-label="Subir ${esc(ex.name)}" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button class="icon-btn" data-action="move-ex" data-block="${b.id}" data-ex="${ex.id}" data-dir="1" aria-label="Bajar ${esc(ex.name)}" ${i === b.exercises.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="btn btn-ghost btn-small" data-action="edit-ex" data-ex="${ex.id}">Editar</button>
          </div>
        </li>`
        )
        .join('');
      return `
      <section class="card block-edit" style="--plate:var(--plate-${plateOf(bi)})">
        <div class="block-edit-head">
          <label class="field grow">
            <span class="field-label">Nombre del bloque</span>
            <input class="text-input" data-bfield="name" data-block="${b.id}" value="${esc(b.name)}" maxlength="40">
          </label>
          <label class="field">
            <span class="field-label">Vueltas</span>
            <input class="num-input" inputmode="numeric" data-bfield="rounds" data-block="${b.id}" value="${b.rounds}">
          </label>
        </div>
        <ul class="edit-list">${list || '<li class="empty">Sin ejercicios todavía.</li>'}</ul>
        <div class="block-edit-actions">
          <button class="btn btn-primary" data-action="add-ex" data-block="${b.id}">Agregar ejercicio</button>
          <button class="icon-btn" data-action="move-block" data-block="${b.id}" data-dir="-1" aria-label="Subir bloque" ${bi === 0 ? 'disabled' : ''}>↑</button>
          <button class="icon-btn" data-action="move-block" data-block="${b.id}" data-dir="1" aria-label="Bajar bloque" ${bi === state.routine.blocks.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="btn btn-danger btn-small" data-action="del-block" data-block="${b.id}">Eliminar bloque</button>
        </div>
      </section>`;
    })
    .join('');
  return `
    <header class="page-head">
      <h1>Rutina</h1>
      <p class="muted">Tocá el nombre de un ejercicio en la sesión para ver su ficha. Acá cargás los tips y las imágenes.</p>
    </header>
    ${blocks || '<p class="empty">Todavía no hay bloques. Agregá el primero.</p>'}
    <button class="btn btn-ghost btn-block" data-action="add-block">Agregar bloque</button>`;
}

function viewSettings() {
  const le = state.settings.lastExport;
  const step = state.settings.weightStep;
  return `
    <header class="page-head"><h1>Ajustes</h1></header>
    <section class="card">
      <h2>Peso</h2>
      <label class="field">
        <span class="field-label">Cuánto suben y bajan los botones + y −</span>
        <select class="text-input" data-field="step">
          ${[0.5, 1, 2.5, 5].map((v) => `<option value="${v}"${v === step ? ' selected' : ''}>${fmtNum(v)} kg</option>`).join('')}
        </select>
      </label>
    </section>
    <section class="card">
      <h2>Respaldo</h2>
      <p class="muted">${le ? `Último respaldo: ${esc(fmtDate(le, { day: 'numeric', month: 'long', year: 'numeric' }))}.` : 'Todavía no exportaste ningún respaldo.'}
      ${state.persisted ? 'El navegador guarda tus datos de forma persistente.' : 'El navegador no confirmó el guardado persistente: exportá un respaldo seguido.'}</p>
      <div class="stack">
        <button class="btn btn-primary" data-action="export">Exportar respaldo</button>
        <label class="btn btn-ghost file-btn">Importar respaldo
          <input type="file" id="import-file" accept="application/json,.json" class="sr-only">
        </label>
      </div>
    </section>
    <section class="card">
      <h2>Rutina de ejemplo</h2>
      <p class="muted">Vuelve a cargar la rutina original. El historial de sesiones no se toca.</p>
      <button class="btn btn-danger" data-action="reset-routine">Restaurar rutina de ejemplo</button>
    </section>`;
}

/* ---------- Hojas: ficha y editor de ejercicio ---------- */
const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : '');
const isImageUrl = (u) => /\.(gif|png|jpe?g|webp|svg|avif)(\?.*)?$/i.test(u);

function mediaHtml(ex) {
  if (ex.mediaData) return `<img class="media" src="${esc(ex.mediaData)}" alt="Demostración de ${esc(ex.name)}">`;
  const url = safeUrl(ex.mediaUrl || '');
  if (!url) return '';
  const link = `<a class="btn btn-ghost" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Abrir enlace</a>`;
  return isImageUrl(url)
    ? `<img class="media" src="${esc(url)}" alt="Demostración de ${esc(ex.name)}" loading="lazy">${link}`
    : link;
}

function openInfo(exId) {
  const loc = locateEx(exId);
  if (!loc) return;
  const { ex } = loc;
  const media = mediaHtml(ex);
  openSheet(
    `<h2 class="sheet-title">${esc(ex.name)}</h2>
     <p class="muted">${ex.type === 'combo' ? 'Combo, ' : ''}${esc(targetText(ex))}</p>
     ${media}
     ${ex.tip ? `<p class="tip">${esc(ex.tip)}</p>` : ''}
     ${!media && !ex.tip ? '<p class="empty">Todavía no cargaste un tip ni una imagen para este ejercicio.</p>' : ''}
     <div class="sheet-actions">
       <button class="btn btn-ghost" data-action="edit-ex" data-ex="${ex.id}">Editar ejercicio</button>
       <button class="btn btn-quiet" data-sheet-close>Cerrar</button>
     </div>`,
    { label: ex.name }
  );
}

const options = (obj, sel) =>
  Object.entries(obj).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');

function openExerciseEditor(blockId, exId) {
  const isNew = !exId;
  let ex;
  if (isNew) ex = draftEx = newExercise();
  else {
    const loc = locateEx(exId);
    if (!loc) return;
    ex = loc.ex;
    blockId = loc.block.id;
  }
  openSheet(
    `<form class="form" data-form="exercise" data-block="${blockId}" data-ex="${isNew ? '' : ex.id}">
      <h2 class="sheet-title">${isNew ? 'Nuevo ejercicio' : 'Editar ejercicio'}</h2>
      <label class="field"><span class="field-label">Nombre</span>
        <input class="text-input" name="name" required maxlength="80" value="${esc(isNew ? '' : ex.name)}" placeholder="Ej.: Remo en polea"></label>
      <label class="check"><input type="checkbox" name="combo" ${ex.type === 'combo' ? 'checked' : ''}>
        <span>Es un combo: varios movimientos encadenados que se registran juntos</span></label>
      <label class="field"><span class="field-label">Se mide en</span>
        <select class="text-input" name="measure">${options(MEASURES, ex.measure)}</select></label>
      <div class="form-row">
        <label class="field"><span class="field-label">Repeticiones</span>
          <input class="num-input" name="reps" inputmode="numeric" value="${ex.reps ?? ''}"></label>
        <label class="field"><span class="field-label">Segundos</span>
          <input class="num-input" name="seconds" inputmode="numeric" value="${ex.seconds ?? ''}"></label>
      </div>
      <div class="form-row">
        <label class="field grow"><span class="field-label">Peso</span>
          <select class="text-input" name="weightMode">${options(WEIGHT_MODES, ex.weightMode)}</select></label>
        <label class="field"><span class="field-label">Objetivo (kg)</span>
          <input class="num-input" name="weight" inputmode="decimal" value="${ex.weight == null ? '' : fmtNum(ex.weight)}"></label>
      </div>
      <label class="field"><span class="field-label">Tip de técnica</span>
        <textarea class="text-input" name="tip" rows="3" maxlength="600">${esc(ex.tip)}</textarea></label>
      <label class="field"><span class="field-label">Enlace a una imagen, GIF o video</span>
        <input class="text-input" name="mediaUrl" inputmode="url" placeholder="https://…" value="${esc(ex.mediaUrl)}"></label>
      <label class="field"><span class="field-label">O subí una imagen o GIF desde el celular (se guarda acá y funciona sin conexión)</span>
        <input class="file-input" type="file" name="mediaFile" accept="image/*"></label>
      ${
        ex.mediaData
          ? `<img class="media media-small" src="${esc(ex.mediaData)}" alt="Imagen cargada">
             <label class="check"><input type="checkbox" name="removeMedia"><span>Quitar la imagen cargada</span></label>`
          : ''
      }
      <div class="sheet-actions">
        <button class="btn btn-primary" type="submit">Guardar ejercicio</button>
        ${isNew ? '' : `<button class="btn btn-danger" type="button" data-action="delete-ex" data-ex="${ex.id}">Eliminar</button>`}
        <button class="btn btn-quiet" type="button" data-sheet-close>Cancelar</button>
      </div>
    </form>`,
    { label: isNew ? 'Nuevo ejercicio' : 'Editar ejercicio', onClose: () => (draftEx = null) }
  );
}

const readDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

async function submitExercise(form) {
  const fd = new FormData(form);
  const blockId = form.dataset.block;
  const exId = form.dataset.ex;
  const target = exId ? locateEx(exId)?.ex : draftEx;
  if (!target) return;

  const rawUrl = String(fd.get('mediaUrl') || '').trim();
  if (rawUrl && !safeUrl(rawUrl)) return toast('El enlace tiene que empezar con http:// o https://');

  let mediaData = target.mediaData || '';
  if (fd.get('removeMedia')) mediaData = '';
  const file = fd.get('mediaFile');
  if (file && file.size) {
    if (file.size > 3 * 1024 * 1024) return toast('La imagen pesa más de 3 MB. Probá con una más liviana.');
    try {
      mediaData = await readDataUrl(file);
    } catch (e) {
      return toast('No se pudo leer la imagen.');
    }
  }

  const measure = fd.get('measure');
  const weightMode = fd.get('weightMode');
  const reps = parseInt(fd.get('reps'), 10);
  const secs = parseInt(fd.get('seconds'), 10);
  Object.assign(target, {
    name: String(fd.get('name')).trim() || 'Ejercicio',
    type: fd.get('combo') ? 'combo' : 'simple',
    measure,
    reps: measure === 'time' || !Number.isFinite(reps) ? null : reps,
    seconds: measure === 'reps' || !Number.isFinite(secs) ? null : secs,
    weightMode,
    weight: weightMode === 'none' ? null : parseNum(fd.get('weight')),
    tip: String(fd.get('tip') || '').trim(),
    mediaUrl: rawUrl,
    mediaData,
  });
  if (!exId) {
    blockById(blockId).exercises.push(target);
    draftEx = null;
  }
  await saveRoutine();
  closeSheet();
  render();
  toast('Ejercicio guardado');
}

/* ---------- Acciones ---------- */
function setOf(el) {
  const s = activeSession();
  const e = s && s.entries[el.dataset.ex];
  return s && e ? { s, e, set: e.sets[+el.dataset.round] } : {};
}

function afterDone(s, entry, roundIdx) {
  const b = blockById(entry.blockId);
  if (!b) return;
  if (roundComplete(s, b, roundIdx)) {
    if (ui.round[b.id] === roundIdx && roundIdx + 1 < b.rounds) {
      ui.round[b.id] = roundIdx + 1;
      toast(`Vuelta ${roundIdx + 1} completa`);
    } else if (roundIdx + 1 >= b.rounds) {
      toast(`${b.name} completo`);
    }
  }
  const { done, total } = progress(s);
  if (done === total) toast('¡Rutina completa! Terminá la sesión cuando quieras.');
}

const actions = {
  'start-session'() {
    if (activeSession()) return actions['goto-session']();
    const s = buildSession();
    state.sessions.push(s);
    saveSession(s);
    ui.round = {};
    db.requestPersistence().then((p) => (state.persisted = p));
    location.hash = '#/sesion';
    render();
  },
  'goto-session'() {
    location.hash = '#/sesion';
  },
  round(el) {
    ui.round[el.dataset.block] = +el.dataset.round;
    render();
  },
  toggle(el) {
    const { s, e, set } = setOf(el);
    if (!set) return;
    set.done = !set.done;
    if (set.done) carryForward(e, +el.dataset.round);
    saveSession(s);
    if (set.done) afterDone(s, e, +el.dataset.round);
    render();
  },
  step(el) {
    const { s, e, set } = setOf(el);
    if (!set) return;
    const step = state.settings.weightStep || 0.5;
    const base = set.weight ?? set.prev ?? 0;
    set.weight = Math.max(0, Math.round((base + Number(el.dataset.dir) * step) * 100) / 100);
    set.touched = true;
    set.carried = false;
    carryForward(e, +el.dataset.round);
    saveSession(s);
    render();
  },
  timer(el) {
    const { s, e, set } = setOf(el);
    if (!set) return;
    const round = +el.dataset.round;
    openTimer({
      title: e.name,
      subtitle: `Vuelta ${round + 1}`,
      seconds: set.seconds || 30,
      onDone() {
        set.done = true;
        saveSession(s);
        afterDone(s, e, round);
        render();
      },
    });
  },
  info(el) {
    openInfo(el.dataset.ex);
  },
  'edit-ex'(el) {
    closeSheet();
    openExerciseEditor(null, el.dataset.ex);
  },
  'add-ex'(el) {
    openExerciseEditor(el.dataset.block, null);
  },
  'delete-ex'(el) {
    const loc = locateEx(el.dataset.ex);
    if (!loc) return;
    if (!confirm(`¿Eliminar "${loc.ex.name}" de la rutina? El historial se conserva.`)) return;
    loc.block.exercises.splice(loc.index, 1);
    saveRoutine();
    closeSheet();
    render();
  },
  'move-ex'(el) {
    const loc = locateEx(el.dataset.ex);
    if (!loc) return;
    const j = loc.index + Number(el.dataset.dir);
    if (j < 0 || j >= loc.block.exercises.length) return;
    const arr = loc.block.exercises;
    [arr[loc.index], arr[j]] = [arr[j], arr[loc.index]];
    saveRoutine();
    render();
  },
  'move-block'(el) {
    const arr = state.routine.blocks;
    const i = arr.findIndex((b) => b.id === el.dataset.block);
    const j = i + Number(el.dataset.dir);
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    saveRoutine();
    render();
  },
  'add-block'() {
    state.routine.blocks.push(newBlock({ name: `Bloque ${state.routine.blocks.length + 1}` }));
    saveRoutine();
    render();
  },
  'del-block'(el) {
    const b = blockById(el.dataset.block);
    if (!b) return;
    if (!confirm(`¿Eliminar "${b.name}" con sus ${b.exercises.length} ejercicios? El historial se conserva.`)) return;
    state.routine.blocks = state.routine.blocks.filter((x) => x.id !== b.id);
    saveRoutine();
    render();
  },
  'finish-session'() {
    const s = activeSession();
    if (!s) return;
    const { done, total } = progress(s);
    if (done === 0) {
      if (confirm('No marcaste ninguna serie. ¿Descartar la sesión?')) actions['discard-session'](null, true);
      return;
    }
    if (done < total && !confirm(`Faltan ${total - done} series. ¿Terminar igual?`)) return;
    s.finishedAt = new Date().toISOString();
    saveSession(s);
    ui.round = {};
    toast('Sesión guardada');
    location.hash = '#/';
    render();
  },
  'discard-session'(_, skipConfirm) {
    const s = activeSession();
    if (!s) return;
    if (!skipConfirm && !confirm('¿Descartar la sesión en curso? Se pierde lo que anotaste.')) return;
    state.sessions = state.sessions.filter((x) => x.id !== s.id);
    db.sessionDelete(s.id).catch(fail);
    ui.round = {};
    location.hash = '#/';
    render();
  },
  'del-session'(el) {
    const s = state.sessions.find((x) => x.id === el.dataset.id);
    if (!s) return;
    if (!confirm(`¿Borrar la sesión del ${fmtDate(s.startedAt, { day: 'numeric', month: 'long' })}? No se puede deshacer.`)) return;
    state.sessions = state.sessions.filter((x) => x.id !== s.id);
    db.sessionDelete(s.id).catch(fail);
    render();
  },
  export: exportData,
  'reset-routine'() {
    if (!confirm('¿Reemplazar tu rutina actual por la de ejemplo? El historial se conserva.')) return;
    state.routine = defaultRoutine();
    saveRoutine();
    toast('Rutina de ejemplo restaurada');
    render();
  },
};

function fieldChange(el) {
  const f = el.dataset.field;
  if (f === 'hist-ex') {
    ui.historyEx = el.value;
    return render();
  }
  if (f === 'step') {
    state.settings.weightStep = Number(el.value) || 0.5;
    saveSettings();
    return toast('Ajuste guardado');
  }
  const { s, e, set } = setOf(el);
  if (!set) return;
  if (f === 'weight') {
    set.weight = parseNum(el.value);
    set.touched = set.weight != null;
    set.carried = false;
    carryForward(e, +el.dataset.round);
  }
  else if (f === 'reps' || f === 'seconds') {
    const n = parseInt(el.value, 10);
    set[f] = Number.isFinite(n) && n >= 0 ? n : null;
  }
  saveSession(s);
  render();
}

function blockFieldChange(el) {
  const b = blockById(el.dataset.block);
  if (!b) return;
  if (el.dataset.bfield === 'name') b.name = el.value.trim() || b.name;
  else {
    const n = parseInt(el.value, 10);
    b.rounds = Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : b.rounds;
  }
  saveRoutine();
  render();
}

/* ---------- Respaldo ---------- */
async function exportData() {
  state.settings.lastExport = new Date().toISOString();
  saveSettings();
  const data = {
    app: 'gym-tracker',
    version: 1,
    exportedAt: state.settings.lastExport,
    routine: state.routine,
    settings: state.settings,
    sessions: state.sessions,
  };
  const name = `gimnasio-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([JSON.stringify(data, null, 2)], name, { type: 'application/json' });
  try {
    const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
    if (mobile && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Respaldo del gimnasio' });
    } else {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
    toast('Respaldo exportado');
  } catch (e) {
    if (e && e.name !== 'AbortError') toast('No se pudo exportar el respaldo.');
  }
  render();
}

async function importFile(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'gym-tracker' || !data.routine || !Array.isArray(data.routine.blocks) || !Array.isArray(data.sessions))
      throw new Error('formato');
    const n = data.sessions.length;
    if (!confirm(`Esto reemplaza todo lo que hay en este celular por el respaldo (${n} sesiones). ¿Importar?`)) return;
    const settings = { ...defaultSettings(), ...(data.settings || {}) };
    await db.replaceAll({ routine: data.routine, settings, sessions: data.sessions });
    state.routine = data.routine;
    state.settings = settings;
    state.sessions = data.sessions;
    ui.round = {};
    ui.historyEx = null;
    toast('Respaldo importado');
    render();
  } catch (e) {
    console.error(e);
    toast('Ese archivo no es un respaldo válido de esta app.');
  }
}

/* ---------- Render y arranque ---------- */
const ROUTES = ['sesion', 'historial', 'rutina', 'ajustes'];
const TITLES = { inicio: 'Gimnasio', sesion: 'Sesión', historial: 'Historial', rutina: 'Rutina', ajustes: 'Ajustes' };

function currentRoute() {
  const h = (location.hash || '#/').replace(/^#\/?/, '');
  return ROUTES.includes(h) ? h : 'inicio';
}

function render() {
  const r = currentRoute();
  const views = { inicio: viewHome, sesion: viewSession, historial: viewHistory, rutina: viewRoutine, ajustes: viewSettings };
  const y = window.scrollY;
  $view.innerHTML = views[r]();
  document.title = r === 'inicio' ? 'Gimnasio' : `${TITLES[r]} · Gimnasio`;
  document.querySelectorAll('#tabs a').forEach((a) => {
    if (a.dataset.route === r) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const tab = document.querySelector('#tabs [data-route="sesion"]');
  if (tab) tab.classList.toggle('has-active', !!activeSession());
  window.scrollTo(0, y);
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) fn(el);
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'import-file') importFile(el);
  else if (el.dataset && el.dataset.field) fieldChange(el);
  else if (el.dataset && el.dataset.bfield) blockFieldChange(el);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-field], [data-bfield]') && e.target.tagName === 'INPUT')
    e.target.blur();
});
document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-form="exercise"]');
  if (form) {
    e.preventDefault();
    submitExercise(form);
  }
});
window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
});

async function init() {
  try {
    state.routine = await db.kvGet('routine');
    if (!state.routine) {
      state.routine = defaultRoutine();
      await db.kvSet('routine', state.routine);
    }
    const stored = await db.kvGet('settings');
    state.settings = { ...defaultSettings(), ...(stored || {}) };
    if (!stored) await db.kvSet('settings', state.settings);
    state.sessions = await db.sessionsAll();
    state.persisted = await db.requestPersistence();
  } catch (e) {
    console.error(e);
    $view.innerHTML = `<p class="empty">No se pudo abrir el almacenamiento del navegador. Si estás en una ventana privada, abrí la app en una ventana normal.</p>`;
    return;
  }
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}
init();
