# Worker de "Importar entrenamiento desde foto"

Este Worker es un proxy: recibe la foto desde la PWA, llama a la API de Gemini
con TU API key (que solo tú conoces) y devuelve el JSON interpretado. La PWA
nunca ve ni guarda esa clave.

No forma parte del sitio estático de GitHub Pages — se despliega aparte, una
sola vez (y cada vez que cambies `index.js`).

## Requisitos (gratis, sin tarjeta necesaria)

1. Cuenta de Cloudflare: https://dash.cloudflare.com/sign-up
2. API key de Gemini (nivel gratuito): https://aistudio.google.com/apikey
3. Node.js instalado en tu ordenador (para usar `wrangler`, la CLI de Cloudflare)

## Pasos

Desde una terminal, dentro de esta carpeta (`worker/`):

```bash
npm install -g wrangler
wrangler login
```

Esto abre el navegador para que autorices Wrangler con tu cuenta de Cloudflare.

Configura los dos secretos (te los pedirá uno a uno, se escriben sin que se vean en pantalla):

```bash
wrangler secret put GEMINI_API_KEY
```
Pega la API key que copiaste de Google AI Studio.

```bash
wrangler secret put APP_SHARED_TOKEN
```
Escribe cualquier cadena larga y aleatoria (por ejemplo, generada con `openssl rand -hex 32`). Anótala — la necesitarás en el siguiente paso.

Despliega:

```bash
wrangler deploy
```

Al terminar, la terminal muestra una URL como:

```
https://fitness-tracker-import.TU-USUARIO.workers.dev
```

## Conectar la PWA

Copia esa URL y el `APP_SHARED_TOKEN` que elegiste, y pégalos en
`js/core/ai-import.js` (constantes `WORKER_URL` y `APP_SHARED_TOKEN` al
principio del archivo). Después de guardar, la función "Importar desde foto"
ya usa tu Worker real en vez de la respuesta simulada de pruebas.

## Actualizar el Worker más adelante

Si cambio `worker/index.js` en una sesión futura, solo tienes que volver a
ejecutar `wrangler deploy` desde esta carpeta — los secretos no hay que
volver a configurarlos.

## Rate limiting (usuarios normales)

El Worker limita las peticiones de análisis por IP (por defecto 10/hora) para
frenar abuso si alguien encuentra la URL. Necesita un namespace de KV:

```bash
wrangler kv namespace create RATE_LIMIT_KV
```

Copia el `id` que te devuelve y pégalo en `wrangler.toml`, en
`[[kv_namespaces]] id = "..."`. Vuelve a desplegar (`wrangler deploy`).

Si no creas este namespace, el Worker sigue funcionando con normalidad pero
sin límite de peticiones — no rompe nada, simplemente esa protección queda
desactivada hasta que lo configures.

## Modo administrador (pruebas sin rate limiting)

Te permite usar PEGASUS (p. ej. desde tu iPhone) sin estar sujeto al límite
de peticiones anterior, sin exponer ninguna clave en la PWA ni en el repo.

Configura tu contraseña de administrador como secreto (elige una contraseña
larga y difícil de adivinar, solo la usas tú):

```bash
wrangler secret put ADMIN_SECRET
```

Con eso ya está activo: en PEGASUS ve a **Ajustes → Modo desarrollador →
Iniciar sesión** e introduce esa misma contraseña. La PWA nunca guarda la
contraseña — solo una sesión temporal (caduca sola a las 12h) que el Worker
emite tras verificarla.

**Revocar el acceso de administrador** (p. ej. si crees que la sesión se ha
filtrado, o simplemente quieres desactivarlo): cambia o borra el secreto,
sin tocar la PWA:

```bash
wrangler secret put ADMIN_SECRET   # nueva contraseña — invalida sesiones antiguas
# o
wrangler secret delete ADMIN_SECRET   # desactiva el modo administrador por completo
```

Todas las peticiones — también las del administrador — se siguen
registrando (rol, tipo de análisis, éxito/error, consumo aproximado de
tokens de Gemini si la API lo informa) en los logs del Worker
(`wrangler tail`), sin incluir nunca contraseñas ni tokens de sesión.

## Eliminar cuenta (Ajustes → Cuenta y sincronización)

Borrar una cuenta de Supabase Auth (y con ella, en cascada, todos sus datos)
solo se puede hacer con la "service role key" — una clave que NUNCA debe
llegar a la PWA (cualquiera que la tuviera podría borrar la cuenta de otra
persona). Por eso este paso vive aquí, en el Worker, no en el cliente.

Copia la clave desde el panel de Supabase: **Project Settings → API →
service_role secret** (proyecto "Pegasus Tracker Project"). Configúrala como
secreto del Worker:

```bash
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

Vuelve a desplegar (`wrangler deploy`). Sin este secreto configurado, el botón
"Eliminar cuenta" de la app sigue apareciendo pero falla con un mensaje claro
("Eliminar cuenta no está configurado") — no rompe nada más.

**Esta clave es tan sensible como la contraseña maestra de la base de
datos.** No la pegues nunca en el repo, en la PWA, ni la compartas — solo
debe existir como secreto de este Worker.

## Coste

Con el nivel gratuito de Gemini (Flash, ~1500 peticiones/día) y el de
Cloudflare Workers (100.000 peticiones/día), este uso personal no debería
generar ningún coste.
