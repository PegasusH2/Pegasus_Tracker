# CLAUDE_CONTEXT.md — Memoria técnica de PEGASUS (Pegasus Tracker)

> Generado a partir de una lectura completa del código actual del repositorio
> (rama `main`, working tree limpio en el momento de escribir esto). Objetivo:
> que una sesión nueva de Claude Code pueda continuar el desarrollo sin
> necesitar el historial de conversación previo. Todo lo aquí descrito está
> verificado contra el código real; donde no ha sido posible verificarlo se
> indica explícitamente como "desconocido".

---

## 1. Qué es PEGASUS y objetivo de la V1

PEGASUS (nombre de producto: **"Pegasus Tracker"**, antes "Fitness Tracker")
es una aplicación web progresiva (PWA) **personal, de un solo usuario, sin
cuentas ni backend propio**, para:

- Registrar entrenamientos de gimnasio (series, repeticiones, peso, RIR,
  técnicas especiales).
- Crear y reutilizar rutinas/plantillas de entrenamiento.
- Hacer seguimiento de progreso corporal (peso corporal, medidas, plicómetro
  /% de grasa estimado).
- Importar rutinas desde una foto (papel, pizarra, captura) usando IA
  (Gemini) a través de un proxy propio (Cloudflare Worker).

Todos los datos viven **exclusivamente en el navegador** (IndexedDB vía
Dexie.js). No hay servidor de aplicación, no hay sincronización entre
dispositivos, no hay login. El único servicio externo es el Worker de IA,
usado solo para la función de importación por foto.

El objetivo de "V1" (según el propio código y comentarios, no hay un
documento de producto separado en el repo) parece ser: una app instalable,
usable a diario para registrar entrenamientos reales, con importación de
rutinas asistida por IA como diferenciador. No existe en el repo un
documento de alcance/roadmap formal — el alcance de "V1" se infiere del
estado actual del código, no de una especificación escrita.

---

## 2. Arquitectura actual

- **Sin build step, sin framework, sin bundler, sin `package.json`.**
  JavaScript vanilla con módulos ES nativos (`<script type="module">`).
- **Enrutado**: hash-routing manual en el cliente (`location.hash` +
  evento `hashchange`), implementado a mano en [js/app.js](js/app.js) —
  no hay librería de routing.
- **Persistencia**: IndexedDB vía **Dexie.js** (vendored como script global,
  no como módulo npm), con migraciones de esquema versionadas en
  [js/db/schema.js](js/db/schema.js).
- **Capa de acceso a datos**: [js/db/repository.js](js/db/repository.js)
  centraliza TODO el CRUD; las vistas nunca llaman a Dexie directamente.
- **Estado de UI**: no hay un state manager. Existe un bus de eventos
  pub/sub minimalista ([js/core/store.js](js/core/store.js): `on`/`emit`)
  usado puntualmente, y un helper de `toast()`. El estado real de la app
  vive en IndexedDB; las vistas leen/escriben ahí directamente.
- **Modales/confirmaciones**: sistema propio de "bottom sheet" en
  [js/core/ui.js](js/core/ui.js) (`openSheet`, `openConfirmSheet`) — se usa
  en vez de `window.confirm`/`alert` deliberadamente (compatibilidad con PWA
  instalada en iOS).
- **Service Worker** ([sw.js](sw.js)): estrategia precache-en-instalación +
  cache-first-con-fallback-a-red. Requiere subir manualmente la constante
  `CACHE_VERSION` en cada despliegue para invalidar caché en dispositivos
  con la PWA ya instalada.
- **Gráficas**: Chart.js (vendored, script global, no módulo).
- **IA de importación por foto**: un **Cloudflare Worker** independiente
  (carpeta `worker/`, despliegue separado con `wrangler deploy`, NO forma
  parte del sitio estático de GitHub Pages) actúa como proxy hacia la API de
  Google Gemini. La PWA nunca llama a Gemini directamente ni conoce la
  API key de Gemini.
- **Hosting**: GitHub Pages, sirviendo el repo estático directamente desde
  `main` / raíz (sin Actions de build propias más allá del pipeline nativo
  de Pages).

---

## 3. Estructura de carpetas y archivos importantes

```
/
├── index.html                 punto de entrada único, carga app.js como módulo
├── manifest.json               manifest PWA (nombre, iconos, colores)
├── sw.js                       Service Worker (precache + cache-first)
├── README.md                   descripción de una línea, sin detalle técnico
├── css/
│   ├── base.css                tokens de diseño (colores, tipografía, spacing)
│   ├── layout.css               layout de app shell, bottom-nav, sheets, onboarding
│   └── components.css          componentes: tarjetas de acción, filas de serie,
│                                calendario, importación por foto, home, etc.
├── icons/                      iconos PWA (192/512/maskable) + icons/muscles/*.png
├── js/
│   ├── app.js                   shell, tabla de rutas, boot de la app
│   ├── core/
│   │   ├── store.js             bus de eventos pub/sub (on/emit)
│   │   ├── ui.js                 sheets/confirmaciones/toast (UI helpers)
│   │   ├── format.js              helpers de formato (fechas, números…)
│   │   ├── escape.js              escape de HTML para render manual
│   │   ├── settings.js            preferencias persistidas (localStorage/IDB — ver §14)
│   │   ├── units.js                conversión kg↔lb (siempre desde el valor canónico kg)
│   │   ├── progression.js          motor local de progresión/insights (NO-IA)
│   │   ├── stats.js                estadísticas (1RM, PRs, tendencias, %grasa)
│   │   ├── skinfold-points.js      puntos/lógica de plicómetro
│   │   ├── exercise-match.js       fuzzy-matching de nombres de ejercicio (Levenshtein)
│   │   └── ai-import.js            cliente de importación por foto (llama al Worker)
│   ├── db/
│   │   ├── schema.js               definición Dexie + migraciones versionadas
│   │   └── repository.js           TODO el CRUD de la app
│   └── views/                     18 archivos, uno por pantalla/subpantalla (ver §13)
└── worker/
    ├── index.js                    Cloudflare Worker (proxy a Gemini)
    ├── wrangler.toml                config de despliegue del Worker
    └── README.md                    instrucciones de despliegue del Worker
```

No existe carpeta `tests/`, ni `.claude/skills` de proyecto, ni CI propio
más allá del pipeline nativo de GitHub Pages. Existe `.claude/launch.json`
(ver §20).

---

## 4. Tecnologías utilizadas

- **JavaScript vanilla (ES modules)** — sin TypeScript, sin JSX, sin build.
- **Dexie.js** (vendored en `js/lib/dexie.min.js`, cargado como script
  global, no como import de módulo) — envoltorio sobre IndexedDB.
