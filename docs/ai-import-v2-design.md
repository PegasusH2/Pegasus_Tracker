# Rediseño de la importación de entrenamientos por IA — Propuesta V1

> Documento de análisis y propuesta. **No implementado todavía.** Basado en la
> lectura completa de 8 documentos reales del usuario (6 `.docx` de un
> programa de 4-8 semanas + 2 imágenes de tablas de 4 días) y 1 hoja Excel de
> un programa más simple de 5 días, más la arquitectura actual de PEGASUS
> (`worker/index.js`, `js/core/ai-import.js`, `js/db/schema.js`,
> `js/db/repository.js`, `js/views/workout-import.js`).

---

## 0. Resumen ejecutivo

Los documentos reales son **mucho más ricos** que el sistema actual de
importación: no solo tienen rangos/progresiones de reps (ya resuelto), sino
**semanas con prescripciones distintas** (reps, peso, RIR, técnica,
descanso, incluso equipamiento cambian semana a semana), **notación
compuesta** (`"75%6/50seg/60%8"`, `"8+drop2"`, `"12-15 RIR 0 + REST 30"+
FALLO"`), **superseries nombradas dentro de la celda del ejercicio**
(`"SS SET DEAD FRANCÉS + REMO Mancuerna"`), instrucciones de **RIR
progresivo** que no son un número, **TUT** como instrucción técnica, y
bloques de **notas generales del programa** (calentamiento, cómo repartir
la semana, cómo interpretar "RIR 2-0").

La buena noticia: el esquema de datos de PEGASUS **ya cubre casi todo esto**
(`targetRir`, `targetRestSeconds`, `notes`, `supersetGroupId`,
`targetRepsSequence`/`targetWeightSequence`, `defaultSetType` +
rest-pause/drop-set ya existen desde hace varias versiones). La pieza que
falta no es "más campos" — es **una estrategia para las semanas** y **un
único campo nuevo** para no perder nunca el texto original cuando la IA no
esté segura. Por eso la propuesta de abajo es deliberadamente pequeña en
cambios de esquema y grande en reglas de interpretación.

---

## 1. Qué ya existe en PEGASUS (no reinventar)

Confirmado leyendo `js/db/schema.js` y `js/db/repository.js` directamente:

| Campo (en `templateExercises` / `workoutExercises`) | Ya existe desde | Cubre |
|---|---|---|
| `targetRepsMin` / `targetRepsMax` | v6 | Rango (Caso 3) |
| `targetRepsSequence` / `targetWeightSequence` | v9 | Progresión/pirámide por serie (Casos 1, 2, 5) |
| `defaultSetType` (`normal`\|`fallo`\|`restpause`\|`descendente`) | v7 | Fallo, rest-pause, drop set (Casos 6, 7, 8) |
| `defaultRestPauseExtra` / `defaultDropSteps` | v7 | Reps extra de rest-pause / escalones de drop set |
| `defaultLastSetOnly` | v7 | Técnica solo en la última serie |
| `targetRir` | ya en `repository.js` | RIR **numérico simple** (parte de Caso 10) |
| `targetRestSeconds` | ya en `repository.js` | Descanso en segundos (Caso 12) |
| `notes` (string libre) | desde el inicio | Comentarios/instrucciones por ejercicio (Casos 11, 20) |
| `supersetGroupId` / `supersetOrder` | v6 | Superseries (Casos 13, 14) |
| `confidence` (a nivel de ejercicio, en la validación de `ai-import.js`) | ya existe | Ya dispara "Revisar — lectura poco segura" en la UI |
| `structureConfidence` (`high`\|`low`\|`none`) | ya existe en el Worker | Detección de una/varias rutinas (parcial del Caso 22) |

**Conclusión**: no hace falta rediseñar el modelo de datos de PEGASUS. Hace
falta (a) una **estrategia** para lo que hoy no tiene hueco (semanas), y (b)
**un** campo nuevo para no perder información cuando algo no se entiende.

---

## 2. La decisión arquitectónica clave: UNA sola rutina por día, no una por semana

Los 6 documentos `.docx` reales tienen esta forma:

```
                SEMANA 1        SEMANA 2        SEMANA 3        SEMANA 4
Ejercicio X     8+drop          8+drop          6+drop          AMRAP
                RIR 1-0         RIR 1-0         RIR 1-0         RIR 1-0
```

Es decir: **el mismo ejercicio tiene un objetivo distinto cada semana**. El
esquema actual de `templateExercises` solo admite **un** objetivo por
ejercicio.

