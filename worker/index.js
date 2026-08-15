// Cloudflare Worker — proxy entre la PWA y la API de Gemini para "Importar
// entrenamiento desde foto". La API key de Gemini vive SOLO como secreto de
// este Worker (wrangler secret put GEMINI_API_KEY) — nunca en el repo ni en
// la PWA. Este archivo no se despliega a GitHub Pages; se despliega aparte
// con `wrangler deploy` desde esta misma carpeta (ver README.md).
//
// Modo administrador (pruebas sin rate limiting) — ver worker/README.md:
// - ADMIN_SECRET vive SOLO como secreto de este Worker (wrangler secret put
//   ADMIN_SECRET). Nunca en el repo, nunca en la PWA, nunca en logs.
// - Se usa dos veces: para validar la contraseña en /admin/login, y como
//   clave de firma HMAC de la sesión emitida. Esto hace que rotar/borrar
//   ADMIN_SECRET revoque TODAS las sesiones ya emitidas al instante, sin
//   tocar la PWA (ver verifyAdminSessionToken).
// - La sesión (token temporal, no la contraseña) es lo único que llega al
//   cliente, y caduca sola — nunca se guarda en el Worker (stateless).

const BASE_PROMPT = `Eres un asistente que interpreta fotos de rutinas de entrenamiento de gimnasio (papel, pizarra, captura de pantalla) y las convierte en JSON estructurado.

Reglas estrictas:
- NO inventes datos que no aparezcan en la imagen. Si algo es ambiguo o ilegible, omite ese campo (deja null) en vez de adivinar.
- "4x8-10" y "4x8 a 10" significan EXACTAMENTE lo mismo: 4 series, repsMin=8, repsMax=10 — la palabra "a" entre dos números es sinónimo del guion. "4x10" significa 4 series, repsMin=10, repsMax=10 (cantidad exacta).
- REPETICIONES — diferencia SIEMPRE entre un RANGO y una SECUENCIA/PROGRESIÓN por serie. La señal decisiva es la presencia o ausencia de "<número> x" (series explícitas) delante de los números de reps, NO la cantidad de valores ni el tipo de separador:
  - Si ves "<N> x <a>-<b>" o "<N> x <a> a <b>" (con una "x" explícita entre el nº de series y el rango) -> RANGO: sets=N, repsMin=a, repsMax=b; deja repsSequence null.
  - Si ves "<N> x <a>" (un solo número tras la "x") -> cantidad EXACTA: sets=N, repsMin=repsMax=a.
  - Si ves una lista de 2 o más números SIN ninguna "x" delante (separados por "-", "/", saltos de línea, o cada uno en su propia serie/fila) -> SECUENCIA/PROGRESIÓN, nunca rango, sea cual sea la cantidad de valores: cada número es el objetivo de UNA serie distinta, en el mismo orden en que aparecen (no los reordenes; vale tanto ascendente "6-8-10-12" como descendente "12-10-8-6", e incluye repeticiones iguales como "10-10-8"). El número de series del ejercicio (sets) es la cantidad de valores de la lista. Ponlos en repsSequence=[...] y deja repsMin/repsMax null.
  - Ejemplo crítico: "12 - 10 - 8 - 6" SIN "x" delante -> repsSequence=[12,10,8,6], sets=4. "4x8 a 10" o "4x8-10" CON "x" delante -> repsMin=8, repsMax=10, sets=4. Nunca conviertas lo primero en un rango simplificado, ni lo segundo en una secuencia inventada.
  - Un peso DISTINTO en cada serie (ej. "20kg x12 / 22kg x10 / 24kg x8") es una señal MUY FUERTE de secuencia, no de rango: pon los pesos en weightSequence=[20,22,24] y las repeticiones correspondientes en repsSequence=[12,10,8], en el mismo orden.
  - Si el ejercicio no trae número de repeticiones legible, deja repsMin/repsMax/repsSequence null.
- Fallo (F, Fallo, FAIL, Failure, al fallo, x fallo) -> setType="fallo". No inventes un número de repeticiones si no aparece.
- Rest-pause (RP, Rest Pause, Rest-pause) -> setType="restpause".
- Descendente/drop set (Drop, Drop set, Descendente, DS) -> setType="descendente".
- Patrón "<N>x<reps> + 1 <técnica> <detalle>" (ej. "3x12 + 1 Rest pause 20\""): sets = N+1 (las N series normales más la serie extra de la técnica), repsMin=repsMax=reps (el objetivo de las series normales), setType según la técnica, lastSetOnly=true (la técnica solo aplica a esa última serie extra, las N primeras son normales).
- Si la técnica especial (fallo/rest-pause/descendente) se indica solo para la ÚLTIMA serie del ejercicio (ej. "3x10-12, última serie DROP SET"), pon lastSetOnly=true. Si aplica a TODAS las series (ej. "3xF"), deja lastSetOnly=false/null.
- Si el rest-pause trae números explícitos ("10+3+2"), ponlos en extraReps=[3,2] (sin contar el bloque principal, que va en repsMin/repsMax). Si en cambio trae una DURACIÓN de descanso interno pero SIN desglose numérico de repeticiones (ej. "Rest pause 20\""), NO inventes extraReps — déjalo null y en su lugar anota la duración en "notes" de ese ejercicio (ej. "Rest-pause: 20s de descanso interno"). Si el descendente trae pesos/reps explícitos por escalón ("80x10, 60x8, 40x8"), ponlos en steps=[{weight:60,reps:8},{weight:40,reps:8}] (sin incluir el primer escalón, que es el peso/reps principal del ejercicio). Si no hay números explícitos, deja extraReps/steps como null — no inventes valores.
- RIR (RIR 2, @2 RIR, 2 RIR) -> campo rir.
- Superseries: "A1 Ejercicio / A2 Ejercicio", "Ejercicio + Ejercicio" o "Superset: ..." -> asigna la misma letra en supersetGroup y un supersetOrder correlativo (1, 2, 3...) a cada ejercicio del bloque. Si un ejercicio no forma parte de ninguna superserie, deja supersetGroup null.
- Si se indica un peso (ej. "80kg", "20kg/lado", "20kg mancuerna"), ponlo en weightHintKg tal cual aparece escrito (el peso POR mancuerna/lado si así se indica, nunca lo dupliques).
- Cualquier comentario o nota junto a un ejercicio concreto (columna "Comentarios", texto en cursiva a su lado, etc.) va en "notes" DE ESE ejercicio.
- Un comentario GENERAL que no pertenece a un ejercicio concreto (ej. una nota al pie sobre técnica/respiración que menciona varios ejercicios de varios días, un recordatorio general de la rutina) va en "routineDescription" de la rutina — si ese comentario aplica visualmente a varias rutinas/días a la vez, repítelo en el campo "routineDescription" de cada una de esas rutinas. No lo metas como ejercicio ni lo pierdas en "unrecognized".
- confidence="low" en cualquier ejercicio cuya lectura te genere dudas razonables; "high" en el resto.
- Cualquier línea de texto que no puedas interpretar como ejercicio NI como comentario general, ponla en "unrecognized" DE LA RUTINA a la que pertenezca, no la fuerces dentro de "exercises".
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
          routineDescription: { type: 'STRING', nullable: true },
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

// ---------- Rate limiting (KV, por IP y ventana de tiempo) ----------
// Contador simple con expiración automática (expirationTtl). No es
// perfectamente atómico bajo concurrencia muy alta, pero es más que
// suficiente para frenar abuso a la escala de uso personal de esta app.
// Si el binding RATE_LIMIT_KV todavía no existe (falta crear el namespace,
// ver README), se falla ABIERTO (no bloquea) para no romper la función
// principal por una pieza nueva a medio configurar.
const RATE_LIMIT_WINDOW_SECONDS = 3600; // 1 hora
const RATE_LIMIT_MAX_REQUESTS = 10; // peticiones normales de análisis por IP y hora
const LOGIN_RATE_LIMIT_MAX = 10; // intentos de login de admin por IP y hora

async function checkRateLimit(env, key, max, windowSeconds) {
  if (!env.RATE_LIMIT_KV) return true;
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const fullKey = `${key}:${bucket}`;
  const current = parseInt(await env.RATE_LIMIT_KV.get(fullKey), 10) || 0;
  if (current >= max) return false;
  await env.RATE_LIMIT_KV.put(fullKey, String(current + 1), { expirationTtl: windowSeconds + 60 });
  return true;
}

function getClientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

// ---------- Comparación en tiempo constante (evita timing attacks sobre
// la contraseña de administrador) ----------
function constantTimeEqual(a, b) {
  const ea = new TextEncoder().encode(String(a ?? ''));
  const eb = new TextEncoder().encode(String(b ?? ''));
  const len = Math.max(ea.length, eb.length, 1);
  let diff = ea.length === eb.length ? 0 : 1;
  for (let i = 0; i < len; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

// ---------- Sesión de administrador — token firmado con HMAC, sin estado
// en el Worker (stateless). Revocar = rotar/borrar ADMIN_SECRET. ----------
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas

function bytesToBase64Url(bytes) {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64UrlToBytes(b64) {
  const normalized = b64.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function encodeJsonBase64Url(obj) {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(obj)));
}
function decodeJsonBase64Url(b64) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(b64)));
}

async function hmacSignBase64Url(message, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return bytesToBase64Url(new Uint8Array(sig));
}

async function createAdminSessionToken(secret) {
  const payload = { role: 'admin', iat: Date.now(), exp: Date.now() + ADMIN_SESSION_TTL_MS };
  const payloadB64 = encodeJsonBase64Url(payload);
  const sig = await hmacSignBase64Url(payloadB64, secret);
  return { token: `${payloadB64}.${sig}`, expiresAt: payload.exp };
}

async function verifyAdminSessionToken(token, secret) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return false;
  let expectedSig;
  try {
    expectedSig = await hmacSignBase64Url(payloadB64, secret);
  } catch {
    return false;
  }
  if (!constantTimeEqual(sig, expectedSig)) return false;
  let payload;
  try {
    payload = decodeJsonBase64Url(payloadB64);
  } catch {
    return false;
  }
  return payload?.role === 'admin' && typeof payload.exp === 'number' && payload.exp > Date.now();
}

// ---------- Logging — nunca incluye el secreto, el token de sesión ni
// APP_SHARED_TOKEN, solo metadatos para poder revisar consumo/errores. ----------
function logEvent(fields) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...fields }));
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Token, X-Admin-Session',
  };
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

async function handleAdminLogin(request, env) {
  if (request.method !== 'POST') return jsonError('Método no permitido', 405);
  const ip = getClientIp(request);

  if (!env.ADMIN_SECRET) return jsonError('Modo administrador no configurado', 503);

  const okRate = await checkRateLimit(env, `login:${ip}`, LOGIN_RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SECONDS);
  if (!okRate) {
    logEvent({ role: 'admin-login', success: false, reason: 'rate_limited' });
    return jsonError('Demasiados intentos, inténtalo más tarde', 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Cuerpo de la petición no válido', 400);
  }
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!password || !constantTimeEqual(password, env.ADMIN_SECRET)) {
    logEvent({ role: 'admin-login', success: false, reason: 'invalid_password' });
    return jsonError('No autorizado', 401);
  }

  const session = await createAdminSessionToken(env.ADMIN_SECRET);
  logEvent({ role: 'admin-login', success: true });
  return new Response(JSON.stringify({ token: session.token, expiresAt: session.expiresAt }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

async function handleAnalyze(request, env) {
  if (request.method !== 'POST') return jsonError('Método no permitido', 405);

  const ip = getClientIp(request);

  // Sesión de administrador (opcional) — si es válida, salta el rate
  // limiting de usuarios normales, pero la petición se sigue registrando.
  let isAdmin = false;
  const sessionHeader = request.headers.get('X-Admin-Session');
  if (sessionHeader && env.ADMIN_SECRET) {
    isAdmin = await verifyAdminSessionToken(sessionHeader, env.ADMIN_SECRET);
  }

  if (!isAdmin) {
    // Cabecera compartida simple — NO es un secreto real (vive en el JS de la
    // PWA), solo frena rastreadores/bots que encuentren esta URL y quemen la
    // cuota gratuita de Gemini sin querer.
    if (env.APP_SHARED_TOKEN && request.headers.get('X-App-Token') !== env.APP_SHARED_TOKEN) {
      return jsonError('No autorizado', 401);
    }
    const okRate = await checkRateLimit(env, `analyze:${ip}`, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_SECONDS);
    if (!okRate) {
      logEvent({ role: 'user', success: false, reason: 'rate_limited' });
      return jsonError('Demasiadas peticiones, inténtalo más tarde', 429);
    }
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

  const role = isAdmin ? 'admin' : 'user';
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
    logEvent({ role, mode: mode || 'auto', success: false, reason: 'network_error' });
    return jsonError('No se pudo contactar con el servicio de IA', 502);
  }

  if (!geminiRes.ok) {
    const errText = await geminiRes.text().catch(() => '');
    console.error('Gemini error', geminiRes.status, errText);
    logEvent({ role, mode: mode || 'auto', success: false, reason: 'gemini_error', status: geminiRes.status });
    return jsonError('El servicio de IA no pudo procesar la imagen', 502);
  }

  const data = await geminiRes.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    logEvent({ role, mode: mode || 'auto', success: false, reason: 'empty_response' });
    return jsonError('Respuesta vacía de la IA', 502);
  }

  const usage = data?.usageMetadata
    ? {
      promptTokens: data.usageMetadata.promptTokenCount ?? null,
      responseTokens: data.usageMetadata.candidatesTokenCount ?? null,
      totalTokens: data.usageMetadata.totalTokenCount ?? null,
    }
    : null;
  logEvent({ role, mode: mode || 'auto', success: true, usage });

  return new Response(text, {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const { pathname } = new URL(request.url);
    if (pathname === '/admin/login') {
      return handleAdminLogin(request, env);
    }
    return handleAnalyze(request, env);
  },
};