- **Chart.js** (vendored en `js/lib/chart.umd.min.js`, script global) —
  gráficas de progreso.
- **CSS puro** con custom properties (design tokens), sin preprocesador,
  sin framework de utilidades (no Tailwind).
- **Cloudflare Workers** + **Wrangler CLI** — runtime y despliegue del proxy
  de IA.
- **Google Gemini API** (`gemini-flash-latest`, configurable vía variable
  de entorno `GEMINI_MODEL` en `wrangler.toml`) — modelo de IA usado por el
  Worker, con salida forzada a JSON estructurado (`responseSchema` /
  `responseMimeType: application/json`).
- **GitHub Pages** — hosting estático del sitio principal.
- **Service Worker API** nativa — soporte offline/instalación.

No hay `package.json` en la raíz del proyecto ni en `worker/` (Wrangler no
lo requiere para un Worker de un solo archivo sin dependencias npm).

---

## 5. Modelo de datos actual

Basado en [js/db/schema.js](js/db/schema.js). Versión de esquema actual:
**`SCHEMA_VERSION = 11`**. Todas las migraciones (v1→v11) son **aditivas y
no destructivas**: nunca se elimina ni se transforma con pérdida de datos
existentes; los campos nuevos siempre reciben un valor por defecto seguro
mediante `.upgrade()`.

Tablas (stores) actuales:

- **`exercises`** — biblioteca de ejercicios. Incluye (desde v10) el campo
  indexado `isFavorite`.
- **`workouts`** — sesiones de entrenamiento realizadas (o en curso).
- **`workoutExercises`** — ejercicios dentro de un `workout` concreto.
  Incluye (desde v9) `targetRepsSequence` / `targetWeightSequence` para
  progresiones/pirámides por serie, en paralelo al rango uniforme
  `targetRepsMin`/`targetRepsMax`.
- **`sets`** — series individuales (reps, peso, RIR, tipo de serie, hecha/no
  hecha, etc.).
- **`bodyWeight`** — registros de peso corporal.
- **`measurementTypes`** — tipos de medida corporal definidos por el
  usuario (p. ej. "cintura", "brazo").
- **`measurements`** — valores registrados para cada `measurementType`.
- **`skinfoldSites`** — puntos de pliegue cutáneo (plicómetro).
- **`skinfoldEntries`** — mediciones de plicómetro.
- **`settings`** — preferencias/ajustes persistidos (clave-valor).
- **`templates`** — plantillas de rutina. Incluye (desde v10) el campo
  `description`.
- **`templateExercises`** — ejercicios dentro de una plantilla. Incluye
  (desde v9) `targetRepsSequence` / `targetWeightSequence`, igual que
  `workoutExercises`; y (desde v11) `rawText` — texto original de la celda
  cuando la importación por IA marca el ejercicio con confidence baja (ver
  §10 y `docs/ai-import-v2-design.md`). También ya existían `targetRir` y
  `targetRestSeconds` (RIR y descanso objetivo, en segundos) desde antes.
- **`bars`** — configuraciones de barra libre (peso de barra + discos por
  lado), añadida en schema v8.

**Regla de negocio confirmada en código**: cuando un ejercicio tiene un
rango uniforme (p. ej. "8-12"), el prefill al iniciar una sesión usa el
**límite INFERIOR** del rango (no el superior — este fue un comportamiento
corregido explícitamente durante el desarrollo, ver §15).

**Gap conocido del modelo de datos / backup**: la constante `TABLES` en
`js/db/repository.js`, usada por `exportAllData` / `importAllData` /
`clearAllData`, **NO incluye la tabla `bars`** (añadida en schema v8). Esto
significa que las configuraciones de barra libre probablemente no se
incluyen en la copia de seguridad/restauración de datos. Ver §16.

---

## 6. Funcionalidades actualmente implementadas

(Detalle por área en §7–§13. Resumen de alto nivel, todo verificado en
código):

- Registro de entrenamientos con series, reps, peso (kg y lb), RIR, y tipos
  de serie especiales (fallo, rest-pause, descendente).
- Rango de repeticiones y progresión/pirámide de repeticiones por serie
  como conceptos independientes.
- Peso de barra libre configurable (barra + discos por lado).
- Biblioteca de ejercicios con favoritos y "recientes" (derivados del
  historial, no una tabla dedicada).
- Creación de rutinas/plantillas: (a) manualmente vía un asistente de 3
  pasos, (b) importando desde foto vía IA (con revisión/edición humana
  antes de guardar).
- Historial y calendario de entrenamientos.
- Progreso: peso corporal, medidas corporales, plicómetro/% de grasa
  estimado (fórmula Jackson & Pollock 7 pliegues), estimación de 1RM
  (fórmula de Epley), mejores marcas (PRs), tendencias.
- Motor de insights de progresión local (sin IA) comparando sesiones.
- Exportar/importar/borrar todos los datos (backup local), con la salvedad
  de la tabla `bars` señalada en §5/§16.
- Ajustes de unidades (kg/lb), secciones de progreso activables/
  desactivables, onboarding inicial.
- Modo claro/oscuro automático vía `prefers-color-scheme` (sin selector
  manual de tema en la app).
- PWA instalable con Service Worker offline-first.

---

## 7. Estado actual del sistema de entrenamientos

Implementado y funcional:

- Iniciar un entrenamiento libre (sin plantilla) o desde una plantilla
  existente (`startWorkoutFromTemplate` en `js/db/repository.js`).
- Al materializar desde plantilla: honra `targetRepsSequence` /
  `targetWeightSequence` por serie cuando existen, y si no, usa el rango
  con prefill al límite inferior; los valores de la ÚLTIMA sesión real
  registrada para ese ejercicio tienen prioridad sobre los valores
  planeados de la plantilla, si existen.
- Registro por serie: reps, peso (kg/lb, columnas independientes con
  recálculo en vivo del otro sistema de unidades desde el valor canónico
  kg), RIR, marcado de "hecha".
- Tipos de serie: normal, fallo, rest-pause, descendente — con soporte de
  `extraReps` (rest-pause con desglose de reps) y `steps` (descendente con
  peso/reps por escalón).
- Modo "focus" (`/entreno/sesion/:id`) sin bottom-nav durante el
  entrenamiento activo.
- Historial y calendario de entrenamientos ya realizados
  (`workout-history.js`, `workout-calendar.js`).

Estado de la vista de sesión (`workout-session.js`): implementada según el
resumen del agente de exploración; no releída línea a línea en esta pasada
final — comportamiento de detalle (p. ej. gestión exacta de reordenar
series) se considera **no verificado exhaustivamente**, aunque el flujo
principal sí está confirmado a través de la creación de la sesión y del
motor de progresión que la consume.

