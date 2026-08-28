// auth.deleteAccount() — nunca borra la cuenta directamente (el cliente no
// tiene ni puede tener la service_role key de Supabase, ver
// worker/index.js#handleDeleteAccount): solo llama al Worker con el token de
// sesión y reacciona a su respuesta. Se prueba con fetch simulado, sin red
// real ni Worker desplegado.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './setup-db.js';
import * as clientMod from '../js/core/supabase-client.js';
import * as auth from '../js/core/auth.js';

let originalFetch;

function setFakeSupabase(session, { signOutError } = {}) {
  let signedOut = false;
  const fake = {
    auth: {
      getSession: async () => ({ data: { session } }),
      signOut: async () => {
        signedOut = true;
        if (signOutError) throw signOutError;
        return { error: null };
      },
    },
  };
  globalThis.window = { supabase: { createClient: () => fake } };
  clientMod.configureSupabase('https://fake.supabase.co', 'fake-anon-key');
  return { wasSignedOut: () => signedOut };
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('auth.deleteAccount', () => {
  test('sin sesión activa, lanza NO_SESSION sin llegar a hacer ninguna petición de red', async () => {
    setFakeSupabase(null);
    let fetchCalled = false;
    globalThis.fetch = async () => { fetchCalled = true; return { ok: true, status: 200 }; };
    await assert.rejects(() => auth.deleteAccount(), /NO_SESSION/);
    assert.equal(fetchCalled, false);
  });

  test('éxito: llama a /account/delete con el token de sesión y cierra sesión localmente después', async () => {
    const { wasSignedOut } = setFakeSupabase({ access_token: 'tok-123', user: { id: 'u1' } });
    let capturedUrl, capturedHeaders;
    globalThis.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedHeaders = opts.headers;
      return { ok: true, status: 200 };
    };
    await auth.deleteAccount();
    assert.ok(capturedUrl.endsWith('/account/delete'));
    assert.equal(capturedHeaders.Authorization, 'Bearer tok-123');
    assert.equal(wasSignedOut(), true);
  });

  test('el Worker responde 429 -> RATE_LIMITED', async () => {
    setFakeSupabase({ access_token: 'tok-123' });
    globalThis.fetch = async () => ({ ok: false, status: 429 });
    await assert.rejects(() => auth.deleteAccount(), /RATE_LIMITED/);
  });

  test('el Worker responde 503 (SUPABASE_SERVICE_ROLE_KEY sin configurar) -> WORKER_NOT_CONFIGURED', async () => {
    setFakeSupabase({ access_token: 'tok-123' });
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(() => auth.deleteAccount(), /WORKER_NOT_CONFIGURED/);
  });

  test('cualquier otro error del Worker -> DELETE_FAILED, y no se cierra sesión local (el borrado remoto no se completó)', async () => {
    const { wasSignedOut } = setFakeSupabase({ access_token: 'tok-123' });
    globalThis.fetch = async () => ({ ok: false, status: 500 });
    await assert.rejects(() => auth.deleteAccount(), /DELETE_FAILED/);
    assert.equal(wasSignedOut(), false);
  });

  test('si el signOut local falla tras el borrado remoto, deleteAccount igualmente resuelve', async () => {
    setFakeSupabase({ access_token: 'tok-123' }, { signOutError: new Error('token ya inválido') });
    globalThis.fetch = async () => ({ ok: true, status: 200 });
    await assert.doesNotReject(() => auth.deleteAccount());
  });

  test('un fallo de red al llamar al Worker se traduce en NETWORK_ERROR', async () => {
    setFakeSupabase({ access_token: 'tok-123' });
    globalThis.fetch = async () => { throw new Error('fetch failed'); };
    await assert.rejects(() => auth.deleteAccount(), /NETWORK_ERROR/);
  });
});
