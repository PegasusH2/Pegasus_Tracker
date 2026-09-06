-- Retira "grupo muscular" de los ejercicios — sin uso real más allá de una
-- etiqueta y del agrupado opcional de "Crear rutina desde cero" (pestaña
-- "Grupos", retirada del código junto con este campo). Decisión explícita
-- del usuario: no solo se deja de leer/escribir, se elimina el dato.
--
-- IRREVERSIBLE: se pierde el grupo muscular que tuviera cada ejercicio.
-- Ejecutar en el SQL Editor de Supabase, en el proyecto de Pegasus Tracker.

alter table exercises drop column if exists muscle_group;
