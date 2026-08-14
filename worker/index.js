// Cloudflare Worker — proxy entre la PWA y la API de Gemini para "Importar
// entrenamiento desde foto". La API key de Gemini vive SOLO como secreto de
// este Worker (wrangler secret put GEMINI_API_KEY) — nunca en el repo ni en
// la PWA. Este archivo no se despliega a GitHub Pages; se despliega aparte
// con `wrangler deploy` desde esta misma carpeta (ver README.md).

const BASE_PROMPT = `Eres un asistente que interpreta fotos de rutinas de entrenamiento de gimnasio (papel, pizarra, captura de pantalla) y las convierte en JSON estructurado.

Reglas estrictas:
- NO inventes datos que no aparezcan en la imagen. Si algo es ambiguo o ilegible, omite ese campo (deja null) en vez de adivinar.
- "4x8-10" significa 4 series, repsMin=8, repsMax=10. "4x10" significa 4 series, repsMin=10, repsMax=10 (cantidad exacta).
- REPETICIONES — diferencia SIEMPRE entre un RANGO y una SECUENCIA/PROGRESIÓN por serie. Un guion o una barra entre números NO siempre significa rango: usa el contexto (número de series, presencia de "x", pesos distintos por serie) para decidir:
  - RANGO: patrón "<series> x <a>-<b>" (ej. "4x6-10", "3x8-12") -> repsMin=a, repsMax=b; deja repsSequence null. Es rango cuando además hay MENOS valores sueltos que series (ej. "3 series" pero solo "8-10", que son 2 valores: no alcanza para una serie por serie, es rango 8-10).
  - SECUENCIA/PROGRESIÓN: una lista de valores (separados por "/", "-", saltos de línea, o cada uno en su propia serie) CUYA CANTIDAD COINCIDE con el número de series del ejercicio (ej. "4 series" + "6-8-10-12" = 4 valores) -> son objetivos DISTINTOS por serie, en orden -> ponlos en repsSequence=[6,8,10,12] (mismo orden que aparecen), deja repsMin/repsMax null. Vale tanto para progresión ascendente (6/8/10/12) como descendente (12/10/8/6) — respeta el orden tal cual aparece, no lo reordenes.
  - Un peso DISTINTO en cada serie (ej. "20kg x12 / 22kg x10 / 24kg x8") es una señal MUY FUERTE de secuencia, no de rango: pon los pesos en weightSequence=[20,22,24] y las repeticiones correspondientes en repsSequence=[12,10,8], en el mismo orden.
  - Nunca conviertas una secuencia real ("6-8-10-12") en un rango simplificado ("4x6-10"), ni un rango real en una secuencia inventada. Si el ejercicio no trae número de repeticiones legible, deja repsMin/repsMax/repsSequence null.
- Fallo (F, Fallo, FAIL, Failure, al fallo, x fallo) -> setType="fallo". No inventes un número de repeticiones si no aparece.
- Rest-pause (RP, Rest Pause, Rest-pause) -> setType="restpause".
- Descendente/drop set (Drop, Drop set, Descendente, DS) -> setType="descendente".
- Si la técnica especial (fallo/rest-pause/descendente) se indica solo para la ÚLTIMA serie del ejercicio (ej. "3x10-12, última serie DROP SET"), pon lastSetOnly=true — las demás series de ese ejercicio son normales. Si aplica a TODAS las series (ej. "3xF"), deja lastSetOnly=false/null.
- Si el rest-pause trae números explícitos ("10+3+2"), ponlos en extraReps=[3,2] (sin contar el bloque principal, que va en repsMin/repsMax). Si el descendente trae pesos/reps explícitos por escalón ("80x10, 60x8, 40x8"), ponlos en steps=[{weight:60,reps:8},{weight:40,reps:8}] (sin incluir el primer escalón, que es el peso/reps principal del ejercicio). Si no hay números explícitos, deja extraReps/steps como null — no inventes valores.
- RIR (RIR 2, @2 RIR, 2 RIR) -> campo rir.
- Superseries: "A1 Ejercicio / A2 Ejercicio", "Ejercicio + Ejercicio" o "Superset: ..." -> asigna la misma letra en supersetGroup y un supersetOrder correlativo (1, 2, 3...) a cada ejercicio del bloque. Si un ejercicio no forma parte de ninguna superserie, deja supersetGroup null.
- Si se indica un peso (ej. "80kg", "20kg/lado", "20kg mancuerna"), ponlo en weightHintKg tal cual aparece escrito (el peso POR mancuerna/lado si así se indica, nunca lo dupliques).
- confidence="low" en cualquier ejercicio cuya lectura te genere dudas razonables; "high" en el resto.
- Cualquier línea de texto que no puedas interpretar como ejercicio, ponla en "unrecognized" DE LA RUTINA a la que pertenezca, no la fuerces dentro de "exercises".
- Responde SOLO con el JSON pedido, en el mismo idioma en que esté escrita la rutina (normalmente español).`;

