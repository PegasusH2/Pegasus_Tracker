-- Añade la columna que faltaba en `workout_exercises` para el "peso objetivo
-- único" (targetWeightKg, ver js/db/repository.js) — una pista de peso al
-- empezar un entrenamiento (p.ej. leída de una foto al importar una rutina),
-- sin progresión por serie. El código local lleva tiempo enviando este campo
-- en cada creación de workout_exercises, pero la tabla remota nunca tuvo la
-- columna: TODAS las sincronizaciones de workout_exercises fallaban con
-- "Could not find the 'target_weight_kg' column of 'workout_exercises' in
-- the schema cache", y como `sets` depende de `workout_exercises` (FK), todas
-- sus series se quedaban igualmente atascadas en la cola de sincronización
-- ("violates foreign key constraint sets_workout_exercise_id_fkey").
--
-- Aditiva: nullable, no toca filas existentes. Ejecutar en el SQL Editor de
-- Supabase, en el proyecto de Pegasus Tracker.

alter table workout_exercises add column if not exists target_weight_kg numeric;