---

## 8. Estado actual de las rutinas

Implementado:

- **Plantillas** (`templates.js`): listado en rejilla (`template-grid`),
  colapsable ("Mis rutinas", preferencia `templatesGridCollapsed`, tri-estado
  nullable), creación/edición con selector de icono (emoji o ilustración de
  músculo), campo `description` (schema v10), sheet dedicado para configurar
  el target por ejercicio (rango o secuencia).
- **Asistente manual de creación** (`routine-wizard.js`, ruta
  `/entreno/rutina-nueva`, modo focus sin bottom-nav): flujo de 3 pasos con
  creación masiva de ejercicios.
  - **Limitación conocida**: el Paso 3 (revisión) muestra el texto fijo
    "3 series" para CADA ejercicio revisado, independientemente del target
    realmente configurado — este wizard no tiene un paso dedicado de
    edición de target por ejercicio (a diferencia del sheet de
    `templates.js`). Ver §16.
- **Importación desde foto** (`workout-import.js`): genera una rutina
  reutilizable (plantilla), no un entrenamiento del día — corregido
  explícitamente durante el desarrollo (ver §15).
  - **Limitación conocida**: la detección de superseries (agrupación
    A1/A2) se muestra al usuario mediante una nota explícita en la UI, pero
    NO se implementa realmente como ejercicios agrupados — cada elemento de
    la superserie se guarda como ejercicio independiente. El propio código
    fuente lo documenta: *"Se detectaron superseries (A1/A2…) — de momento
    se crean como ejercicios independientes; la agrupación real llegará más
    adelante."* Ver §16.
- Pantalla "Entreno" reorganizada en dos secciones independientemente
  colapsables: **"Acciones"** (Nueva rutina manual / Entrenamiento libre /
  Importar desde foto) renderizada PRIMERO, y **"Mis rutinas"** después.

---

## 9. Estado actual del sistema de progreso

Implementado (`progress-hub.js` + vistas específicas):

- **Resumen** — hub de progreso con subtabs.
- **Peso** (`bodyweight.js`) — registro y tendencia de peso corporal.
- **Medidas** (`measurements.js`) — tipos de medida definidos por el
  usuario + histórico de valores por tipo.
- **Plicómetro** (`skinfold.js`) — sitios de pliegue + entradas +
  estimación de % de grasa corporal (Jackson & Pollock 7 pliegues,
  `estimateBodyFatJP7` en `js/core/stats.js`).
- Cálculos compartidos en `js/core/stats.js`: 1RM estimado (Epley,
  etiquetado explícitamente como orientativo, no médico), mejores marcas
  históricas, series de tendencia, filtrado por periodo.
- Las subtabs de Progreso se filtran dinámicamente: solo se muestran las
  secciones que el usuario tiene activadas en Ajustes (si ninguna está
  activa, el propio tab "Progreso" se oculta del bottom-nav).

**Estado de "análisis con IA" del progreso**: existe una vista completa
(`ai-analysis.js`) con selector de periodo y checkboxes de categorías de
datos, y una pantalla de resumen/preview — pero **NO está conectada a
ningún backend ni modelo de IA**. Al confirmar, el único efecto es un
`toast()`: *"El análisis con IA todavía no está conectado. Se añadirá en
una fase posterior."* Esto es una funcionalidad de UI completa pero sin
lógica real detrás — ver §11 y §19.

---

## 10. Estado actual de la importación mediante IA

Cliente: [js/core/ai-import.js](js/core/ai-import.js).

- Flujo: el usuario sube/hace una foto → se redimensiona en el cliente
  (canvas, sin librerías, máx. 1600px de lado, calidad 0.85 JPEG) → se
  envía en base64 al Worker propio → la respuesta JSON se valida
  defensivamente (`validateImportedProgram`/`validateExercises`) antes de
  tocar IndexedDB → el usuario revisa/edita cada rutina y exercise
  reconocido antes de guardar nada (filosofía "híbrida": la IA propone, el
  usuario confirma).
- Modos de importación: `single` (una rutina), `multi` (programa completo,
  varias rutinas), `auto` (detección automática con
  `structureConfidence`: `high`/`low`/`none`).
- Matching difuso de nombres de ejercicio reconocidos contra la biblioteca
  existente del usuario vía Levenshtein (`exercise-match.js`, umbral 0.6).
- **Validación defensiva real**: cada campo se limpia/descarta por
  separado (`cleanInt`/`cleanNum`/`cleanStr`); solo lanza si la respuesta
  ni siquiera es un objeto reconocible.
- **Regla crítica de interpretación de reps** (implementada tanto en el
  prompt del Worker como en el validador del cliente): rango vs.
  secuencia/progresión por serie se decide por la presencia o ausencia de
  un prefijo explícito "Nx" delante de los números — NO por el número de
  valores ni el tipo de separador. Validada con una fixture de regresión de
  4 días de rutina real (`REGRESSION_FIXTURE_4DAY` en el propio archivo,
  función `mockRegressionFixture4Day()`), probada end-to-end a través de la
  UI real y la base de datos.
- **Interpretación V2 (programas con semanas, AMRAP, RIR progresivo, TUT,
  descanso, técnicas no soportadas)** — implementada según
  `docs/ai-import-v2-design.md`, verificada end-to-end con datos sintéticos
  y con una sesión real creada desde una plantilla importada:
  - `setType` ahora incluye `"amrap"` (además de
    normal/fallo/restpause/descendente), soportado también en el editor
    manual de rutinas (`templates.js`) y en la sesión en vivo
    (`workout-session.js`), no solo en la importación.
  - **RIR**: un valor simple (`"RIR 0"`) va al campo numérico `rir` de
    siempre; una progresión (`"RIR 2-0"`, dos números con guion) NUNCA se
    reparte en números inventados por serie — se guarda como instrucción
    de texto en `notes` (`parseRirRaw` en `ai-import.js`).
  - **Descanso**: la IA solo extrae el texto tal cual (`restSecondsRaw`);
    la conversión a segundos es **determinista, en el código**, no en el
    modelo (`parseRestSecondsRaw`) — reconoce `"2'"`, `"1'30"`, `"20\""`,
    rangos tipo `"2-3'"` (usa el promedio) y `"SIN DESCANSO"` (0s). Si el
    texto no encaja con ningún patrón, se deja como nota legible en vez de
    inventar un número.
  - **Programas con semanas** ("SEMANA 1/2/3/4..."): la IA NO genera una
    plantilla por semana — cada ejercicio trae `weekValues[]` (una entrada
    por columna de semana) y el código elige un único valor final por
    ejercicio: por defecto la **última semana**; si esa celda está vacía o
    incompleta, usa como respaldo la semana con más series/reps de las que
    sí tengan datos (`resolveWeekValues` en `ai-import.js`), marcando
    `confidence:"low"` y explicando en `notes` qué semana se usó en su
    lugar. El resultado sigue siendo **una única rutina por día importado**,
    nunca varias plantillas por el mismo día.
  - **Técnicas no soportadas** (ej. "PARCIALES") o celdas ambiguas: se
    guardan como `setType:"normal"` + `confidence:"low"` + el texto
    original en el nuevo campo `rawText`, visible en la UI de revisión
    (`workout-import.js`) junto al aviso "Revisar — lectura poco segura",
    para que el usuario compare contra la fuente en vez de corregir a
    ciegas.
  - Ver `docs/ai-import-v2-design.md` para el catálogo completo de casos
    (basado en documentos reales de programas de 4-8 semanas) y qué queda
    explícitamente fuera de esta V1 (modelo de "programa" enlazado con
    progresión automática, % de 1RM como campo propio, resolución de
    referencias cruzadas tipo "ídem día anterior").