**Decisión del usuario (no generar una plantilla por semana)**: en vez de
convertir cada columna de semana en una plantilla independiente, PEGASUS
debe importar **una única rutina por día**, eligiendo **un solo objetivo
por ejercicio** con esta regla determinista:

1. **Por defecto, usar la ÚLTIMA semana** de la tabla (la columna más a la
   derecha — ej. `"SEMANA 4"` o `"SEMANA 4 y 8"`). Es la versión más
   avanzada/progresada del ejercicio, la más representativa de "dónde
   termina" el plan.
2. **Si la celda de la última semana está vacía, dice "No se hace" o es
   claramente incompleta** para ese ejercicio en concreto, usar en su
   lugar la semana con **mayor número de series o repeticiones** de las
   disponibles para ese mismo ejercicio (un respaldo por volumen, no una
   media ni una interpolación).
3. Cuando se aplica el respaldo del punto 2, marcar `confidence: "low"` y
   dejar en `notes` una frase explícita (ej. "Semana 4 no especificada —
   se usó Semana 3 por tener más series/reps"), para que quede claro que
   no es literalmente lo que decía la última columna.

Esto es sensiblemente más simple que generar N plantillas: cero cambios en
`repository.js`, cero UI nueva para "elegir qué semana importar" — el
resultado de importar un documento multi-semana es exactamente **una**
rutina, igual que hoy con cualquier otra importación.

Efecto colateral positivo: "equipamiento distinto por semana"
(`multipower` semana 1 y 3, `mancuernas` semana 2 y 4) y "no se hace esta
semana" (Caso 19) se resuelven con la misma regla — se usa el
equipamiento/valor de la semana finalmente elegida (última, o su
respaldo), sin necesidad de modelar el cambio de equipamiento como tal.

---

## 3. El único campo nuevo: `rawText`

Hoy, cuando `confidence: 'low'`, la UI ya avisa ("Revisar — lectura poco
segura") — pero **no muestra qué decía el texto original**. El usuario solo
ve el número que la IA interpretó, sin poder comparar contra la fuente. Con
celdas como `"12-15 RIR 0 + REST 30"+ FALLO"` o `"4+DROp 2"` esto es
insuficiente: revisar "a ciegas" un valor de baja confianza no sirve de
mucho.

**Propuesta**: añadir `rawText` (string, nullable) a `templateExercises`
(migración v11, aditiva como todas las anteriores — `null` en todo lo
existente). Se rellena SIEMPRE que `confidence: 'low'`, con el texto
original de la celda tal cual apareció. La UI de revisión (ya existente en
`workout-import.js`) mostraría este texto junto al aviso, para que corregir
sea un vistazo, no una adivinanza.

Ningún otro campo nuevo es necesario para V1.

---

## 4. Estructura intermedia que debe devolver la IA

Extiende el esquema JSON que el Worker ya pide a Gemini
(`worker/index.js: EXERCISE_SCHEMA`/`SCHEMA`), sin romper nada de lo actual.
El documento sigue produciendo **rutinas planas** (una por día) — la
dimensión "semana" vive DENTRO de cada ejercicio, como una lista de
lecturas por semana que el código (no la IA) resuelve a un único valor
final (regla de §2):

```jsonc
{
  "programStructure": "single" | "multi_routine" | "multi_week_program",
  "structureConfidence": "high" | "low" | "none",
  "programNotes": "texto libre — calentamiento, reparto semanal, explicación de RIR...",
  "routines": [
    {
      "workoutName": "Día 1 · Pierna",
      "routineDescription": "nota general de ESTA rutina/día",
      "exercises": [ /* siempre plano — una rutina por día, ver abajo */ ],
      "unrecognized": []
    }
  ]
}
```

Cada ejercicio, extendiendo el `EXERCISE_SCHEMA` actual. Si el documento
NO tiene columnas de semana, es exactamente igual que hoy. Si SÍ las
tiene, la IA rellena `weekValues[]` con una entrada por columna detectada,
y dej a los campos planos (`repsMin`, `setType`...) en `null` — el código
los rellena después, resolviendo `weekValues[]` a un único valor:

```jsonc
{
  "recognizedName": "Press militar en rack",
  "sets": 3,
  "repsMin": null, "repsMax": null, "repsSequence": null, "weightSequence": null,
  "setType": "normal" | "fallo" | "restpause" | "descendente" | "amrap",
  "lastSetOnly": false,
  "extraReps": null, "steps": null,
  "restSecondsRaw": "2'",
  "rirRaw": "RIR 2-0",
  "tut": "1212",
  "equipmentHint": "multipower",
  "supersetGroup": "A", "supersetOrder": 1,
  "weightHintKg": null,
  "notes": "comentario del documento junto a este ejercicio",
  "confidence": "high" | "low",
  "rawText": "8+drop2",                 // SIEMPRE que confidence sea "low"

  // Solo si el documento tiene columnas "SEMANA N" — una entrada por columna,
  // en el mismo orden en que aparecen. El código elige UNA de estas (§2) y
  // vuelca su contenido en los campos planos de arriba.
  "weekValues": [
    { "weekLabel": "Semana 1", "sets": 3, "repsMin": null, "repsMax": null,
      "repsSequence": null, "setType": "descendente", "extraReps": null,
      "steps": null, "restSecondsRaw": "2'", "rirRaw": "RIR 1-0", "tut": null,
      "equipmentHint": null, "weightHintKg": null, "notes": null,
      "rawText": "8+drop" },
    { "weekLabel": "Semana 4", "sets": 3, "setType": "amrap", "rawText": "AMRAP", "...": "..." }
  ]
}
```

`restSecondsRaw`/`rirRaw`/`tut`/`equipmentHint` son intermedios: la IA los
extrae como texto porque leer/entender el documento es su trabajo; el
**código de PEGASUS** decide cómo aterrizan en los campos reales (ver §5).

---

## 5. División de responsabilidades: IA vs. código

Principio general: **la IA interpreta lenguaje/imagen; el código hace
aritmética y validación determinista.** Nunca al revés — pedirle a un LLM
que haga la conversión "1'30 → 90" es menos fiable y menos testeable que un
regex de 5 líneas.

| Tarea | Quién la resuelve | Por qué |
|---|---|---|
| Decidir si "12-10-8-6" es secuencia o rango | IA | Requiere entender el contexto/idioma del documento |
| Detectar "SS SET X + Y" y separarlo en 2 ejercicios con el mismo `supersetGroup` | IA | Requiere entender la frase |
| Convertir `"2'"` / `"1'30"` / `"20\""` a segundos | **Código** | Aritmética determinista — ya no depende de que el modelo "sepa sumar" |
| Convertir `"RIR 2-0"` en instrucción de texto vs. un número | IA decide texto/número; **código** solo copia el que corresponda | Ver Caso 10 |
| Elegir QUÉ semana usar por ejercicio (última; o respaldo por volumen si está vacía) | **Código**, a partir de `weekValues[]` que la IA ya extrajo | Es una regla fija y determinista (§2) — no depende de "entender" nada, solo de comparar |
| Decidir `confidence` y rellenar `rawText` | IA | Solo el modelo sabe si "no estaba seguro" al leer |
| Descartar valores literalmente vacíos/placeholder (`"4 x ,,,,"`, huecos) | **Código** (validación defensiva, ya existe en `ai-import.js`) | Mismo patrón que hoy con `cleanInt`/`cleanNum` |

---

## 6. Reglas de interpretación (extensión del prompt actual)

El prompt del Worker (`worker/index.js`) ya tiene correctamente resuelto:
rango vs. secuencia por presencia de "Nx", fallo, rest-pause con
`extraReps`, drop set con `steps`, superseries simples, notas por ejercicio
vs. comentario general. Reglas **nuevas** a añadir, con ejemplos sacados
literalmente de los documentos reales:

- **AMRAP**: la palabra `AMRAP` sola → `setType="amrap"`, deja `repsMin`/
  `repsMax`/`repsSequence` en `null`. Nunca inventar un número de reps.
  (Visto en `Día 2 Push.docx`, semana 4: `"AMRAP"`.)
- **RIR como progresión** (`"RIR 2-0"`, `"RIR 1-0"`): NO es RIR literal de
  cada serie. Va a `rirRaw` (texto), el código lo copia a `notes` con una
  frase clara (ej. "RIR progresivo 2→0 a lo largo de las series"); NUNCA se
  intenta partir en N valores automáticamente. Si aparece un RIR simple
  (`"RIR 0"`, `"RIR 1"`) sin guion, sí puede ir al campo `targetRir`
  numérico existente.
- **"FALLO TOTAL"** como cabecera de columna (en vez de un RIR): equivale a
  "todas las series de esa semana van al fallo". Se guarda como el
  `setType` de esa entrada en `weekValues[]`; si el código termina
  eligiendo esa semana (§2), se traduce en `defaultSetType="fallo"` del
  ejercicio final.
- **TUT** (`"TUT CONTROLADO"`, `"TUT 1212"`): siempre instrucción de
  técnica, nunca repeticiones. Va a `tut` → el código lo antepone a
  `notes` (ej. "TUT: 1212").
- **Descanso variable o "SIN DESCANSO"**: `"DESCANSO 2'"` → 120s exactos.
  `"DESCANSO 2-3'"` (rango) → el código toma el **promedio** redondeado
  (150s) y dej a el texto original en `notes` para transparencia — no es
  ambiguo, es una simplificación explícita y documentada, no requiere
  `needs_review`. `"SIN DESCANSO"` → `0`.
- **Combinación peso%+cluster** (`"75%6/50seg/60%8"`): patrón nuevo no
  cubierto por los 22 casos originales — significa "6 reps al 75% de tu
  1RM, 50s de descanso interno, luego 8 reps al 60%". Es estructuralmente
  un rest-pause con **dos** bloques de reps a intensidades distintas. Como
  PEGASUS no modela porcentajes de 1RM hoy, para V1: `setType="restpause"`,
  `extraReps=[8]` (el segundo bloque), y el detalle completo (intensidades
  %) queda en `notes` tal cual aparece — nunca convertir el % en un peso
  concreto (eso exigiría saber el 1RM real del usuario, que la IA no
  conoce). `confidence: "low"` siempre que haya un `%` en la celda, porque
  PEGASUS no tiene un campo dedicado a intensidad relativa.
- **Compound "8+drop", luego "4+DROP 2"**: `drop` sin número = técnica sin
  desglose (no inventar `steps`); `drop 2` = un escalón adicional
  conocido → si puede aislarse con seguridad, `steps=[{reps:2}]`; si no,
  `confidence:"low"` + `rawText`.
- **"PARCIALES"** (`"10+PARCIALES"`) y cualquier otra técnica no listada en
  los 22 casos (aparece en los documentos reales y no estaba en la
  especificación original): no crear un `setType` nuevo por cada técnica
  rara. Regla general: **solo entran en el enum de `setType` las técnicas
  ya soportadas por PEGASUS** (normal/fallo/restpause/descendente/amrap);
  cualquier técnica no reconocida se deja como `setType="normal"` +
  `confidence:"low"` + `rawText` con el texto exacto, para que el usuario
  la re-etiquete manualmente. Esto evita que cada documento nuevo obligue a
  ampliar el esquema.
- **"Idem, día anterior"** / referencias cruzadas a otro día: siempre
  `confidence:"low"`, `rawText` con la frase exacta, sin intentar resolver
  la referencia automáticamente (requeriría saber qué día es "el anterior"
  con certeza, y equivocarse aquí sería peor que preguntar).
- **Variantes de equipamiento por semana** (`"multipower"`/`"mancuernas"`
  como subcabecera bajo cada columna de semana): se guarda como
  `equipmentHint` de esa entrada en `weekValues[]`; el equipamiento que
  termina apareciendo en `notes` del ejercicio final es el de la semana
  que el código haya elegido (§2), no una mezcla de todas.
- **Ejercicio repetido dos veces en el mismo día** (ej. "Press Militar"
  aparece dos veces en `Día 4 Carentes.docx`, una vez con esquema %+cluster
  y otra con reps fijas por equipo): son bloques distintos — se importan
  como dos entradas de ejercicio independientes en la misma plantilla, en
  el orden en que aparecen. No fusionar ni deduplicar por nombre.

---

## 7. Detección de estructura (rutina única / varias rutinas / programa con semanas)

Extiende la lógica de `structureConfidence` que YA existe (no la sustituye):

1. **¿Hay más de un "DIA"/nombre de rutina?** → ya resuelto hoy
   (`MODE_INSTRUCTIONS.multi` en el Worker). Sin cambios.
2. **¿Hay columnas o bloques literalmente titulados "SEMANA N"?** → señal
   nueva, de alta confianza porque es un patrón textual explícito, igual de
   fiable que detectar "DIA 1/2/3". Si se detecta, el documento se marca
   `programStructure: "multi_week_program"` y cada ejercicio rellena
   `weekValues[]` (una entrada por columna) en vez de los campos planos
   directamente — pero la rutina resultante sigue siendo **una sola por
   día** (§2), nunca una por semana.
3. **¿Las columnas de semana contienen solo una plantilla de fecha en
   blanco (`"    /    /"`) sin números?** → esto NO es una prescripción
   distinta por semana, es un **cuaderno de registro** (el usuario apunta
   la fecha en que hizo cada semana). En ese caso, `weekValues[]` NO se
   genera — se trata como una única prescripción fija (campos planos
   normales), exactamente como ya funciona hoy. (Visto en `5 dias F1
   Abril.xlsx`.)

---

## 8. Cuándo se dispara `needs_review` (= `confidence: "low"` + `rawText`)

Reutilizando el mecanismo que YA existe en la UI (no uno nuevo):

- Cualquier técnica no reconocida en el enum de `setType` de PEGASUS.
- Cualquier número de "drop"/"rest pause" que no pueda aislarse con
  seguridad del texto (ej. `"drop"` sin número seguido de otro texto
  ambiguo).
- Cualquier celda con más de una señal mezclada que el modelo no pueda
  separar limpiamente (ej. `"12-15 RIR 0 + REST 30"+ FALLO"` combinando
  rango + RIR + descanso + técnica en una sola celda).
- Referencias cruzadas ("ídem día anterior", "igual que...").
- Presencia de `%` de intensidad (1RM) sin más contexto, porque PEGASUS no
  tiene campo para ello.
- Celdas con placeholders vacíos que parecen datos pero no lo son
  (`"4 x ,,,,"`) — en este caso ni siquiera se crea el ejercicio con datos
  inventados: se importa con reps `null` y `confidence:"low"`.

---

## 9. Flujo completo (sin cambios en la filosofía híbrida ya establecida)

```
IMAGEN/DOCUMENTO
  ↓
IA (Gemini) — devuelve la estructura intermedia de §4; si hay columnas de
              semana, cada ejercicio trae weekValues[] en vez de valores planos
  ↓
CÓDIGO — validación defensiva (igual que ai-import.js hoy) +
         conversión determinista (descanso a segundos, promedios) +
         si hay weekValues[]: resuelve UN valor final por ejercicio
         (última semana; respaldo por volumen si está vacía — §2)
  ↓
REVISIÓN DEL USUARIO — igual que hoy (workout-import.js): revisa la rutina
  ya resuelta, con rawText visible en cualquier item de confidence "low"
  ↓
RUTINA PEGASUS — mismas funciones de repository.js de siempre
  (createTemplate/addTemplateExercise), sin ninguna ruta paralela
```

---

## 10. Alcance explícito de V1 (qué NO cubre, a propósito)

Para que "sencilla" sea real y no solo una intención:

- **No** se modela un "programa" como entidad enlazada con progresión
  automática semana-a-semana. El documento se importa como **una única
  rutina** por día, resolviendo cada ejercicio a la última semana
  disponible (o su respaldo por volumen — §2). Un modelo real de
  "programa con fases" que recuerde y aplique las 4-8 semanas completas es
  un proyecto V2 aparte, no una condición para arrancar V1.
- **No** se modela el % de 1RM como campo — queda como texto en `notes`.
- **No** se intenta resolver referencias cruzadas ("ídem día anterior").
- **No** se añade un `setType` por cada técnica rara que aparezca en un
  documento — solo las que PEGASUS ya soporta, más `amrap`. El resto cae en
  `needs_review` con el texto original intacto.
- **No** se cambia nada del motor de progresión (`js/core/progression.js`)
  ni de `startWorkoutFromTemplate` — todo lo nuevo vive en la capa de
  importación, no en el modelo de entrenamiento en sí.

---

## 11. Cambios de esquema necesarios (resumen)

Uno solo: `rawText` (string, nullable) en `templateExercises`, migración
v11, aditiva, `null` en todo lo existente — mismo patrón que las 10
migraciones anteriores. Ningún otro store ni campo indexado cambia.

---

## 12. Catálogo de test cases (oficial)

Los 22 casos originales del usuario **más** los descubiertos al leer los
documentos reales, listados en §6 (AMRAP en columna de semana, "FALLO
TOTAL" como cabecera, combinación %+cluster tipo rest-pause, "PARCIALES",
"SIN DESCANSO", "ídem día anterior", ejercicio repetido en el mismo día,
semana-como-cuaderno-de-registro vs. semana-como-prescripción, cabeceras de
día con descripción inline como `"Dia 1: Pectoral y abdomen."`) quedan
recogidos aquí como el conjunto de prueba de referencia para validar
cualquier implementación futura del parser, contra los propios documentos
fuente:

- `Día 1 Pierna.docx`, `Día 2 Push.docx`, `Día 3 Tirón.docx`,
  `Día 4 Carentes.docx`, `Día 3 Pierna B.docx`, `Día 4 Tirón.docx`
  (programa de 4-8 semanas, el más completo — cubre casi todos los casos).
- Imagen de tabla de 4 días (Remo/Jalón/Press militar... con progresiones
  descendentes, rest-pause con duración, rangos).
- `5 dias F1 Abril.xlsx` (semana-como-cuaderno-de-registro, patrón
  `"4x15-12-10-8+2d"`, "Idem, día anterior").
- `5 dias 2022 Noviembre 2.xlsx` (formato plano sin semanas, útil como caso
  "simple" de control).
