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

## Coste

Con el nivel gratuito de Gemini (Flash, ~1500 peticiones/día) y el de
Cloudflare Workers (100.000 peticiones/día), este uso personal no debería
generar ningún coste.
