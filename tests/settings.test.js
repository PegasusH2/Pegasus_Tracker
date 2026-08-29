// Preferencia de tema (js/core/settings.js) — la aplicación visual real al
// DOM vive en js/core/theme.js (no testeable en Node, no hay `document`),
// esto solo cubre la capa de datos: valor por defecto, persistencia y
// validación.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import './setup-db.js';
import { db } from '../js/db/schema.js';
import * as settings from '../js/core/settings.js';

beforeEach(async () => {
  await db.exercises.toArray();
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
});

describe('settings.getTheme / setTheme', () => {
  test('por defecto, sin nada guardado, es "default"', async () => {
    await settings.loadSettingsCache();
    assert.equal(settings.getTheme(), 'default');
  });

  test('setTheme persiste y loadSettingsCache lo recupera en un "reinicio" posterior', async () => {
    await settings.loadSettingsCache();
    await settings.setTheme('queens');
    assert.equal(settings.getTheme(), 'queens');

    // Simula cerrar/reabrir la app: una carga nueva de la caché en memoria.
    await settings.loadSettingsCache();
    assert.equal(settings.getTheme(), 'queens');
  });

  test('rechaza un valor de tema no reconocido, sin tocar el ya guardado', async () => {
    await settings.loadSettingsCache();
    await settings.setTheme('white');
    await assert.rejects(() => settings.setTheme('barbie'));
    assert.equal(settings.getTheme(), 'white');
  });

  test('un valor corrupto/desconocido ya guardado en IndexedDB no rompe la carga — cae a "default"', async () => {
    await settings.loadSettingsCache();
    await db.settings.put({ key: 'theme', value: 'algo-que-ya-no-existe' });
    await settings.loadSettingsCache();
    assert.equal(settings.getTheme(), 'default');
  });
});
