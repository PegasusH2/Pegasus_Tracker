import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import './setup-db.js';
import { db } from '../js/db/schema.js';
import * as repo from '../js/db/repository.js';

beforeEach(async () => {
  await db.exercises.toArray(); // fuerza la apertura antes de limpiar
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
});

describe('Creación de entrenamiento desde una rutina — transacción', () => {
  test('startWorkoutFromTemplate crea workout + workoutExercises + sets como una sola unidad', async () => {
    const ex1 = await repo.createExercise({ name: 'Press banca' });
    const ex2 = await repo.createExercise({ name: 'Sentadilla' });
    const template = await repo.createTemplate({ name: 'Día 1' });
    await repo.addTemplateExercise(template.id, ex1.id, { targetSets: 3 });
    await repo.addTemplateExercise(template.id, ex2.id, { targetSets: 2 });

    const workout = await repo.startWorkoutFromTemplate(template.id, { date: '2026-01-01' });
    const detail = await repo.getWorkoutDetail(workout.id);

    assert.equal(detail.exercises.length, 2);
    assert.equal(detail.exercises[0].sets.length, 3);
    assert.equal(detail.exercises[1].sets.length, 2);
    // Ninguna serie recién creada se marca como hecha solo por venir prellenada.
    assert.ok(detail.exercises[0].sets.every((s) => s.done === false));
  });

  test('si falla a mitad de la creación, no queda un workout huérfano a medias (rollback real)', async () => {
    const ex1 = await repo.createExercise({ name: 'Press banca' });
    const template = await repo.createTemplate({ name: 'Día 1' });
    await repo.addTemplateExercise(template.id, ex1.id, { targetSets: 3 });

    // Rompe addSet a mitad de camino para simular un fallo real de Dexie
    // (cuota superada, error de constraint...) en la segunda serie.
    const originalAdd = db.sets.add.bind(db.sets);
    let calls = 0;
    db.sets.add = (...args) => {
      calls++;
      if (calls === 2) throw new Error('fallo simulado de Dexie');
      return originalAdd(...args);
    };

    await assert.rejects(() => repo.startWorkoutFromTemplate(template.id, { date: '2026-01-01' }));
    db.sets.add = originalAdd;

    // La transacción debe haber deshecho TODO — no debe quedar ni el
    // workout ni la primera serie que sí se había creado antes del fallo.
    const allWorkouts = await db.workouts.toArray();
    assert.equal(allWorkouts.length, 0, 'no debe quedar un workout huérfano tras el rollback');
    const allSets = await db.sets.toArray();
    assert.equal(allSets.length, 0, 'no debe quedar ninguna serie huérfana tras el rollback');
  });
});

describe('deleteWorkout — no deja huérfanos', () => {
  test('borra workout, workoutExercises y sets juntos', async () => {
    const ex = await repo.createExercise({ name: 'Press banca' });
    const workout = await repo.createWorkout({ name: 'Libre', date: '2026-01-01' });
    const we = await repo.addExerciseToWorkout(workout.id, ex.id);
    await repo.addSet(we.id, { weight: 80, reps: 8 });
    await repo.addSet(we.id, { weight: 80, reps: 8 });

    await repo.deleteWorkout(workout.id);

    assert.equal(await db.workouts.get(workout.id), undefined);
    assert.equal((await db.workoutExercises.where('workoutId').equals(workout.id).toArray()).length, 0);
    assert.equal((await db.sets.where('workoutExerciseId').equals(we.id).toArray()).length, 0);
  });
});

describe('deleteExercise — nunca borra el histórico (por diseño)', () => {
  test('un entrenamiento pasado sigue existiendo tras borrar el ejercicio de la biblioteca', async () => {
    const ex = await repo.createExercise({ name: 'Press banca' });
    const workout = await repo.createWorkout({ name: 'Libre', date: '2026-01-01' });
    const we = await repo.addExerciseToWorkout(workout.id, ex.id);
    await repo.addSet(we.id, { weight: 80, reps: 8, done: true });

    await repo.deleteExercise(ex.id);

    const detail = await repo.getWorkoutDetail(workout.id);
    assert.equal(detail.exercises.length, 1, 'el registro histórico no se borra');
    assert.equal(detail.exercises[0].exercise, undefined, 'la ficha del ejercicio ya no existe');
    assert.equal(detail.exercises[0].sets[0].weight, 80, 'el dato de la serie sigue intacto');
  });
});

