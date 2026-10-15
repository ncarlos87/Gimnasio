import { uid } from './util.js';

export function newExercise(over = {}) {
  return {
    id: uid(),
    name: 'Ejercicio nuevo',
    type: 'simple', // 'simple' | 'combo' (varios movimientos encadenados, se registran juntos)
    measure: 'reps', // 'reps' | 'time' | 'both'
    reps: 10,
    seconds: null,
    weightMode: 'total', // 'none' | 'total' | 'perSide'
    weight: null, // peso objetivo (opcional)
    tip: '',
    mediaUrl: '',
    mediaData: '', // imagen/GIF subido desde el celular (data URL)
    ...over,
  };
}

export function newBlock(over = {}) {
  return { id: uid(), name: 'Bloque nuevo', rounds: 3, exercises: [], ...over };
}

/** Rutina de ejemplo: la actual de Charlie. Los pesos que faltan quedan vacíos. */
export function defaultRoutine() {
  return {
    blocks: [
      newBlock({
        name: 'Bloque 1',
        rounds: 3,
        exercises: [
          newExercise({ name: 'Sentadilla isométrica + martillo + press', type: 'combo', reps: 8 }),
          newExercise({ name: 'Plancha alta isométrica + patada de crol', type: 'combo', measure: 'time', reps: null, seconds: 45, weightMode: 'none' }),
          newExercise({ name: 'Muñecas', reps: 10 }),
          newExercise({ name: 'Camilla de cuádriceps', reps: 10 }),
        ],
      }),
      newBlock({
        name: 'Bloque 2',
        rounds: 3,
        exercises: [
          newExercise({ name: 'Abdominales con rueda', reps: 10, weightMode: 'none' }),
          newExercise({ name: 'Bíceps en banco Scott', reps: 10 }),
          newExercise({ name: 'Isquios con pelota de fitball', reps: 10, weightMode: 'none' }),
          newExercise({ name: 'Face pull', reps: 10 }),
        ],
      }),
      newBlock({
        name: 'Bloque 3',
        rounds: 3,
        exercises: [
          newExercise({ name: 'Fondos', reps: 10, weight: 5 }),
          newExercise({ name: 'Banco plano', reps: 10, weight: 12.5, weightMode: 'perSide' }),
        ],
      }),
    ],
  };
}

export function defaultSettings() {
  return { weightStep: 0.5, lastExport: null };
}