// La imagen puede contener una única rutina o un programa completo con varias
// (Día 1/2/3, A/B/C, Push/Pull/Legs, Upper/Lower, días de la semana...). El
// modo lo decide el usuario (o pide detección automática) — nunca la IA sola.
const MODE_INSTRUCTIONS = {
  single: `
Modo: UNA ÚNICA RUTINA.
Todo el contenido relevante de la imagen pertenece a UNA SOLA rutina. Aunque veas palabras como "Lunes", "Día 1", "Push" o similares, NO crees rutinas independientes — el usuario ha indicado explícitamente que quiere una única rutina. Devuelve exactamente 1 elemento en "routines" con todos los ejercicios de la imagen. Ignora "structureConfidence" (déjalo null).`,
  multi: `
Modo: PROGRAMA COMPLETO (varias rutinas).
La imagen probablemente contiene VARIAS rutinas o sesiones distintas. Busca activamente separadores: días de la semana, "Día 1/2/3", letras A/B/C, Push/Pull/Legs, Upper/Lower, Torso/Pierna, Empuje/Tirón, Full Body, nombres de grupos musculares como encabezado, columnas, o bloques visuales separados. Divide el contenido en tantas rutinas independientes como puedas identificar CON CLARIDAD — un elemento de "routines" por cada una, con su propio nombre (usa el encabezado detectado, ej. "Lunes · Push"). Si de verdad solo hay una rutina y no encuentras ninguna separación real, devuelve 1 único elemento — nunca inventes una división que no existe. Ignora "structureConfidence" (déjalo null).`,
  auto: `
Modo: DETECCIÓN AUTOMÁTICA.
Analiza si la imagen contiene una única rutina o varias (busca días de la semana, "Día 1/2/3", A/B/C, Push/Pull/Legs, Upper/Lower, Torso/Pierna, Full Body, encabezados, columnas o separadores visuales). Indica tu confianza en "structureConfidence":
- "high": la separación en varias rutinas es evidente y clara -> divide en varios elementos de "routines", uno por rutina, con su nombre detectado.
- "low": hay indicios de que podría haber varias rutinas pero no está claro del todo -> intenta igualmente tu MEJOR división tentativa en varios elementos de "routines" (uno por rutina que crees ver), para que la app se lo pueda mostrar al usuario como propuesta, pero deja "structureConfidence"="low" para dejar claro que no estás seguro.
- "none": no hay ninguna estructura de varias rutinas detectable (o es claramente una sola rutina) -> devuelve 1 único elemento en "routines" y "structureConfidence"="none".
Nunca inventes una separación que no tenga ningún indicio real en la imagen.`,
};

function buildPrompt(mode) {
  return BASE_PROMPT + (MODE_INSTRUCTIONS[mode] || MODE_INSTRUCTIONS.auto);
}

const EXERCISE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    recognizedName: { type: 'STRING' },
    sets: { type: 'INTEGER' },
    repsMin: { type: 'INTEGER', nullable: true },
    repsMax: { type: 'INTEGER', nullable: true },
    repsSequence: { type: 'ARRAY', items: { type: 'INTEGER' }, nullable: true },
    weightSequence: { type: 'ARRAY', items: { type: 'NUMBER' }, nullable: true },
    rir: { type: 'INTEGER', nullable: true },
    setType: { type: 'STRING', enum: ['normal', 'fallo', 'restpause', 'descendente'] },
    lastSetOnly: { type: 'BOOLEAN', nullable: true },
    extraReps: { type: 'ARRAY', items: { type: 'INTEGER' }, nullable: true },
    steps: {
      type: 'ARRAY',
      nullable: true,
      items: {
        type: 'OBJECT',
        properties: {
          weight: { type: 'NUMBER', nullable: true },
          reps: { type: 'INTEGER', nullable: true },
        },
      },
    },
    supersetGroup: { type: 'STRING', nullable: true },
    supersetOrder: { type: 'INTEGER', nullable: true },
    weightHintKg: { type: 'NUMBER', nullable: true },
    notes: { type: 'STRING', nullable: true },
    confidence: { type: 'STRING', enum: ['high', 'low'] },
  },
  required: ['recognizedName', 'sets', 'setType', 'confidence'],
};

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    structureConfidence: { type: 'STRING', enum: ['high', 'low', 'none'], nullable: true },
    routines: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          workoutName: { type: 'STRING', nullable: true },
          exercises: { type: 'ARRAY', items: EXERCISE_SCHEMA },
          unrecognized: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['exercises'],
      },
    },
  },
  required: ['routines'],
};

const MAX_BASE64_LENGTH = 8_000_000; // ~6MB de imagen real tras base64

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Token',
  };
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== 'POST') {
      return jsonError('Método no permitido', 405);
    }

    // Cabecera compartida simple — NO es un secreto real (vive en el JS de la
    // PWA), solo frena rastreadores/bots que encuentren esta URL y quemen la
    // cuota gratuita de Gemini sin querer.
    if (env.APP_SHARED_TOKEN && request.headers.get('X-App-Token') !== env.APP_SHARED_TOKEN) {
      return jsonError('No autorizado', 401);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonError('Cuerpo de la petición no válido', 400);
    }

    const { image, mimeType, mode } = body || {};
    if (!image || typeof image !== 'string') return jsonError('Falta la imagen', 400);
    if (image.length > MAX_BASE64_LENGTH) return jsonError('La imagen es demasiado grande', 413);

    const model = env.GEMINI_MODEL || 'gemini-flash-latest';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

    const payload = {
      contents: [{
        role: 'user',
        parts: [
          { text: buildPrompt(mode) },
          { inlineData: { mimeType: mimeType || 'image/jpeg', data: image } },
        ],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: SCHEMA,
      },
    };

    let geminiRes;
    try {
      geminiRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      return jsonError('No se pudo contactar con el servicio de IA', 502);
    }

    if (!geminiRes.ok) {
      const errText = await geminiRes.text().catch(() => '');
      console.error('Gemini error', geminiRes.status, errText);
      return jsonError('El servicio de IA no pudo procesar la imagen', 502);
    }

    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return jsonError('Respuesta vacía de la IA', 502);

    return new Response(text, {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  },
};