describe('deleteBar — limpia la referencia en los ejercicios que la usaban', () => {
  test('los ejercicios con esa barra por defecto quedan sin barra, no rotos', async () => {
    const bar = await repo.createBar({ name: 'Olímpica', weightKg: 20 });
    const ex = await repo.createExercise({ name: 'Sentadilla', equipmentType: 'barbell', defaultBarId: bar.id });

    await repo.deleteBar(bar.id);

    const updated = await repo.getExercise(ex.id);
    assert.equal(updated.defaultBarId, null);
  });
});

describe('getLastSessionForExercise — ignora sesiones vacías al buscar "la última vez"', () => {
  test('salta una sesión sin datos y encuentra la última con peso/reps reales', async () => {
    const ex = await repo.createExercise({ name: 'Hack' });

    const w1 = await repo.createWorkout({ name: 'Hace tiempo', date: '2026-01-01' });
    const we1 = await repo.addExerciseToWorkout(w1.id, ex.id);
    await repo.addSet(we1.id, { weight: 80, reps: 8 });

    // Sesión más reciente pero nunca rellenada (empezada y abandonada).
    const w2 = await repo.createWorkout({ name: 'Abandonada', date: '2026-01-08' });
    const we2 = await repo.addExerciseToWorkout(w2.id, ex.id);
    await repo.addSet(we2.id, {});

    const last = await repo.getLastSessionForExercise(ex.id);
    assert.equal(last.workout.id, w1.id, 'debe saltarse la sesión vacía y usar la que sí tiene datos');
    assert.equal(last.sets[0].weight, 80);
  });
});

describe('Validación en el borde repository.js↔Dexie', () => {
  test('createExercise rechaza un nombre vacío', async () => {
    await assert.rejects(() => repo.createExercise({ name: '   ' }), /obligatorio/);
  });

  test('createWorkout rechaza una fecha mal formada', async () => {
    await assert.rejects(() => repo.createWorkout({ name: 'X', date: '31/02/2026' }));
    await assert.rejects(() => repo.createWorkout({ name: 'X', date: 'no es una fecha' }));
  });

  test('addBodyWeight rechaza un peso negativo o cero', async () => {
    await assert.rejects(() => repo.addBodyWeight({ date: '2026-01-01', weightKg: -5 }));
    await assert.rejects(() => repo.addBodyWeight({ date: '2026-01-01', weightKg: 0 }));
  });

  test('addSet sanea (nunca lanza) un peso o reps negativos a null, en vez de guardarlos', async () => {
    const ex = await repo.createExercise({ name: 'X' });
    const workout = await repo.createWorkout({ name: 'X', date: '2026-01-01' });
    const we = await repo.addExerciseToWorkout(workout.id, ex.id);
    const set = await repo.addSet(we.id, { weight: -10, reps: -5 });
    assert.equal(set.weight, null);
    assert.equal(set.reps, null);
  });

  test('createBar rechaza un peso de barra que no sea un número positivo', async () => {
    await assert.rejects(() => repo.createBar({ name: 'Rota', weightKg: -20 }));
    await assert.rejects(() => repo.createBar({ name: 'Rota', weightKg: 'veinte' }));
  });
});

describe('importAllData — rechaza un archivo que no es un backup real antes de tocar nada', () => {
  test('un JSON sin la forma de un backup de Pegasus Tracker se rechaza sin borrar los datos actuales', async () => {
    const ex = await repo.createExercise({ name: 'No debe desaparecer' });

    await assert.rejects(() => repo.importAllData({ foo: 'bar' }));
    await assert.rejects(() => repo.importAllData({ data: { exercises: [] } })); // faltan workouts/sets

    const stillThere = await repo.getExercise(ex.id);
    assert.equal(stillThere.name, 'No debe desaparecer');
  });

  test('un backup válido con la forma correcta sí se acepta', async () => {
    const backup = { data: { exercises: [], workouts: [], sets: [] } };
    await assert.doesNotReject(() => repo.importAllData(backup));
  });
});

describe('importProgressData — una fila inválida no descarta el resto', () => {
  test('sigue importando las filas válidas aunque una tenga datos corruptos', async () => {
    const result = await repo.importProgressData({
      bodyWeight: [
        { date: '2026-01-01', weightKg: 80 },
        { date: 'fecha-invalida', weightKg: 80 }, // esta debe omitirse, no reventar el resto
        { date: '2026-01-02', weightKg: -5 }, // peso inválido, también se omite
        { date: '2026-01-03', weightKg: 79 },
      ],
    });
    assert.equal(result.bodyWeight, 2);
    assert.equal(result.skipped, 2);
    const all = await repo.listBodyWeight();
    assert.equal(all.length, 2);
  });
});