- **Fallback simulado**: si `WORKER_URL` estuviera vacío, la app usaría
  mocks (`mockAnalyzeProgramPhoto`) para poder probar el flujo sin
  depender del Worker desplegado. Actualmente `WORKER_URL` SÍ está
  configurado (ver §11), así que en producción se usa el Worker real, no
  el mock.
- **Detalle de seguridad a tener en cuenta** (ver también §16): tanto
  `WORKER_URL` como `APP_SHARED_TOKEN` están **hardcodeados en texto plano**
  en este archivo cliente, que se sirve públicamente vía GitHub Pages. El
  propio comentario del Worker (`worker/index.js`) lo reconoce: el token
  "NO es un secreto real (vive en el JS de la PWA), solo frena
  rastreadores/bots" — no es una vulnerabilidad nueva a introducir, es una
  limitación de diseño ya asumida y documentada en el propio código, pero
  merece mención explícita en cualquier auditoría futura.

**Modo administrador (desde `js/core/ai-import.js`)**: `analyzeWorkoutPhoto`
acepta un tercer argumento opcional `{ adminToken }`; si se pasa un token de
sesión de administrador no caducado, se envía como cabecera
`X-Admin-Session` y el Worker salta el rate limiting para esa petición (ver
§11). `adminLogin(password)` hace `POST` a `${WORKER_URL}/admin/login` con
la contraseña, y si es correcta devuelve `{ token, expiresAt }` — **nunca**
la contraseña ni ningún secreto permanente. Ese token es lo único que se
persiste en el dispositivo (vía `js/core/settings.js`, clave `adminSession`,
tabla `settings` de IndexedDB — no `localStorage`), y caduca solo. La
contraseña de administrador en sí (`ADMIN_SECRET`) NUNCA se envía más de una
vez (en el login), nunca se guarda en el cliente, y no vive en ningún
archivo de este repo.

---

## 11. Estado actual de la API/proxy de IA

Cloudflare Worker en `worker/index.js`, desplegado de forma independiente
al sitio de GitHub Pages.

- **Función**: proxy autenticado hacia Google Gemini
  (`gemini-flash-latest` por defecto, configurable vía `env.GEMINI_MODEL`).
  La API key de Gemini vive SOLO como secreto de Cloudflare
  (`wrangler secret put GEMINI_API_KEY`), nunca en el repo.
- **Autenticación simple**: cabecera `X-App-Token` comparada contra
  `env.APP_SHARED_TOKEN` (secreto de Cloudflare) — un filtro anti-abuso
  básico, no un sistema de auth real (ver nota de seguridad en §10).
- **Entrada esperada**: `{ image (base64), mimeType, mode }`, límite de
  tamaño `MAX_BASE64_LENGTH = 8_000_000` (~6MB de imagen real).
