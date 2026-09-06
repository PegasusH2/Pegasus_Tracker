-- Añade el componente en libras del peso de discos por lado, para poder
-- combinar discos grandes en kg con discos pequeños "fraccionarios" en lb
-- sobre la misma barra en ejercicios "Barra libre" (equipmentType='barbell').
-- Ejecutar en el SQL Editor de Supabase, en el proyecto de Pegasus Tracker.
--
-- Aditiva: plate_weight_per_side_kg conserva su significado — cuando ambas
-- unidades (kg y lb) están activas en Ajustes > Pesos pasa a representar solo
-- el componente en kg, y esta columna nueva el componente en lb; se SUMAN
-- para el total (weight sigue siendo siempre el total canónico en kg), mismo
-- patrón ya usado por weight_kg_part/weight_lb_part. Con una sola unidad
-- activa, el comportamiento no cambia: sigue siendo un único valor en
-- plate_weight_per_side_kg.
--
-- Primera migración numerada de Tracker — hasta ahora supabase/schema.sql se
-- mantenía como fichero único para instalaciones nuevas; a partir de aquí los
-- cambios sobre un proyecto YA existente se documentan aquí, y schema.sql se
-- actualiza en paralelo para que una instalación nueva parta ya con el
-- esquema final.

alter table sets add column if not exists plate_weight_per_side_lb_part numeric;