- **Prompt y schema extendidos** (ver `docs/ai-import-v2-design.md`): además
  de las reglas originales de rango/secuencia/fallo/rest-pause/drop-set/
  superserie simple, el prompt ahora cubre AMRAP, RIR progresivo, TUT,
  descanso (como texto, la conversión a segundos la hace el cliente),
  superseries nombradas dentro del propio nombre del ejercicio ("SS SET X +
  Y"), variantes de equipamiento por semana, y detección de columnas
  "SEMANA N" (`weekValues[]` por ejercicio). `EXERCISE_SCHEMA` añadió
  `restSecondsRaw`, `rirRaw`, `tut`, `equipmentHint`, `rawText`,
  `weekValues` (con su propio `WEEK_VALUE_SCHEMA`), y `"amrap"` al enum de
  `setType`.
- **Rate limiting (usuarios normales)**: contador por IP y ventana de 1
  hora en un namespace de KV (`env.RATE_LIMIT_KV`, binding a configurar en
  `wrangler.toml`), 10 peticiones/hora por defecto para el endpoint de
  análisis, 10/hora para `/admin/login`. No es perfectamente atómico bajo
  concurrencia muy alta (aceptado deliberadamente, ver §18), y si el
  namespace de KV todavía no existe, el Worker **falla abierto** (no
  bloquea peticiones) en vez de romperse.
- **Modo administrador**: ruta `POST /admin/login` — recibe `{ password }`,
  la compara en tiempo constante contra `env.ADMIN_SECRET` (secreto de
  Cloudflare, `wrangler secret put ADMIN_SECRET`, distinto de
  `APP_SHARED_TOKEN`). Si coincide, emite una sesión firmada con HMAC-SHA256
  usando el propio `ADMIN_SECRET` como clave — sin guardar nada en el
  servidor (stateless). El token resultante (`payload.firma`, ambos en
  base64url) caduca a las 12h (`ADMIN_SESSION_TTL_MS`). El cliente lo envía
  como cabecera `X-Admin-Session` en el endpoint de análisis; si es válido
  (`verifyAdminSessionToken`), esa petición concreta salta el rate limiting
  — pero se sigue registrando igual (ver siguiente punto). Rotar o borrar
  `ADMIN_SECRET` invalida al instante TODAS las sesiones ya emitidas, sin
  tocar la PWA — así es como se revoca el acceso de administrador.
- **Logging**: cada petición de análisis (admin o no) se registra vía
  `console.log` (visible con `wrangler tail`) con: rol (`admin`/`user`),
  modo de importación, éxito/error y, si Gemini lo informa en
  `usageMetadata`, el consumo aproximado de tokens. Nunca se registran
  contraseñas, tokens de sesión ni `APP_SHARED_TOKEN`.
- **Salida forzada a JSON estructurado** vía `responseSchema` /
  `responseMimeType: application/json` de Gemini — el propio Worker define
  el schema completo (`EXERCISE_SCHEMA`, `SCHEMA`) que espera de vuelta.
- **Prompt** (`BASE_PROMPT` + `MODE_INSTRUCTIONS[mode]`): reglas explícitas
  y detalladas para rango vs. secuencia de reps, fallo/rest-pause/
  descendente, superseries, peso por mano/lado, notas por ejercicio vs.
  comentario general de rutina (`routineDescription`), confidence por
  ejercicio, y "unrecognized" para líneas no interpretables.
- **CORS**: `Access-Control-Allow-Origin: '*'` (abierto a cualquier
  origen).
- **Manejo de errores**: siempre responde JSON con `{ error, ... }` y
  código HTTP apropiado (400/401/405/413/502) en vez de dejar que la
  petición cuelgue o falle sin cuerpo.
- **Configuración de despliegue** (`wrangler.toml`): `name =
  "fitness-tracker-import"`, `main = "index.js"`, `compatibility_date =
  "2026-01-01"`, `[vars] GEMINI_MODEL = "gemini-flash-latest"`.
- **URL desplegada actual** (según el propio cliente,
  `js/core/ai-import.js`):
  `https://fitness-tracker-import.pegasush2.workers.dev`.
- **Cómo desplegar cambios de este Worker**: ver §21.

---

## 12. Sistema de progresión y estadísticas

Todo en [js/core/progression.js](js/core/progression.js) y
[js/core/stats.js](js/core/stats.js), **sin ninguna dependencia de IA** —
es lógica determinista local sobre el historial en IndexedDB.

- `effectiveSetVolume` / `sessionVolume` — cálculo de volumen efectivo por
  serie/sesión.
- `describeRepsTarget` — genera el texto descriptivo del objetivo de reps,
  ya consciente de secuencias (no solo rangos uniformes).
- `checkRangeCompletion` — comprobación de cumplimiento de rango, también
  consciente de secuencias per-serie vía `set.setNumber`.
- `compareSetPair` / `compareSessions` / `buildInsights` /
  `insightsForType` — motor de comparación e insights de progresión entre
  sesiones (p. ej. "subiste peso", "mantuviste reps", etc. — el texto
  exacto generado no se ha vuelto a verificar literalmente en esta pasada,
  pero la lógica de comparación sí está confirmada).
- `estimate1RM` (fórmula de Epley, explícitamente etiquetada como
  orientativa).
- `bestRecordsFromHistory` — mejores marcas históricas.
- `periodToCutoffISO` / `filterHistoryByPeriod` / `filterByPeriodGeneric` —
  utilidades de filtrado por periodo de tiempo, reutilizadas en varias
  vistas de progreso.
- `trendSeries` / `trendDirection` — series y dirección de tendencia.
- `bodyWeightStats`, `measurementValue`, `estimateBodyFatJP7` (Jackson &
  Pollock 7 pliegues), `changeSinceFirst`, `neutralDirection`.

---

## 13. Sistema de navegación y pantallas

Enrutado hash-based manual, definido íntegramente en
[js/app.js](js/app.js) (`parseHash`, `matchRoute`, `renderShell`,
`renderBottomNav`, `renderRoute`).

**Tabs principales** (`ALL_TABS`): Home, Entreno, Progreso (oculto si el
usuario no tiene ninguna sección de progreso activada), Ajustes.

**Subtabs de Entreno** (`ENTRENO_SUBTABS`): Entrenamientos / Ejercicios.

**Subtabs de Progreso** (`PROGRESO_SUBTABS`, filtradas según ajustes
activos): Resumen / Peso / Medidas / Plicómetro.

**Tabla de rutas** (resumen, ver `matchRoute` para el detalle exacto):

- `/home`
- `/entreno` (+ `/ejercicios`, `/rutinas`, `/rutina-nueva` [focus],
  `/nuevo/:date?`, `/importar-foto`, `/sesion/:id` [focus],
  `/plantilla/:id`, `/ejercicio/:id`)
- `/progreso` (+ `/peso`, `/medidas/:id?`, `/plicometro`, `/ia`)
- `/ajustes` (+ `/datos`)
- Alias legacy: `/datos` → redirige a la copia de seguridad de ajustes.

**18 vistas** en `js/views/`, una por pantalla/subpantalla: `home.js`,
`exercise-library.js`, `exercise-detail.js`, `workout-new.js`,
`workout-import.js`, `workout-session.js`, `workout-history.js`,
`workout-calendar.js`, `routine-wizard.js`, `templates.js`,
`progress-hub.js`, `bodyweight.js`, `measurements.js`, `skinfold.js`,
`ai-analysis.js`, `settings-backup.js`, `settings-hub.js`, `onboarding.js`.

`renderRoute()` envuelve el render de cada vista en un `try/catch` que
muestra un mensaje de error genérico en español si algo falla, en vez de
dejar la app en blanco.

**Boot de la app** (`DOMContentLoaded` en `app.js`): carga la caché de
ajustes; si detecta datos de usuario ya existentes, marca el onboarding
como completado silenciosamente; si no, ejecuta `runOnboarding()`.

---

## 14. Sistema de diseño actual

Design tokens en [css/base.css](css/base.css):

- **Paleta clara**: `--bg:#F2F2F5`, `--surface:#FFFFFF`,
  `--accent:#FF3B30`.
- **Paleta oscura ("oficial PEGASUS")**: `--bg:#0B0B0B`,
  `--surface:#141414`, `--surface-2:#1F1F1F`, `--border:#1F1F1F`,
  `--text-secondary:#A1A1AA`, `--accent:#FF3B30` — activada vía
  `prefers-color-scheme: dark`, sin selector manual de tema en la app.
- **Radios**: `--radius-lg: 16px` (ajustado desde 22px durante el
  desarrollo).
- **Espaciado**: escala 4/8/12/16/24/32px.
- **Tipografía**: clases `.type-hero` / `.type-title` / `.type-headline`
  / `.type-body` / `.type-caption` / `.type-micro`.
- **Componentes base**: variantes de botón, `.card`, `.badge`, animación
  de entrada de vista `fadeSlideUp`.

`css/layout.css`: app shell (`#app`, `main.view`), bottom-nav (tab bar
estilo nativo con indicador `.nav-dot`), `.segmented` (subtabs), listas
agrupadas estilo iOS (`.grouped-list`/`.grouped-row`), sistema de
bottom-sheet modal (`.modal-overlay`/`.modal-sheet`/`.sheet-handle`),
pantalla de onboarding/splash de marca (siempre en negro puro,
independiente del tema claro/oscuro del sistema — igual que el icono de
la app), y el `toast()`.

`css/components.css`: subtabs desplazables, selector de periodo (chips),
bloque "última sesión", filas de serie (`.set-row`, con variante dual-unit
kg/lb), selector de tipo de serie, bloques extra de rest-pause/descendente,
tarjeta de ejercicio, callouts de progresión (bueno/aviso/neutral),
sparkline, hero de estadística, grid de estadísticas secundarias, grid de
plantillas (`.template-grid`), tarjetas de acción de Entreno
(`.action-card`), selector de modo de importación por foto, anillo de
progreso simulado de "Analizando…", calendario mensual, selector de icono
(emoji/ilustración de músculo), badges de icono con identidad de color
(nunca "bueno/malo"), grid de resumen de Inicio, dots semanales,
mini-sparkline/mini-bars, y tiles de "mejoras recientes".

**Regla de diseño explícita en comentarios del propio CSS**: el color de
`.icon-badge` es SIEMPRE identidad/categoría, nunca "bueno/malo" (eso es
exclusivo de los badges de estado tipo `.progress-callout`).

---

## 15. Cambios realizados recientemente

Según `git log --oneline` (commits más recientes primero):

> **Cambio más reciente (sin commitear todavía en el momento de escribir
> esto)**: **Rediseño de la interpretación de la importación por IA**
> (`docs/ai-import-v2-design.md`) — soporte para programas con semanas
> (resueltos a una única rutina por ejercicio, no una plantilla por
> semana), AMRAP como tipo de serie de pleno derecho, RIR progresivo como
> instrucción de texto (nunca repartido en números inventados), descanso
> convertido de forma determinista a segundos en el código (nunca por la
> IA), y un campo `rawText` (schema v11) para ver el texto original de
> cualquier ejercicio marcado como "revisar". Basado en la lectura completa
> de 8 documentos reales de programas de 4-8 semanas.

> **Cambio anterior**: **Modo administrador para el Worker de IA** — rate limiting por
> IP (KV, fail-open si el namespace no existe), ruta `/admin/login` con
> sesión HMAC de 12h firmada con `ADMIN_SECRET` (revocable rotando ese
> secreto, sin tocar la PWA), logging de cada petición
> (rol/modo/éxito/consumo aproximado, nunca secretos), y una pantalla
> "Ajustes → Modo desarrollador" en la PWA para iniciar/cerrar esa sesión.
> La contraseña de administrador la elige y conserva únicamente el propio
> usuario; no vive en ningún archivo de este repo. Ver §11/§18/§21.

1. `4844683` — **Improve routine creation/import UX and AI reps parsing**
   (commit más reciente): rediseño de Entreno (secciones Acciones/Mis
   rutinas, ambas colapsables, Acciones primero), asistente manual de 3
   pasos, rediseño del flujo de importación por foto, corrección crítica
   de la interpretación rango-vs-secuencia de repeticiones (basada en
   prefijo "Nx" explícito), nueva paleta oficial, fixture de regresión de
   4 días.
2. `8a83cb8` — Trigger GitHub Pages rebuild (commit vacío, workaround para
   destrabar un pipeline de Pages que no reconstruía tras un push normal).
3. `cc031fd` — Rebrand to Pegasus Tracker, redesign Entreno, and add
   hybrid AI photo import.
4. `0f5b3aa` — Add local dev server launch config (`.claude/launch.json`).
5. `bc3657a` — Fix: rotación de pantalla + rediseño de "Tus rutinas" más
   compacto.
6. `9d2264a` — Feature: peso de barra libre (barra + discos/lado).
7. `63e2156` — Fix: importar-foto crea una rutina reutilizable, no un
   entreno de hoy.
8. `36f4164` — Añade rangos de reps, técnicas especiales de serie e
   importación de entreno por foto.
9. `8dde060` — Rediseña Inicio y añade iconos ilustrados de músculo a las
   rutinas.
10. `e3edaac` — Importación aditiva de progreso + oculta "Empezar" en
    rutinas vacías.
11. `ea13bd8` — Corrige precaché del Service Worker con bytes antiguos por
    caché HTTP.
12. `cf86035` — Rediseño rojo/neutro, onboarding, Ajustes, unidades kg+lb,
    mancuernas y calendario.
13. `0ce6412` — Rediseño visual premium + plantillas de entrenamiento +
    arreglo del notch.
14. `977946d` — Implementa la primera versión completa de Fitness Tracker.
15. `b64696e` — Initial commit.

Estado del repositorio en el momento de escribir esto: rama `main`, al día
con `origin/main`, working tree limpio (sin cambios pendientes de commit).

**Nota sobre el Worker de Cloudflare**: `worker/index.js` se despliega por
separado con `wrangler deploy` y NO tiene su propio historial de commits
relevante para el "despliegue" en sí — el código del Worker sí vive en este
mismo repo/commits, pero desplegarlo requiere una acción manual adicional
(ver §21). Según la conversación de desarrollo previa, el Worker ya fue
redesplegado exitosamente con el contenido actual de `worker/index.js`.

---

## 16. Problemas y bugs conocidos

- **Superseries de importación por foto no se agrupan realmente**: la UI
  informa al usuario de que se detectaron superseries (A1/A2…), pero cada
  ejercicio se guarda como independiente. Comentario textual en
  `workout-import.js`: *"Se detectaron superseries (A1/A2…) — de momento se
  crean como ejercicios independientes; la agrupación real llegará más
  adelante."*
- **Asistente manual de rutinas (`routine-wizard.js`) — Paso 3 con texto
  fijo**: la pantalla de revisión muestra literalmente "3 series" para
  cada ejercicio, sin importar el número real de series configurado, porque
  este wizard no tiene un paso de edición de target por ejercicio (a
  diferencia del sheet dedicado que sí existe en `templates.js`).
- **Backup/restauración no incluye la tabla `bars`**: la constante `TABLES`
  usada por `exportAllData`/`importAllData`/`clearAllData` en
  `js/db/repository.js` no incluye `bars` (tabla de configuraciones de
  barra libre, añadida en schema v8). Esto es una lectura directa del
  código (`TABLES` no la lista); no se ha verificado en tiempo de
  ejecución si el efecto real coincide exactamente con lo que el nombre de
  la constante sugiere, pero la ausencia en la lista es clara.
- **Token compartido del Worker de IA no es un secreto real**: tanto la
  URL del Worker como `APP_SHARED_TOKEN` están hardcodeados en texto plano
  en `js/core/ai-import.js`, servido públicamente. El propio código lo
  reconoce como una limitación asumida ("solo frena rastreadores/bots"),
  no como un fallo a corregir silenciosamente — pero cualquiera con acceso
  al código fuente público puede leer el token y llamar al Worker
  directamente, sujeto solo a los límites gratuitos de Gemini/Cloudflare.
- **CORS abierto (`*`) en el Worker**: cualquier origen puede llamar al
  endpoint si conoce la URL y el token (que es público, ver punto
  anterior).
- **Rate limiting por KV no es perfectamente atómico**: bajo concurrencia
  muy alta (no esperable a esta escala personal) dos peticiones casi
  simultáneas podrían leer el mismo contador antes de que se actualice y
  colarse ambas. Aceptado deliberadamente por simplicidad (ver §18); si el
  namespace `RATE_LIMIT_KV` no se ha creado/configurado en `wrangler.toml`,
  el Worker falla ABIERTO (sin límite) en vez de romper la función
  principal.
- **Rebuilds de GitHub Pages no siempre se disparan automáticamente tras
  un push normal**: ocurrió una vez durante el desarrollo (requirió un
  commit vacío para destrabar el pipeline); no se identificó una causa
  raíz definitiva, solo se aplicó un workaround. Puede volver a ocurrir.
- **Vista "Análisis con IA" del progreso sin conectar** — ver §9/§19; no
  es un "bug" sino una funcionalidad de UI completa sin lógica real detrás
  (`toast()` de "no conectado todavía").

No se han identificado (ni se puede afirmar ni descartar, sin pruebas
automatizadas ni una auditoría exhaustiva línea a línea de las 18 vistas)
otros bugs funcionales más allá de los listados arriba. Cualquier otra
suposición de bug NO verificada explícitamente contra el código no se
incluye aquí para no inventar problemas inexistentes.

---

## 17. Mejoras pendientes de PEGASUS V1

(Inferido de las limitaciones conocidas del propio código — NO es un
roadmap oficial, ya que no existe un documento de producto separado en el
repo):

- Conectar de verdad la función "Análisis con IA" del progreso (§9/§19) a
  un modelo/backend real.
- Implementar la agrupación real de superseries detectadas en la
  importación por foto (actualmente se guardan como ejercicios
  independientes).
- Añadir un paso de edición de target por ejercicio en el asistente manual
  de rutinas (`routine-wizard.js`), o al menos corregir el texto fijo "3
  series" del Paso 3 para reflejar el valor real configurado.
- Incluir la tabla `bars` en el backup/restauración de datos
  (`TABLES` en `repository.js`).
- ~~Revisar el modelo de autenticación del Worker de IA~~ — atendido
  parcialmente: ya existe rate limiting por IP y un modo administrador con
  sesión revocable (ver §11/§18/§21). El token compartido (`APP_SHARED_TOKEN`)
  para usuarios normales sigue siendo efectivamente público (ver §16); eso
  no ha cambiado, solo se ha añadido un límite de peticiones y una vía para
  saltárselo de forma controlada como administrador.
- Si el uso real llega a justificarlo, sustituir el contador de KV
  (best-effort, no atómico) por un Durable Object para un rate limiting
  exacto bajo concurrencia alta.

---

## 18. Decisiones importantes que NO deben romperse

- **Nunca usar `window.confirm`/`alert` nativos** — usar siempre
  `openSheet`/`openConfirmSheet` de `js/core/ui.js` (razón: fiabilidad en
  PWA instalada en iOS standalone).
- **Conversión kg↔lb siempre desde el valor canónico en kg**, nunca desde
  un valor ya redondeado y mostrado — para evitar deriva de redondeo
  (`js/core/units.js`).
- **Migraciones de schema Dexie siempre aditivas y no destructivas** — todo
  campo nuevo debe tener un valor por defecto seguro vía `.upgrade()`;
  nunca se debe perder o transformar con pérdida los datos existentes del
  usuario al subir de versión.
- **Rango de reps por defecto usa el límite INFERIOR**, no el superior, al
  prefilling una nueva sesión desde una plantilla — esto fue una corrección
  deliberada durante el desarrollo, no un descuido.
- **Rango vs. secuencia/progresión de repeticiones se decide por la
  presencia/ausencia de un prefijo "Nx" explícito**, nunca por el número de
  valores o el tipo de separador — regla crítica implementada tanto en el
  prompt del Worker (`worker/index.js`) como en el validador del cliente
  (`js/core/ai-import.js`). Romper esto reintroduciría el bug original que
  motivó la corrección.
- **La IA nunca decide datos finales por sí sola** — en importación por
  foto, siempre propone (nombres de ejercicio, división de rutinas,
  interpretación de reps) y el usuario revisa/edita/confirma antes de que
  nada se persista en IndexedDB.
- **La API key de Gemini vive SOLO como secreto de Cloudflare** (`wrangler
  secret put GEMINI_API_KEY`), nunca en el repo ni en el cliente.
- **`CACHE_VERSION` en `sw.js` debe subirse manualmente en cada
  despliegue** que cambie cualquier archivo precacheado, o los usuarios con
  la PWA ya instalada seguirán viendo la versión antigua indefinidamente.
- **`ADMIN_SECRET` nunca debe aparecer en el repo, en la PWA, en logs ni en
  respuestas de la API** — vive ÚNICAMENTE como secreto de Cloudflare. Se
  usa con doble función a propósito (verificar la contraseña de login Y
  firmar las sesiones HMAC): esto es lo que permite que rotar/borrar ese
  único secreto revoque todas las sesiones de administrador ya emitidas al
  instante, sin desplegar ni tocar la PWA. No lo dupliques en dos secretos
  distintos sin revisar antes esta dependencia.
- **La PWA nunca debe persistir la contraseña de administrador**, ni en
  `localStorage` ni en IndexedDB — solo la sesión temporal (token +
  `expiresAt`) que el Worker emite tras el login, guardada como preferencia
  `adminSession` en `js/core/settings.js` (tabla `settings`, no
  `localStorage`).
- **Los usuarios normales deben seguir sujetos al rate limiting** aunque el
  modo administrador exista — el bypass solo se activa con una cabecera
  `X-Admin-Session` verificada correctamente contra `ADMIN_SECRET`; su
  ausencia o invalidez siempre cae al camino normal (token compartido +
  límite por IP).
- **Toda petición de análisis de IA se registra (logging), incluida la del
  administrador** — nunca se debe quitar el logging "porque ya es admin y
  no hace falta".
- **El color de `.icon-badge` es identidad/categoría, nunca "bueno/malo"**
  — esa semántica de estado es exclusiva de `.progress-callout` y
  similares.
- **Sin cuentas, sin backend de aplicación propio** — toda la persistencia
  de datos de usuario es local (IndexedDB); el único servicio externo es el
  proxy de IA, y solo para la función de importación por foto.

---

## 19. Qué funcionalidades todavía NO están implementadas

(Distinto de "bugs" — esto es ausencia total de funcionalidad, confirmado
por lectura directa del código, no inferido):

- **Análisis de progreso con IA**: la UI existe por completo
  (`ai-analysis.js`: selector de periodo, checkboxes de categorías,
  pantalla de resumen), pero no hay ninguna llamada real a un backend/IA —
  confirmar solo dispara un `toast()` indicando que aún no está conectado.
- **Agrupación real de superseries** en la importación por foto (se
  detectan visualmente pero se guardan como ejercicios independientes).
- **Edición de target por ejercicio dentro del asistente manual de
  rutinas** (`routine-wizard.js`) — el Paso 3 no permite editar/ver el
  target real configurado por ejercicio.
- **Sincronización entre dispositivos / cuentas de usuario** — no existe
  ningún mecanismo de este tipo; los datos son puramente locales al
  navegador/dispositivo.
- **Selector manual de tema claro/oscuro** — el tema sigue únicamente
  `prefers-color-scheme` del sistema; no hay un toggle en la app.
- **Tests automatizados** — no existe carpeta `tests/` ni ningún framework
  de test configurado en el repo. Toda la verificación de esta sesión de
  desarrollo se hizo manualmente a través de la UI real en navegador.

---

## 20. Cómo ejecutar y probar PEGASUS localmente

No hay build step. Basta con servir los archivos estáticos:

- Existe una configuración de lanzamiento en
  [.claude/launch.json](.claude/launch.json):
  ```json
  {
    "version": "0.0.1",
    "configurations": [
      {
        "name": "fitness-tracker",
        "runtimeExecutable": "python",
        "runtimeArgs": ["-m", "http.server", "8420"],
        "port": 8420
      }
    ]
  }
  ```
  Es decir: `python -m http.server 8420` desde la raíz del proyecto, y
  abrir `http://localhost:8420`.
- **Importante para pruebas tras editar código**: el Service Worker
  (`sw.js`) cachea agresivamente. Para ver cambios reales durante el
  desarrollo, hay que o bien desregistrar el Service Worker y borrar las
  cachés del navegador para ese origen, o bien subir manualmente
  `CACHE_VERSION` en `sw.js` y forzar una recarga/nueva pestaña. Navegar a
  un hash idéntico al actual (`location.hash`) NO dispara el evento
  `hashchange` y por tanto no re-renderiza la vista — hace falta cambiar de
  hash o forzar el render manualmente.
- **Importación por foto en local**: si `WORKER_URL` en
  `js/core/ai-import.js` estuviera vacío, la app caería automáticamente en
  respuestas simuladas (`mockAnalyzeProgramPhoto`) para poder probar el
  flujo sin depender del Worker real. Actualmente `WORKER_URL` SÍ apunta al
  Worker de producción desplegado, así que las pruebas locales de
  importación por foto llaman al servicio real (sujeto a sus límites de
  cuota gratuita).
- No hay un framework de test automatizado — toda verificación es manual,
  vía navegador.

---

## 21. Cómo desplegarla actualmente

**Sitio principal (GitHub Pages)**:

- El repo se sirve directamente desde la rama `main`, raíz, sin paso de
  build. Repo: `https://github.com/PegasusH2/fitness-tracker` (nombre de
  repo aún "fitness-tracker", aunque el producto se llama "Pegasus
  Tracker"). URL publicada:
  `https://pegasush2.github.io/fitness-tracker/`.
- Desplegar = hacer `git push origin main`. GitHub Pages reconstruye
  automáticamente en la mayoría de los casos; se ha observado al menos una
  vez que un push normal no disparó una reconstrucción automática, y hubo
  que forzarla con un commit vacío (`git commit --allow-empty` + push).
  Si esto vuelve a ocurrir, ese es el workaround ya probado.
- **No olvidar subir `CACHE_VERSION` en `sw.js`** en cualquier despliegue
  que cambie archivos precacheados, para invalidar la caché de usuarios con
  la PWA ya instalada.

**Worker de IA (Cloudflare, despliegue independiente)**:

- Vive en `worker/`, se despliega aparte del sitio de GitHub Pages, y solo
  hace falta redesplegar cuando cambia `worker/index.js`.
- Requiere Node.js + Wrangler CLI instalados **en el propio ordenador del
  usuario** — en el entorno de ejecución de herramientas de esta sesión de
  Claude Code, `node`/`npm`/`wrangler` NO están disponibles, así que
  cualquier despliegue del Worker debe ejecutarlo el usuario manualmente en
  su propia terminal.
- Pasos (desde `worker/`, ver `worker/README.md` para el detalle completo):
  ```bash
  npm install -g wrangler
  wrangler login
  wrangler secret put GEMINI_API_KEY
  wrangler secret put APP_SHARED_TOKEN
  wrangler deploy
  ```
  Los secretos (`GEMINI_API_KEY`, `APP_SHARED_TOKEN`) solo hace falta
  configurarlos una vez; despliegues posteriores solo requieren `wrangler
  deploy`.
- **Modo administrador — pasos adicionales de configuración** (una sola
  vez; ver `worker/README.md` para el detalle completo):
  ```bash
  wrangler kv namespace create RATE_LIMIT_KV
  # copiar el "id" devuelto en worker/wrangler.toml, [[kv_namespaces]]
  wrangler secret put ADMIN_SECRET
  # elegir aquí, en el momento de escribirla, la contraseña de administrador
  wrangler deploy
  ```
  Si no se crea el namespace `RATE_LIMIT_KV`, el Worker sigue funcionando
  con normalidad pero sin rate limiting (falla abierto). Para revocar el
  acceso de administrador sin tocar la PWA: `wrangler secret put
  ADMIN_SECRET` (nueva contraseña) o `wrangler secret delete ADMIN_SECRET`
  (lo desactiva).
- Tras desplegar, la URL resultante y el `APP_SHARED_TOKEN` elegido deben
  coincidir con las constantes `WORKER_URL`/`APP_SHARED_TOKEN` hardcodeadas
  al principio de `js/core/ai-import.js` — si se cambia el token o se
  redespliega con una URL distinta, hay que actualizar ese archivo cliente
  y volver a desplegar el sitio de GitHub Pages.
- Coste: dentro de niveles gratuitos tanto de Gemini (Flash, ~1500
  peticiones/día) como de Cloudflare Workers (100.000 peticiones/día) para
  uso personal.

---

*Fin del documento. Generado únicamente a partir de lectura directa del
código del repositorio — sin modificar ningún archivo de código.*
